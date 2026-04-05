/**
 * Tests for src/core/watchdog.js
 *
 * Covers: filesystem heartbeat read/write/clean, liveness checks,
 * initial grace period, fallback selection logic, and checkWatchdog().
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import {
  getWatchdogDir,
  getHeartbeatPath,
  ensureWatchdogDir,
  writeHeartbeat,
  readHeartbeat,
  cleanHeartbeat,
  isHeartbeatAlive,
  isInitialGraceExpired,
  selectFallback,
  checkWatchdog,
  DEFAULT_TIMEOUT_MS,
  INITIAL_GRACE_MS,
  WATCHDOG_DIR_NAME,
} from '../src/core/watchdog.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempRoot() {
  const dir = join(os.tmpdir(), `gsr-watchdog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupRoot(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Directory helpers ─────────────────────────────────────────────────────────

describe('getWatchdogDir', () => {
  test('returns .gsr/watchdog under given root', () => {
    assert.equal(getWatchdogDir('/my/project'), `/my/project/${WATCHDOG_DIR_NAME}`);
  });
});

describe('getHeartbeatPath', () => {
  test('returns path ending in {taskId}.json', () => {
    const p = getHeartbeatPath('task-123', '/root');
    assert.ok(p.endsWith('task-123.json'));
    assert.ok(p.includes(WATCHDOG_DIR_NAME));
  });
});

describe('ensureWatchdogDir', () => {
  test('creates the watchdog directory if it does not exist', () => {
    const root = makeTempRoot();
    try {
      const dir = getWatchdogDir(root);
      assert.ok(!existsSync(dir), 'should not exist before');
      ensureWatchdogDir(root);
      assert.ok(existsSync(dir), 'should exist after');
    } finally {
      cleanupRoot(root);
    }
  });

  test('is idempotent — does not throw if already exists', () => {
    const root = makeTempRoot();
    try {
      ensureWatchdogDir(root);
      assert.doesNotThrow(() => ensureWatchdogDir(root));
    } finally {
      cleanupRoot(root);
    }
  });
});

// ── writeHeartbeat / readHeartbeat ────────────────────────────────────────────

describe('writeHeartbeat + readHeartbeat', () => {
  test('writes and reads back heartbeat data', () => {
    const root = makeTempRoot();
    try {
      const taskId = 'test-task-001';
      writeHeartbeat(taskId, { agent: 'sdd-apply', status: 'started' }, root);
      const hb = readHeartbeat(taskId, root);
      assert.ok(hb !== null, 'heartbeat should exist');
      assert.equal(hb.agent, 'sdd-apply');
      assert.equal(hb.status, 'started');
      assert.ok(typeof hb.ts === 'number', 'ts should be a number');
      assert.ok(hb.ts > 0, 'ts should be positive');
    } finally {
      cleanupRoot(root);
    }
  });

  test('ts is always overwritten with current time on write', () => {
    const root = makeTempRoot();
    try {
      const before = Date.now();
      writeHeartbeat('t1', { ts: 0 }, root); // explicit ts: 0 should be ignored
      const hb = readHeartbeat('t1', root);
      assert.ok(hb.ts >= before, 'ts should be >= write time');
    } finally {
      cleanupRoot(root);
    }
  });

  test('readHeartbeat returns null if file does not exist', () => {
    const root = makeTempRoot();
    try {
      const hb = readHeartbeat('nonexistent', root);
      assert.equal(hb, null);
    } finally {
      cleanupRoot(root);
    }
  });

  test('readHeartbeat returns null if file is corrupt JSON', () => {
    const root = makeTempRoot();
    try {
      ensureWatchdogDir(root);
      const path = getHeartbeatPath('corrupt', root);
      writeFileSync(path, 'NOT_JSON', 'utf8');
      const hb = readHeartbeat('corrupt', root);
      assert.equal(hb, null);
    } finally {
      cleanupRoot(root);
    }
  });
});

// ── cleanHeartbeat ────────────────────────────────────────────────────────────

describe('cleanHeartbeat', () => {
  test('deletes an existing heartbeat file', () => {
    const root = makeTempRoot();
    try {
      writeHeartbeat('cleanup-me', { status: 'done' }, root);
      assert.ok(existsSync(getHeartbeatPath('cleanup-me', root)));
      cleanHeartbeat('cleanup-me', root);
      assert.ok(!existsSync(getHeartbeatPath('cleanup-me', root)));
    } finally {
      cleanupRoot(root);
    }
  });

  test('does not throw if file does not exist', () => {
    const root = makeTempRoot();
    try {
      assert.doesNotThrow(() => cleanHeartbeat('does-not-exist', root));
    } finally {
      cleanupRoot(root);
    }
  });
});

// ── isHeartbeatAlive ──────────────────────────────────────────────────────────

describe('isHeartbeatAlive', () => {
  test('returns true for a recent heartbeat', () => {
    const hb = { ts: Date.now() - 5_000 }; // 5s ago
    assert.ok(isHeartbeatAlive(hb));
  });

  test('returns false for an old heartbeat beyond default threshold', () => {
    const hb = { ts: Date.now() - DEFAULT_TIMEOUT_MS - 1000 };
    assert.ok(!isHeartbeatAlive(hb));
  });

  test('respects custom threshold', () => {
    const hb = { ts: Date.now() - 5_000 };
    assert.ok(!isHeartbeatAlive(hb, 3_000));  // 3s threshold, 5s old → dead
    assert.ok(isHeartbeatAlive(hb, 10_000));  // 10s threshold, 5s old → alive
  });

  test('returns false for null heartbeat', () => {
    assert.ok(!isHeartbeatAlive(null));
  });

  test('returns false for heartbeat without ts', () => {
    assert.ok(!isHeartbeatAlive({ status: 'started' }));
  });
});

// ── isInitialGraceExpired ─────────────────────────────────────────────────────

describe('isInitialGraceExpired', () => {
  test('returns false when within grace period', () => {
    const start = Date.now() - 10_000; // 10s ago
    assert.ok(!isInitialGraceExpired(start)); // 45s grace not exceeded
  });

  test('returns true when grace period exceeded', () => {
    const start = Date.now() - INITIAL_GRACE_MS - 1000;
    assert.ok(isInitialGraceExpired(start));
  });

  test('respects custom grace', () => {
    const start = Date.now() - 10_000;
    assert.ok(isInitialGraceExpired(start, 5_000));  // 5s grace → expired
    assert.ok(!isInitialGraceExpired(start, 20_000)); // 20s grace → still waiting
  });
});

// ── selectFallback ────────────────────────────────────────────────────────────

describe('selectFallback', () => {
  test('returns null for empty fallbacks', () => {
    assert.equal(selectFallback([], 'timeout'), null);
    assert.equal(selectFallback(null, 'timeout'), null);
  });

  test('matches exact errorType first', () => {
    const fallbacks = [
      { model: 'model-quota', on: ['quota_exceeded'] },
      { model: 'model-any', on: ['any'] },
    ];
    assert.equal(selectFallback(fallbacks, 'quota_exceeded'), 'model-quota');
  });

  test('falls back to "any" when no exact match', () => {
    const fallbacks = [
      { model: 'model-quota', on: ['quota_exceeded'] },
      { model: 'model-any', on: ['any'] },
    ];
    assert.equal(selectFallback(fallbacks, 'timeout'), 'model-any');
  });

  test('falls back to first entry when no exact match and no "any"', () => {
    const fallbacks = [
      { model: 'model-quota', on: ['quota_exceeded'] },
      { model: 'model-rate', on: ['rate_limited'] },
    ];
    assert.equal(selectFallback(fallbacks, 'timeout'), 'model-quota');
  });

  test('handles legacy string[] format', () => {
    const fallbacks = ['model-a', 'model-b'];
    assert.equal(selectFallback(fallbacks, 'timeout'), 'model-a');
  });

  test('handles mixed string and object format', () => {
    const fallbacks = [
      { model: 'model-specific', on: ['quota_exceeded'] },
      'model-legacy',
    ];
    assert.equal(selectFallback(fallbacks, 'timeout'), 'model-legacy'); // legacy → on:["any"]
    assert.equal(selectFallback(fallbacks, 'quota_exceeded'), 'model-specific');
  });

  test('default errorType is "any"', () => {
    const fallbacks = [{ model: 'model-x', on: ['any'] }];
    assert.equal(selectFallback(fallbacks), 'model-x');
  });
});

// ── checkWatchdog ─────────────────────────────────────────────────────────────

describe('checkWatchdog', () => {
  test('returns alive+grace_period when no heartbeat within grace window', () => {
    const root = makeTempRoot();
    try {
      const start = Date.now() - 10_000; // 10s ago, within 45s grace
      const result = checkWatchdog('new-task', start, root);
      assert.ok(result.alive);
      assert.equal(result.reason, 'grace_period');
      assert.equal(result.heartbeat, null);
    } finally {
      cleanupRoot(root);
    }
  });

  test('returns dead+no_heartbeat when grace period exceeded and no heartbeat', () => {
    const root = makeTempRoot();
    try {
      const start = Date.now() - INITIAL_GRACE_MS - 5_000;
      const result = checkWatchdog('late-task', start, root);
      assert.ok(!result.alive);
      assert.equal(result.reason, 'no_heartbeat');
    } finally {
      cleanupRoot(root);
    }
  });

  test('returns alive+healthy for recent heartbeat', () => {
    const root = makeTempRoot();
    try {
      writeHeartbeat('healthy-task', { status: 'in_progress', current: 'T2.1' }, root);
      const result = checkWatchdog('healthy-task', Date.now() - 5_000, root);
      assert.ok(result.alive);
      assert.equal(result.reason, 'healthy');
      assert.equal(result.heartbeat.status, 'in_progress');
    } finally {
      cleanupRoot(root);
    }
  });

  test('returns dead+heartbeat_timeout for stale heartbeat', () => {
    const root = makeTempRoot();
    try {
      ensureWatchdogDir(root);
      const path = getHeartbeatPath('stale-task', root);
      const staleTs = Date.now() - DEFAULT_TIMEOUT_MS - 5_000;
      writeFileSync(path, JSON.stringify({ ts: staleTs, status: 'in_progress' }), 'utf8');

      const result = checkWatchdog('stale-task', Date.now() - 120_000, root);
      assert.ok(!result.alive);
      assert.equal(result.reason, 'heartbeat_timeout');
      assert.ok(result.heartbeat !== null);
    } finally {
      cleanupRoot(root);
    }
  });
});
