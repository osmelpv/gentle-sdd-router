/**
 * Integration tests for `gsr identity show [--preset <name>]`
 *
 * Tests call the exported functions from cli.js and verify stdout output.
 *
 * Spec scenarios: T12
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach } from 'node:test';
import { runIdentityShow } from '../src/cli.js';
import { resetIdentityCache } from '../src/core/agent-identity.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-identity-test-'));
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

const ROUTER_YAML = `version: 4
active_catalog: default
active_preset: fast
activation_state: active
`;

const FAST_PROFILE_YAML = `name: fast
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

const SAFETY_PROFILE_YAML = `name: safety
identity:
  context: "Safety-focused agent context."
  inherit_agents_md: false
phases:
  orchestrator:
    - target: openai/gpt-4o
      phase: orchestrator
      role: primary
`;

// ── T12: gsr identity show outputs resolved layers ────────────────────────────

describe('runIdentityShow — T12: resolved identity output', () => {
  beforeEach(() => resetIdentityCache());

  test('T12: show with preset name outputs resolved prompt and layer breakdown', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'router.yaml', ROUTER_YAML);
      writeFile(dir, 'profiles/fast.router.yaml', FAST_PROFILE_YAML);

      const configPath = path.join(dir, 'router.yaml');

      const output = await captureStdout(async () => {
        await runIdentityShow(['--preset', 'fast'], { configPath, cwd: dir });
      });

      assert.ok(output.length > 0, 'output must not be empty');
      assert.ok(output.includes('fast'), 'output must mention the preset name');
      assert.ok(output.toLowerCase().includes('prompt') || output.toLowerCase().includes('identity') || output.includes('Sources:'), 'output must include identity/prompt info');
    } finally {
      cleanup(dir);
    }
  });

  test('T12: show with --preset includes layer breakdown', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'router.yaml', ROUTER_YAML);
      writeFile(dir, 'profiles/fast.router.yaml', FAST_PROFILE_YAML);

      const configPath = path.join(dir, 'router.yaml');

      const output = await captureStdout(async () => {
        await runIdentityShow(['--preset', 'fast'], { configPath, cwd: dir });
      });

      // Must show which layers contributed
      assert.ok(
        output.includes('Sources:') || output.includes('Layer') || output.includes('neutral') || output.includes('agents-md') || output.includes('gentle-ai'),
        `output must include layer info, got: "${output.slice(0, 200)}"`
      );
    } finally {
      cleanup(dir);
    }
  });

  test('T12: show with explicit identity context includes that context in output', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'router.yaml', ROUTER_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);

      const configPath = path.join(dir, 'router.yaml');

      const output = await captureStdout(async () => {
        await runIdentityShow(['--preset', 'safety'], { configPath, cwd: dir });
      });

      assert.ok(output.includes('Safety-focused agent context.'), 'resolved prompt must include the profile context');
    } finally {
      cleanup(dir);
    }
  });

  test('T12: show without --preset lists all enabled presets', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'router.yaml', ROUTER_YAML);
      writeFile(dir, 'profiles/fast.router.yaml', FAST_PROFILE_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);

      const configPath = path.join(dir, 'router.yaml');

      const output = await captureStdout(async () => {
        await runIdentityShow([], { configPath, cwd: dir });
      });

      assert.ok(output.includes('fast'), 'output must mention "fast" preset');
      assert.ok(output.includes('safety'), 'output must mention "safety" preset');
    } finally {
      cleanup(dir);
    }
  });

  test('T12: show for non-existent preset outputs an error message', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'router.yaml', ROUTER_YAML);
      writeFile(dir, 'profiles/fast.router.yaml', FAST_PROFILE_YAML);

      const configPath = path.join(dir, 'router.yaml');

      const output = await captureStdout(async () => {
        await runIdentityShow(['--preset', 'nonexistent'], { configPath, cwd: dir });
      });

      assert.ok(
        output.includes('nonexistent') || output.toLowerCase().includes('not found'),
        `output must mention the unknown preset, got: "${output.slice(0, 200)}"`
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ── router-config.js re-exports ───────────────────────────────────────────────

describe('router-config.js re-exports agent identity', () => {
  test('resolveIdentity is exported from router-config.js', async () => {
    const mod = await import('../src/router-config.js');
    assert.equal(typeof mod.resolveIdentity, 'function', 'resolveIdentity must be re-exported');
  });

  test('resetIdentityCache is exported from router-config.js', async () => {
    const mod = await import('../src/router-config.js');
    assert.equal(typeof mod.resetIdentityCache, 'function', 'resetIdentityCache must be re-exported');
  });
});
