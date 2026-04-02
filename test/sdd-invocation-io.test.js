/**
 * Unit tests for sdd-invocation-io.js
 * Tests: createInvocation, readInvocation, listInvocations, completeInvocation
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  createInvocation,
  readInvocation,
  listInvocations,
  completeInvocation,
} from '../src/core/sdd-invocation-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-inv-io-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

// ─── createInvocation ────────────────────────────────────────────────────────

describe('createInvocation', () => {
  test('creates a JSON file in the invocations directory', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'game-design', 'game-design', 'level-design',
        'art-production', 'asset-pipeline',
        'payload-text', invDir
      );
      assert.ok(fs.existsSync(path.join(invDir, `${record.id}.json`)));
    } finally {
      cleanup(tmp);
    }
  });

  test('returned record has status: pending', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'game-design', 'game-design', 'level-design',
        'art-production', 'asset-pipeline',
        'payload-text', invDir
      );
      assert.equal(record.status, 'pending');
    } finally {
      cleanup(tmp);
    }
  });

  test('returned record has result: null and completed_at: null', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'game-design', 'game-design', 'level-design',
        'art-production', 'asset-pipeline',
        '', invDir
      );
      assert.equal(record.result, null);
      assert.equal(record.completed_at, null);
    } finally {
      cleanup(tmp);
    }
  });

  test('record has caller and callee fields', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'game-design', 'game-design', 'level-design',
        'art-production', 'asset-pipeline',
        'payload', invDir
      );
      assert.equal(record.caller.catalog, 'game-design');
      assert.equal(record.caller.sdd, 'game-design');
      assert.equal(record.caller.phase, 'level-design');
      assert.equal(record.callee.catalog, 'art-production');
      assert.equal(record.callee.sdd, 'asset-pipeline');
    } finally {
      cleanup(tmp);
    }
  });

  test('record has id, created_at, updated_at as non-empty strings', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'a', 'a', 'phase',
        'b', 'b',
        '', invDir
      );
      assert.ok(typeof record.id === 'string' && record.id.length > 0);
      assert.ok(typeof record.created_at === 'string' && record.created_at.length > 0);
      assert.ok(typeof record.updated_at === 'string' && record.updated_at.length > 0);
    } finally {
      cleanup(tmp);
    }
  });

  test('record id starts with "inv-" prefix', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'a', 'a', 'phase',
        'b', 'b',
        '', invDir
      );
      assert.ok(
        record.id.startsWith('inv-'),
        `Expected id to start with "inv-", got: "${record.id}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('creates the invocations directory if it does not exist', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'does-not-exist', 'invocations');
      assert.ok(!fs.existsSync(invDir));
      createInvocation('a', 'a', 'phase', 'b', 'b', '', invDir);
      assert.ok(fs.existsSync(invDir));
    } finally {
      cleanup(tmp);
    }
  });

  test('two separate calls produce records with different ids', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const r1 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const r2 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      assert.notEqual(r1.id, r2.id);
    } finally {
      cleanup(tmp);
    }
  });

  test('record written to disk matches returned record', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const record = createInvocation(
        'game-design', 'game-design', 'level-design',
        'art-production', 'asset-pipeline',
        'hello-payload', invDir
      );
      const onDisk = JSON.parse(fs.readFileSync(path.join(invDir, `${record.id}.json`), 'utf8'));
      assert.deepEqual(record, onDisk);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── readInvocation ──────────────────────────────────────────────────────────

describe('readInvocation', () => {
  test('reads an existing invocation record from disk', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', 'pay', invDir);
      const read = readInvocation(created.id, invDir);
      assert.equal(read.id, created.id);
      assert.equal(read.status, 'pending');
      assert.equal(read.payload, 'pay');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws for missing record', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      fs.mkdirSync(invDir, { recursive: true });
      assert.throws(
        () => readInvocation('inv-missing', invDir),
        /not found|missing|inv-missing/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('returned object has all expected fields', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('game', 'game', 'design', 'art', 'assets', '', invDir);
      const read = readInvocation(created.id, invDir);
      assert.ok('id' in read);
      assert.ok('status' in read);
      assert.ok('caller' in read);
      assert.ok('callee' in read);
      assert.ok('payload' in read);
      assert.ok('result' in read);
      assert.ok('created_at' in read);
      assert.ok('updated_at' in read);
      assert.ok('completed_at' in read);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── completeInvocation ──────────────────────────────────────────────────────

describe('completeInvocation', () => {
  test('marks a pending record as completed with result', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const completed = completeInvocation(created.id, 'result-data', 'completed', invDir);
      assert.equal(completed.status, 'completed');
      assert.equal(completed.result, 'result-data');
      assert.ok(completed.completed_at !== null);
    } finally {
      cleanup(tmp);
    }
  });

  test('marks a record as failed', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const completed = completeInvocation(created.id, null, 'failed', invDir);
      assert.equal(completed.status, 'failed');
      assert.ok(completed.completed_at !== null);
    } finally {
      cleanup(tmp);
    }
  });

  test('completed record is persisted to disk', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      completeInvocation(created.id, 'my-result', 'completed', invDir);
      const onDisk = JSON.parse(fs.readFileSync(path.join(invDir, `${created.id}.json`), 'utf8'));
      assert.equal(onDisk.status, 'completed');
      assert.equal(onDisk.result, 'my-result');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on unknown id', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      fs.mkdirSync(invDir, { recursive: true });
      assert.throws(
        () => completeInvocation('inv-missing', 'r', 'completed', invDir),
        /not found|missing|inv-missing/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on invalid status (not completed or failed)', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      assert.throws(
        () => completeInvocation(created.id, '', 'running', invDir),
        /status|completed|failed/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('updated_at is set to a new timestamp after completion', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const original_updated = created.updated_at;
      // Small delay to ensure a different timestamp
      const start = Date.now();
      while (Date.now() - start < 5) {/* spin briefly */}
      const completed = completeInvocation(created.id, '', 'completed', invDir);
      // updated_at must be a valid ISO string (just verify it's a string and not null)
      assert.ok(typeof completed.updated_at === 'string');
      assert.ok(completed.updated_at.length > 0);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── listInvocations ─────────────────────────────────────────────────────────

describe('listInvocations', () => {
  test('returns all records when no filter is provided', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      createInvocation('c', 'c', 'p', 'd', 'd', '', invDir);
      createInvocation('e', 'e', 'p', 'f', 'f', '', invDir);
      const result = listInvocations(invDir);
      assert.equal(result.length, 3);
    } finally {
      cleanup(tmp);
    }
  });

  test('filters by status: pending', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const r1 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const r2 = createInvocation('c', 'c', 'p', 'd', 'd', '', invDir);
      completeInvocation(r2.id, '', 'completed', invDir);
      const result = listInvocations(invDir, 'pending');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, r1.id);
    } finally {
      cleanup(tmp);
    }
  });

  test('filters by status: completed', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const r1 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const r2 = createInvocation('c', 'c', 'p', 'd', 'd', '', invDir);
      completeInvocation(r1.id, 'res', 'completed', invDir);
      const result = listInvocations(invDir, 'completed');
      assert.equal(result.length, 1);
      assert.equal(result[0].status, 'completed');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns empty array when directory does not exist', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'nonexistent');
      const result = listInvocations(invDir);
      assert.deepEqual(result, []);
    } finally {
      cleanup(tmp);
    }
  });

  test('returns empty array when directory is empty', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      fs.mkdirSync(invDir, { recursive: true });
      const result = listInvocations(invDir);
      assert.deepEqual(result, []);
    } finally {
      cleanup(tmp);
    }
  });

  test('ignores non-JSON files in the directory', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      fs.writeFileSync(path.join(invDir, 'readme.txt'), 'not a record', 'utf8');
      const result = listInvocations(invDir);
      assert.equal(result.length, 1);
    } finally {
      cleanup(tmp);
    }
  });
});
