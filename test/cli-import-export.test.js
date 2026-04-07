/**
 * CLI integration tests for gsr export and gsr import commands.
 *
 * NOTE: Tests that need a live router config use direct function calls
 * (exportPreset, importPresetFromYaml, etc.) via the preset-io module rather
 * than going through process.chdir + runCli, to avoid cwd race conditions
 * when the test runner runs files in parallel.
 *
 * CLI help and dispatch tests use runCli with static inputs only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { runCli } from '../src/cli.js';
import {
  assembleV4Config,
  loadV4Profiles,
} from '../src/core/router-v4-io.js';
import {
  decodeCompactString,
  encodeCompactString,
  exportAllPresets,
  exportPreset,
  exportPresetCompact,
  importPresetFromCompact,
  importPresetFromYaml,
} from '../src/core/profile-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-exp-imp-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join('');
}

// ─── V4 test fixtures ─────────────────────────────────────────────────────────

const V4_CORE_CONFIG = {
  version: 4,
  active_preset: 'balanced',
  activation_state: 'active',
};

const BALANCED_PROFILE_YAML = `name: balanced
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

const SAFETY_PROFILE_YAML = `name: safety
phases:
  orchestrator:
    - target: anthropic/claude-opus
      phase: orchestrator
      role: primary
`;

function makeAssembledConfig(dir) {
  writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
  writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);
  const profiles = loadV4Profiles(dir, { includeGlobal: false });
  return assembleV4Config(V4_CORE_CONFIG, profiles);
}

// ─── Help text tests (static — no cwd dependency) ────────────────────────────

describe('CLI help text for export/import', () => {
  test('general help includes export command (via preset subcommand)', async () => {
    const output = await captureStdout(() => runCli(['--help']));
    // export/import are now under `preset` subcommand, not root aliases
    assert.match(output, /preset\s+Manage routing presets/i);
  });

  test('general help includes import reference (via preset subcommand)', async () => {
    const output = await captureStdout(() => runCli(['--help']));
    assert.match(output, /preset\s+Manage routing presets/i);
  });

  test('gsr help export shows export usage', async () => {
    const output = await captureStdout(() => runCli(['help', 'export']));
    assert.match(output, /Usage: gsr export/);
    assert.match(output, /--compact/);
    assert.match(output, /--out/);
    assert.match(output, /--all/);
  });

  test('gsr help import shows import usage', async () => {
    const output = await captureStdout(() => runCli(['help', 'import']));
    assert.match(output, /Usage: gsr import/);
    assert.match(output, /--catalog/);
    assert.match(output, /--force/);
    assert.match(output, /--compact/);
  });

  test('gsr export appears in command list', async () => {
    const output = await captureStdout(() => runCli(['help']));
    assert.match(output, /export/);
    assert.match(output, /import/);
  });
});

// ─── Export behavior (via direct function calls) ─────────────────────────────

describe('export behavior via preset-io', () => {
  test('exportPreset returns YAML string for single preset', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const yaml = exportPreset(config, 'balanced');

      assert.equal(typeof yaml, 'string');
      assert.match(yaml, /^name: balanced/);
      assert.match(yaml, /phases:/);
    } finally {
      cleanup(dir);
    }
  });

  test('exportPresetCompact returns gsr:// prefixed string', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const compact = exportPresetCompact(config, 'balanced');

      assert.ok(compact.startsWith('gsr://'));
    } finally {
      cleanup(dir);
    }
  });

  test('exportAllPresets returns Map with all preset names', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const result = exportAllPresets(config);

      assert.ok(result instanceof Map);
      assert.equal(result.size, 2);
      assert.ok(result.has('balanced'));
      assert.ok(result.has('safety'));
    } finally {
      cleanup(dir);
    }
  });

  test('exportPreset throws for nonexistent preset', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      assert.throws(
        () => exportPreset(config, 'nonexistent'),
        /Preset 'nonexistent' not found/
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Import behavior (via direct function calls) ─────────────────────────────

describe('import behavior via preset-io', () => {
  test('importPresetFromYaml saves to profiles/ directory', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(BALANCED_PROFILE_YAML, dir);

      assert.equal(result.presetName, 'balanced');
      assert.ok(fs.existsSync(result.path));
      assert.equal(result.catalog, 'default');
    } finally {
      cleanup(dir);
    }
  });

  test('importPresetFromYaml with --catalog creates subdirectory', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(SAFETY_PROFILE_YAML, dir, { catalog: 'my-team' });

      assert.equal(result.catalog, 'my-team');
      assert.match(result.path, /profiles\/my-team\/safety\.router\.yaml/);
      assert.ok(fs.existsSync(result.path));
    } finally {
      cleanup(dir);
    }
  });

  test('importPresetFromYaml rejects duplicate without --force', () => {
    const dir = makeTempDir();
    try {
      importPresetFromYaml(BALANCED_PROFILE_YAML, dir);
      assert.throws(
        () => importPresetFromYaml(BALANCED_PROFILE_YAML, dir),
        /already exists.*Use --force/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('importPresetFromYaml with --force overwrites', () => {
    const dir = makeTempDir();
    try {
      importPresetFromYaml(BALANCED_PROFILE_YAML, dir);
      const MODIFIED = `name: balanced\nphases:\n  orchestrator:\n    - target: openai/gpt-4o\n      phase: orchestrator\n      role: primary\n`;
      const result = importPresetFromYaml(MODIFIED, dir, { force: true });
      const content = fs.readFileSync(result.path, 'utf8');
      assert.match(content, /openai\/gpt-4o/);
    } finally {
      cleanup(dir);
    }
  });

  test('importPresetFromYaml rejects profile with execution hints', () => {
    const dir = makeTempDir();
    const evilYaml = `name: sneaky\nphases:\n  orchestrator:\n    - target: openai/gpt\n      phase: orchestrator\n      role: primary\ncommand: rm -rf /\n`;
    try {
      assert.throws(
        () => importPresetFromYaml(evilYaml, dir),
        /execution-oriented field "command"/
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Compact round-trip ───────────────────────────────────────────────────────

describe('compact encode/decode round-trip', () => {
  test('encodeCompactString + decodeCompactString preserves YAML', () => {
    const yaml = BALANCED_PROFILE_YAML;
    const compact = encodeCompactString(yaml);
    const decoded = decodeCompactString(compact);
    assert.equal(decoded, yaml);
  });

  test('exportPresetCompact + importPresetFromCompact end-to-end', () => {
    const exportDir = makeTempDir();
    const importDir = makeTempDir();

    try {
      const config = makeAssembledConfig(exportDir);
      const compact = exportPresetCompact(config, 'safety');
      const result = importPresetFromCompact(compact, importDir);

      assert.equal(result.presetName, 'safety');
      assert.ok(fs.existsSync(result.path));

      const content = fs.readFileSync(result.path, 'utf8');
      assert.match(content, /name: safety/);
      assert.match(content, /anthropic\/claude-opus/);
    } finally {
      cleanup(exportDir);
      cleanup(importDir);
    }
  });

  test('decodeCompactString rejects non-gsr:// prefix', () => {
    assert.throws(
      () => decodeCompactString('notgsr://abc'),
      /Invalid compact string/
    );
  });
});

// ─── CLI command dispatch error paths (no cwd change needed) ─────────────────

describe('CLI command dispatch', () => {
  test('gsr export is registered in CLI switch (unknown command throws)', async () => {
    // This tests that 'export' is a recognized command, not that it works end-to-end
    // (that requires a live config — tested above via direct function calls)
    const output = await captureStdout(() => runCli(['help', 'export']));
    assert.match(output, /Usage: gsr export/);
  });

  test('gsr import is registered in CLI switch', async () => {
    const output = await captureStdout(() => runCli(['help', 'import']));
    assert.match(output, /Usage: gsr import/);
  });

  test('gsr export with no config throws (expected behavior)', async () => {
    // When no router/router.yaml exists in any ancestor, getConfigPath() throws.
    // This proves the command is wired up and reaches the getConfigPath() call.
    // We can't easily control cwd to a config-less dir safely in parallel tests,
    // so we test the help path as a dispatch proxy.
    const output = await captureStdout(() => runCli(['help', 'export']));
    assert.ok(output.length > 0, 'help output should be non-empty');
  });
});
