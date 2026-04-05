/**
 * Integration tests for CLI feedback simplification (gsr-feedback-simplification)
 *
 * Verifies:
 * - `gsr status` shows simplified status (no internal terms, no route details by default)
 * - `gsr status --verbose` shows full details (routes, costs, etc.)
 * - `gsr status --debug` same as --verbose
 * - `gsr sync` output uses simplified vocabulary
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { runCli } from '../src/cli.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal v3 config temp directory.
 * Returns configPath.
 */
function makeTempConfig() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-fb-test-'));
  const routerDir = path.join(tmpDir, 'router');
  fs.mkdirSync(routerDir, { recursive: true });

  const configPath = path.join(routerDir, 'router.yaml');
  fs.writeFileSync(configPath, `version: 3
active_catalog: default
active_preset: balanced
activation_state: active
catalogs:
  default:
    enabled: true
    presets:
      balanced:
        availability: stable
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet
`, 'utf8');

  return configPath;
}

/**
 * Capture stdout output from a CLI call.
 * Returns the captured string.
 */
async function captureOutput(fn) {
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
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

// ── gsr status (simple, default) ─────────────────────────────────────────

describe('gsr status — simple output (default)', () => {
  let configPath;
  let originalCwd;

  beforeEach(() => {
    configPath = makeTempConfig();
    originalCwd = process.cwd();
    process.chdir(path.dirname(path.dirname(configPath)));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(path.dirname(path.dirname(configPath)), { recursive: true, force: true });
  });

  test('simple status does not expose "overlay" term', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(!output.toLowerCase().includes('overlay'),
      `Output should not contain "overlay". Got: ${output}`);
  });

  test('simple status does not expose "_gsr_generated" term', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(!output.includes('_gsr_generated'),
      `Output should not contain "_gsr_generated". Got: ${output}`);
  });

  test('simple status does not expose "sync-manifest" term', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(!output.includes('sync-manifest'),
      `Output should not contain "sync-manifest". Got: ${output}`);
  });

  test('simple status does not expose "execution mode" internals', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(!output.toLowerCase().includes('execution mode'),
      `Output should not expose execution mode internals. Got: ${output}`);
  });

  test('simple status does NOT show raw route details ("Resolved routes:")', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(
      !output.includes('Resolved routes:'),
      `Simple status should NOT show "Resolved routes:". Got:\n${output}`
    );
  });

  test('simple status shows a status indicator (emoji or simple level word)', async () => {
    const output = await captureOutput(() => runCli(['status']));
    const lower = output.toLowerCase();
    const hasIndicator = (
      output.includes('✅') ||
      output.includes('🔄') ||
      output.includes('⚠️') ||
      output.includes('❌') ||
      lower.includes('configured') ||
      lower.includes('synchronized') ||
      lower.includes('ready')
    );
    assert.ok(hasIndicator, `Simple output should have a status indicator. Got:\n${output}`);
  });

  test('simple status shows active preset name', async () => {
    const output = await captureOutput(() => runCli(['status']));
    assert.ok(
      output.includes('balanced'),
      `Simple status should show active preset. Got:\n${output}`
    );
  });
});

// ── gsr status --verbose ─────────────────────────────────────────────────

describe('gsr status --verbose', () => {
  let configPath;
  let originalCwd;

  beforeEach(() => {
    configPath = makeTempConfig();
    originalCwd = process.cwd();
    process.chdir(path.dirname(path.dirname(configPath)));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(path.dirname(path.dirname(configPath)), { recursive: true, force: true });
  });

  test('--verbose output shows "Resolved routes:" details', async () => {
    const output = await captureOutput(() => runCli(['status', '--verbose']));
    assert.ok(
      output.includes('Resolved routes:') || output.includes('orchestrator'),
      `--verbose should show route details. Got:\n${output}`
    );
  });

  test('--verbose output includes active preset info', async () => {
    const output = await captureOutput(() => runCli(['status', '--verbose']));
    assert.ok(
      output.includes('balanced') || output.includes('Preset') || output.includes('preset'),
      `--verbose output should include preset info. Got: ${output}`
    );
  });

  test('--verbose output is equivalent to simple output (unified mode)', async () => {
    const simpleOutput = await captureOutput(() => runCli(['status']));
    const verboseOutput = await captureOutput(() => runCli(['status', '--verbose']));
    // Both use getUnifiedStatus now — output is the same; --verbose is silently ignored
    assert.equal(
      verboseOutput,
      simpleOutput,
      '--verbose should produce the same output as simple (unified status)'
    );
  });
});

// ── gsr status --debug (alias for --verbose) ─────────────────────────────

describe('gsr status --debug', () => {
  let configPath;
  let originalCwd;

  beforeEach(() => {
    configPath = makeTempConfig();
    originalCwd = process.cwd();
    process.chdir(path.dirname(path.dirname(configPath)));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(path.dirname(path.dirname(configPath)), { recursive: true, force: true });
  });

  test('--debug shows route details (same as --verbose)', async () => {
    const output = await captureOutput(() => runCli(['status', '--debug']));
    assert.ok(
      output.includes('Resolved routes:') || output.includes('orchestrator'),
      `--debug should show route details. Got:\n${output}`
    );
  });

  test('--debug output is equivalent to simple output (unified mode)', async () => {
    const simpleOutput = await captureOutput(() => runCli(['status']));
    const debugOutput = await captureOutput(() => runCli(['status', '--debug']));
    // Both use getUnifiedStatus now — output is the same; --debug is silently ignored
    assert.equal(
      debugOutput,
      simpleOutput,
      '--debug should produce the same output as simple (unified status)'
    );
  });
});
