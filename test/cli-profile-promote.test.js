/**
 * Tests for `gsr profile promote` and `gsr profile demote` CLI commands.
 *
 * Focuses on the CLI contract:
 * - Usage errors (missing name → exit 1 + usage message)
 * - promote and demote are registered as valid profile subcommands
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { runCli } from '../src/cli.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-promote-test-'));
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

/**
 * Build a minimal v4 router directory.
 * Returns { routerDir, configPath }
 */
function makeRouterDir(tmp) {
  const routerDir = path.join(tmp, 'router');
  writeFile(routerDir, 'router.yaml', [
    'version: 4',
    'active_preset: my-profile',
  ].join('\n'));
  writeFile(routerDir, 'profiles/my-profile.router.yaml', [
    'name: my-profile',
    'sdd: agent-orchestrator',
    'visible: false',
    'builtin: false',
    'phases:',
    '  orchestrator:',
    '    model: anthropic/claude-sonnet',
    '    fallbacks: []',
  ].join('\n'));
  return { routerDir, configPath: path.join(routerDir, 'router.yaml') };
}

/**
 * Capture stderr output from a function that may call process.exit(1).
 * Patches process.stderr.write and intercepts process.exit.
 * Returns { stderr, exitCode }.
 */
async function captureStderrWithExit(fn) {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalExit = process.exit;
  const stderrChunks = [];
  let exitCode = null;

  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };

  // Replace process.exit with a throwing sentinel so we can catch it
  const EXIT_SENTINEL = Symbol('exit');
  process.exit = (code) => {
    exitCode = code;
    throw EXIT_SENTINEL;
  };

  try {
    await fn();
  } catch (e) {
    if (e !== EXIT_SENTINEL) throw e;
  } finally {
    process.stderr.write = originalStderrWrite;
    process.exit = originalExit;
  }

  return { stderr: stderrChunks.join(''), exitCode };
}

// ─── promote: missing name → exit 1 ──────────────────────────────────────────

describe('gsr profile promote — missing name', () => {
  test('exits 1 when no name is given', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterDir(tmp);
      const origCwd = process.cwd();
      process.chdir(path.dirname(path.dirname(configPath)));

      let result;
      try {
        result = await captureStderrWithExit(() => runCli(['profile', 'promote']));
      } finally {
        process.chdir(origCwd);
      }

      assert.equal(result.exitCode, 1, `Expected exit code 1, got ${result.exitCode}`);
      assert.ok(
        result.stderr.includes('Usage') || result.stderr.includes('promote'),
        `Expected usage message in stderr: "${result.stderr}"`
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── demote: missing name → exit 1 ───────────────────────────────────────────

describe('gsr profile demote — missing name', () => {
  test('exits 1 when no name is given', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterDir(tmp);
      const origCwd = process.cwd();
      process.chdir(path.dirname(path.dirname(configPath)));

      let result;
      try {
        result = await captureStderrWithExit(() => runCli(['profile', 'demote']));
      } finally {
        process.chdir(origCwd);
      }

      assert.equal(result.exitCode, 1, `Expected exit code 1, got ${result.exitCode}`);
      assert.ok(
        result.stderr.includes('Usage') || result.stderr.includes('demote'),
        `Expected usage message in stderr: "${result.stderr}"`
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── promote / demote are valid subcommands ───────────────────────────────────

describe('gsr profile — promote and demote are registered subcommands', () => {
  test('promote is a known subcommand (does not throw "Unknown preset command")', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterDir(tmp);
      const origCwd = process.cwd();
      process.chdir(path.dirname(path.dirname(configPath)));

      // We call with a name that doesn't exist — should get a "not found" error
      // NOT "Unknown preset command: promote"
      let caughtError = null;
      let stderrOutput = '';
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const originalExit = process.exit;
      process.stderr.write = (chunk) => { stderrOutput += String(chunk); return true; };
      process.exit = () => { throw Object.assign(new Error('exit'), { isExit: true }); };

      try {
        await runCli(['profile', 'promote', 'nonexistent-profile-xyz']);
      } catch (e) {
        caughtError = e;
      } finally {
        process.stderr.write = originalStderrWrite;
        process.exit = originalExit;
        process.chdir(origCwd);
      }

      // Should NOT say "Unknown preset command"
      if (caughtError && !caughtError.isExit) {
        assert.ok(
          !caughtError.message.includes('Unknown preset command'),
          `Expected promote to be a known subcommand, got: ${caughtError.message}`
        );
      }
      assert.ok(
        !stderrOutput.includes('Unknown preset command'),
        `Expected promote to be a known subcommand, stderr: "${stderrOutput}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('demote is a known subcommand (does not throw "Unknown preset command")', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeRouterDir(tmp);
      const origCwd = process.cwd();
      process.chdir(path.dirname(path.dirname(configPath)));

      let caughtError = null;
      let stderrOutput = '';
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const originalExit = process.exit;
      process.stderr.write = (chunk) => { stderrOutput += String(chunk); return true; };
      process.exit = () => { throw Object.assign(new Error('exit'), { isExit: true }); };

      try {
        await runCli(['profile', 'demote', 'nonexistent-profile-xyz']);
      } catch (e) {
        caughtError = e;
      } finally {
        process.stderr.write = originalStderrWrite;
        process.exit = originalExit;
        process.chdir(origCwd);
      }

      if (caughtError && !caughtError.isExit) {
        assert.ok(
          !caughtError.message.includes('Unknown preset command'),
          `Expected demote to be a known subcommand, got: ${caughtError.message}`
        );
      }
      assert.ok(
        !stderrOutput.includes('Unknown preset command'),
        `Expected demote to be a known subcommand, stderr: "${stderrOutput}"`
      );
    } finally {
      cleanup(tmp);
    }
  });
});
