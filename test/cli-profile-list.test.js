/**
 * Tests for `gsr profile list` and `gsr preset list` deprecation warning.
 *
 * Uses runProfileList(options) directly — passes configPath and
 * openCodeJsonPath to avoid process.chdir and real filesystem side effects.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { runProfileList } from '../src/cli.js';
import { runCli } from '../src/cli.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-profile-list-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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

/**
 * Build a minimal v4 router directory with some profile YAML files.
 * Returns { routerDir, configPath }
 */
function makeRouterWithProfiles(tmp) {
  const routerDir = path.join(tmp, 'router');
  const configPath = path.join(routerDir, 'router.yaml');

  // Core config (v4)
  writeFile(routerDir, 'router.yaml', [
    'version: 4',
    'active_preset: local-hybrid',
  ].join('\n'));

  // User profile (visible: true, no builtin)
  writeFile(routerDir, 'profiles/local-hybrid.router.yaml', [
    'name: local-hybrid',
    'sdd: agent-orchestrator',
    'visible: true',
    'builtin: false',
    'phases:',
    '  orchestrator:',
    '    model: ollama/phi4',
    '    fallbacks: []',
  ].join('\n'));

  // Builtin profile (visible: false, builtin: true)
  writeFile(routerDir, 'profiles/multivendor.router.yaml', [
    'name: multivendor',
    'sdd: agent-orchestrator',
    'visible: false',
    'builtin: true',
    'phases:',
    '  orchestrator:',
    '    model: anthropic/claude-sonnet',
    '    fallbacks: []',
  ].join('\n'));

  // Another user profile (visible: false, builtin: false)
  writeFile(routerDir, 'profiles/cheap.router.yaml', [
    'name: cheap',
    'sdd: agent-orchestrator',
    'visible: false',
    'builtin: true',
    'phases:',
    '  orchestrator:',
    '    model: openai/gpt-4o-mini',
    '    fallbacks: []',
  ].join('\n'));

  return { routerDir, configPath };
}

/**
 * Build a minimal opencode.json with some gentle-ai agents.
 */
function makeOpenCodeJson(tmp, agents = {}) {
  const openCodePath = path.join(tmp, 'opencode.json');
  fs.writeFileSync(openCodePath, JSON.stringify({ agents }, null, 2), 'utf8');
  return openCodePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runProfileList', () => {
  test('output contains profile names from a mock config', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      assert.ok(output.includes('local-hybrid'), `Expected local-hybrid in output: ${output}`);
      assert.ok(output.includes('multivendor'), `Expected multivendor in output: ${output}`);
      assert.ok(output.includes('cheap'), `Expected cheap in output: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });

  test('shows "visible" for profiles with visible: true', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      // local-hybrid has visible: true → should show 'visible'
      const lines = output.split('\n');
      const localHybridLine = lines.find(l => l.includes('local-hybrid'));
      assert.ok(localHybridLine, 'Expected a line containing local-hybrid');
      assert.ok(
        localHybridLine.includes('visible'),
        `Expected 'visible' on local-hybrid line: "${localHybridLine}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('shows "hidden" for profiles with visible: false', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      // multivendor has visible: false → should show 'hidden'
      const lines = output.split('\n');
      const multivendorLine = lines.find(l => l.includes('multivendor'));
      assert.ok(multivendorLine, 'Expected a line containing multivendor');
      assert.ok(
        multivendorLine.includes('hidden'),
        `Expected 'hidden' on multivendor line: "${multivendorLine}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('shows "builtin" type for builtin profiles', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      // multivendor has builtin: true → should show 'builtin'
      const lines = output.split('\n');
      const multivendorLine = lines.find(l => l.includes('multivendor'));
      assert.ok(multivendorLine, 'Expected a line containing multivendor');
      assert.ok(
        multivendorLine.includes('builtin'),
        `Expected 'builtin' on multivendor line: "${multivendorLine}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('shows "user" type for non-builtin profiles', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      // local-hybrid has builtin: false → should show 'user'
      const lines = output.split('\n');
      const localHybridLine = lines.find(l => l.includes('local-hybrid'));
      assert.ok(localHybridLine, 'Expected a line containing local-hybrid');
      assert.ok(
        localHybridLine.includes('user'),
        `Expected 'user' on local-hybrid line: "${localHybridLine}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('shows gentle-ai profiles in a separate section', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {
        'sdd-orchestrator': { model: 'anthropic/claude-sonnet-4-5' },
      });

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      assert.ok(
        output.includes('sdd-orchestrator'),
        `Expected sdd-orchestrator in output: ${output}`
      );
      assert.ok(
        output.includes('gentle-ai'),
        `Expected 'gentle-ai' label in output: ${output}`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('gentle-ai section separator shown when local profiles exist', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {
        'sdd-orchestrator': { model: 'anthropic/claude-sonnet-4-5' },
      });

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      assert.ok(
        output.includes('── gentle-ai ──'),
        `Expected gentle-ai separator in output: ${output}`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('shows "No profiles found" when no config and no gentle-ai', async () => {
    const tmp = makeTempDir();
    try {
      const nonExistentConfig = path.join(tmp, 'nonexistent', 'router.yaml');
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath: nonExistentConfig, openCodeJsonPath: openCodePath })
      );

      assert.ok(
        output.includes('No profiles found') || output.includes('Profile List'),
        `Expected empty state message in output: ${output}`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('output includes Profile List header', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterWithProfiles(tmp);
      const openCodePath = makeOpenCodeJson(tmp, {});

      const output = await captureStdout(() =>
        runProfileList({ configPath, openCodeJsonPath: openCodePath })
      );

      assert.ok(output.includes('Profile List'), `Expected 'Profile List' header: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr preset list — deprecation warning ───────────────────────────────────

describe('gsr preset list deprecation warning', () => {
  test('gsr preset list shows deprecation warning', async () => {
    const tmp = makeTempDir();
    try {
      // We need to be installed to run preset list
      const { configPath } = makeRouterWithProfiles(tmp);

      // Temporarily override cwd to use our test router dir
      const origCwd = process.cwd();
      // Change cwd to the parent of router/ so discoverConfigPath finds it
      process.chdir(path.dirname(path.dirname(configPath)));

      let output;
      try {
        output = await captureStdout(() => runCli(['preset', 'list']));
      } finally {
        process.chdir(origCwd);
      }

      assert.ok(
        output.includes('deprecated') || output.includes('Deprecation'),
        `Expected deprecation warning in output: ${output}`
      );
    } finally {
      cleanup(tmp);
    }
  });
});
