/**
 * Tests for detectGentleAiProfiles function in src/core/profile-io.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, before, after } from 'node:test';
import { detectGentleAiProfiles } from '../src/core/profile-io.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-detect-gai-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeOpenCodeJson(dir, content) {
  const p = path.join(dir, 'opencode.json');
  fs.writeFileSync(p, JSON.stringify(content, null, 2), 'utf8');
  return p;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectGentleAiProfiles', () => {
  test('finds sdd-orchestrator (no suffix) as gentle-ai profile', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'sdd-orchestrator': { model: 'anthropic/claude-sonnet-4-5' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'sdd-orchestrator');
      assert.equal(results[0].model, 'anthropic/claude-sonnet-4-5');
      assert.equal(results[0].isGentleAi, true);
    } finally {
      cleanup(dir);
    }
  });

  test('finds sdd-orchestrator-cheap as gentle-ai profile', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'sdd-orchestrator-cheap': { model: 'openai/gpt-4o-mini' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'sdd-orchestrator-cheap');
      assert.equal(results[0].model, 'openai/gpt-4o-mini');
      assert.equal(results[0].isGentleAi, true);
    } finally {
      cleanup(dir);
    }
  });

  test('finds multiple sdd-orchestrator variants', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'sdd-orchestrator': { model: 'anthropic/claude-sonnet-4-5' },
          'sdd-orchestrator-cheap': { model: 'openai/gpt-4o-mini' },
          'sdd-orchestrator-heavy': { model: 'anthropic/claude-opus-4' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 3);
      const names = results.map(r => r.name).sort();
      assert.deepEqual(names, ['sdd-orchestrator', 'sdd-orchestrator-cheap', 'sdd-orchestrator-heavy']);
    } finally {
      cleanup(dir);
    }
  });

  test('ignores gsr-multivendor (has gsr- prefix)', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'gsr-multivendor': { model: 'anthropic/claude-sonnet-4-5' },
          'gsr-sdd-orchestrator': { model: 'openai/gpt-4o' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('ignores agents that do not match sdd-orchestrator pattern', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'my-custom-agent': { model: 'anthropic/claude-sonnet-4-5' },
          'orchestrator': { model: 'openai/gpt-4o' },
          'sdd-apply': { model: 'openai/gpt-4o-mini' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('returns [] when file does not exist', async () => {
    const nonExistentPath = path.join(os.tmpdir(), 'nonexistent-opencode.json');
    const results = await detectGentleAiProfiles(nonExistentPath);
    assert.deepEqual(results, []);
  });

  test('returns [] when agents object is missing', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, { version: 1, providers: {} });
      const results = await detectGentleAiProfiles(jsonPath);
      assert.deepEqual(results, []);
    } finally {
      cleanup(dir);
    }
  });

  test('returns [] when agents object is empty', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, { agents: {} });
      const results = await detectGentleAiProfiles(jsonPath);
      assert.deepEqual(results, []);
    } finally {
      cleanup(dir);
    }
  });

  test('handles agent with no model field (model is null)', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'sdd-orchestrator': {},
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'sdd-orchestrator');
      assert.equal(results[0].model, null);
      assert.equal(results[0].isGentleAi, true);
    } finally {
      cleanup(dir);
    }
  });

  test('returns [] when file contains invalid JSON', async () => {
    const dir = makeTempDir();
    try {
      const p = path.join(dir, 'opencode.json');
      fs.writeFileSync(p, 'this is not json', 'utf8');
      const results = await detectGentleAiProfiles(p);
      assert.deepEqual(results, []);
    } finally {
      cleanup(dir);
    }
  });

  test('mixed: finds only sdd-orchestrator variants, ignores gsr- and other agents', async () => {
    const dir = makeTempDir();
    try {
      const jsonPath = writeOpenCodeJson(dir, {
        agents: {
          'sdd-orchestrator': { model: 'anthropic/claude-sonnet-4-5' },
          'sdd-orchestrator-cheap': { model: 'openai/gpt-4o-mini' },
          'gsr-multivendor': { model: 'anthropic/claude-opus-4' },
          'my-agent': { model: 'openai/gpt-4o' },
        },
      });

      const results = await detectGentleAiProfiles(jsonPath);
      assert.equal(results.length, 2);
      const names = results.map(r => r.name).sort();
      assert.deepEqual(names, ['sdd-orchestrator', 'sdd-orchestrator-cheap']);
    } finally {
      cleanup(dir);
    }
  });
});
