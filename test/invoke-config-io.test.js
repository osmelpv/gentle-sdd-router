/**
 * Tests for src/core/invoke-config-io.js
 *
 * Validates loadInvokeConfigs():
 * - Reads all *.yaml files from {routerDir}/invoke_configs/
 * - Returns [] when directory does not exist
 * - Validates required fields: name, sdd, phases
 * - Returns objects with filePath property
 *
 * Strict TDD: tests written FIRST (RED phase).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { loadInvokeConfigs } from '../src/core/invoke-config-io.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a temp directory simulating a router dir with invoke_configs/ subdir.
 */
function makeTempRouterDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-invoke-test-'));
  return tmpDir;
}

/**
 * Write a YAML file into routerDir/invoke_configs/.
 */
function writeInvokeConfig(routerDir, filename, content) {
  const invokeConfigsDir = path.join(routerDir, 'invoke_configs');
  fs.mkdirSync(invokeConfigsDir, { recursive: true });
  fs.writeFileSync(path.join(invokeConfigsDir, filename), content, 'utf8');
}

/**
 * Recursively remove a directory.
 */
function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Valid invoke config YAML fixtures ───────────────────────────────────────

const VALID_MONO_YAML = `\
name: gsr-sdd-debug-mono
sdd: sdd-debug
availability: stable
identity:
  inherit_agents_md: true
  persona: gentleman
phases:
  orchestrator:
    model: openai/gpt-5.4
    fallbacks:
      - anthropic/claude-sonnet-4
      - google/gemini-2.5-pro
  analyze-area:
    model: openai/gpt-5.4
    fallbacks:
      - anthropic/claude-sonnet-4
  implant-logs:
    model: openai/gpt-5.4
  apply-fixes:
    model: openai/gpt-5.4
`;

const VALID_MULTI_YAML = `\
name: gsr-sdd-debug-multi
sdd: sdd-debug
availability: stable
phases:
  orchestrator:
    model: openai/gpt-5.4
    fallbacks:
      - anthropic/claude-opus-4-6
  analyze-area:
    model: openai/gpt-5.4
  implant-logs:
    model: openai/gpt-5.4
  apply-fixes:
    model: openai/gpt-5.4
`;

// ─── Test: Load two valid invoke configs ──────────────────────────────────────

describe('loadInvokeConfigs — two valid files', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
    writeInvokeConfig(routerDir, 'gsr-sdd-debug-mono.yaml', VALID_MONO_YAML);
    writeInvokeConfig(routerDir, 'gsr-sdd-debug-multi.yaml', VALID_MULTI_YAML);
  });

  afterEach(() => cleanup(routerDir));

  test('returns array of 2 items', async () => {
    const result = await loadInvokeConfigs(routerDir);
    assert.equal(result.length, 2);
  });

  test('each item has name, sdd, phases fields', async () => {
    const result = await loadInvokeConfigs(routerDir);
    const names = result.map((r) => r.name).sort();
    assert.deepEqual(names, ['gsr-sdd-debug-mono', 'gsr-sdd-debug-multi']);
    for (const item of result) {
      assert.ok(typeof item.name === 'string' && item.name.length > 0, 'name must be a non-empty string');
      assert.ok(typeof item.sdd === 'string' && item.sdd.length > 0, 'sdd must be a non-empty string');
      assert.ok(item.phases !== null && typeof item.phases === 'object', 'phases must be an object');
    }
  });

  test('each item includes filePath with absolute path to the file', async () => {
    const result = await loadInvokeConfigs(routerDir);
    for (const item of result) {
      assert.ok(typeof item.filePath === 'string', 'filePath must be a string');
      assert.ok(path.isAbsolute(item.filePath), `filePath must be absolute, got: ${item.filePath}`);
      assert.ok(item.filePath.endsWith('.yaml'), 'filePath must end with .yaml');
      assert.ok(fs.existsSync(item.filePath), `filePath must point to existing file: ${item.filePath}`);
    }
  });
});

// ─── Test: Directory does not exist → returns [] ─────────────────────────────

describe('loadInvokeConfigs — directory does not exist', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
    // Do NOT create invoke_configs/ directory
  });

  afterEach(() => cleanup(routerDir));

  test('returns empty array when invoke_configs/ directory does not exist', async () => {
    const result = await loadInvokeConfigs(routerDir);
    assert.deepEqual(result, []);
  });
});

// ─── Test: Missing required fields → throws ──────────────────────────────────

describe('loadInvokeConfigs — missing required fields', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
  });

  afterEach(() => cleanup(routerDir));

  test('file missing name field throws error with file path in message', async () => {
    writeInvokeConfig(routerDir, 'missing-name.yaml', `\
sdd: sdd-debug
phases:
  orchestrator:
    model: openai/gpt-5.4
`);
    await assert.rejects(
      () => loadInvokeConfigs(routerDir),
      (err) => {
        assert.ok(err.message.includes('missing-name.yaml'), `Error message should include filename, got: ${err.message}`);
        return true;
      }
    );
  });

  test('file missing sdd field throws error with file path in message', async () => {
    writeInvokeConfig(routerDir, 'missing-sdd.yaml', `\
name: test-config
phases:
  orchestrator:
    model: openai/gpt-5.4
`);
    await assert.rejects(
      () => loadInvokeConfigs(routerDir),
      (err) => {
        assert.ok(err.message.includes('missing-sdd.yaml'), `Error message should include filename, got: ${err.message}`);
        return true;
      }
    );
  });

  test('file missing phases field throws error with file path in message', async () => {
    writeInvokeConfig(routerDir, 'missing-phases.yaml', `\
name: test-config
sdd: sdd-debug
`);
    await assert.rejects(
      () => loadInvokeConfigs(routerDir),
      (err) => {
        assert.ok(err.message.includes('missing-phases.yaml'), `Error message should include filename, got: ${err.message}`);
        return true;
      }
    );
  });
});

// ─── Test: Empty phases object → valid ───────────────────────────────────────

describe('loadInvokeConfigs — empty phases object is valid', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
    // Note: in this YAML parser, "phases:" (empty value) parses to {} (empty object).
    // "phases: {}" parses to the string "{}" — use bare empty key instead.
    writeInvokeConfig(routerDir, 'empty-phases.yaml', `\
name: test-empty-phases
sdd: sdd-debug
phases:
`);
  });

  afterEach(() => cleanup(routerDir));

  test('file with empty phases: {} loads without error', async () => {
    const result = await loadInvokeConfigs(routerDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'test-empty-phases');
    assert.deepEqual(result[0].phases, {});
  });
});

// ─── Test: Simplified phase format {model, fallbacks} ────────────────────────

describe('loadInvokeConfigs — simplified phase format', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
    writeInvokeConfig(routerDir, 'gsr-sdd-debug-mono.yaml', VALID_MONO_YAML);
  });

  afterEach(() => cleanup(routerDir));

  test('phase entry with {model, fallbacks} loads correctly', async () => {
    const result = await loadInvokeConfigs(routerDir);
    assert.equal(result.length, 1);
    const mono = result[0];
    assert.equal(mono.name, 'gsr-sdd-debug-mono');
    assert.equal(mono.phases.orchestrator.model, 'openai/gpt-5.4');
    assert.ok(Array.isArray(mono.phases.orchestrator.fallbacks), 'fallbacks should be an array');
    assert.deepEqual(mono.phases.orchestrator.fallbacks, ['anthropic/claude-sonnet-4', 'google/gemini-2.5-pro']);
  });

  test('phase entry with only model (no fallbacks) loads correctly', async () => {
    const result = await loadInvokeConfigs(routerDir);
    const mono = result[0];
    // implant-logs phase has no fallbacks
    assert.equal(mono.phases['implant-logs'].model, 'openai/gpt-5.4');
    assert.equal(mono.phases['implant-logs'].fallbacks, undefined);
  });
});

// ─── Test: Returned objects include filePath ─────────────────────────────────

describe('loadInvokeConfigs — filePath property', () => {
  let routerDir;

  beforeEach(() => {
    routerDir = makeTempRouterDir();
    writeInvokeConfig(routerDir, 'gsr-sdd-debug-mono.yaml', VALID_MONO_YAML);
  });

  afterEach(() => cleanup(routerDir));

  test('returned object filePath points to the correct absolute file', async () => {
    const result = await loadInvokeConfigs(routerDir);
    assert.equal(result.length, 1);
    const expectedPath = path.join(routerDir, 'invoke_configs', 'gsr-sdd-debug-mono.yaml');
    assert.equal(result[0].filePath, expectedPath);
  });
});
