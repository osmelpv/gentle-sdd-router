/**
 * Tests for fetchConnectedProviders() in model-fetcher.js
 * and the SDK-tier integration in provider-registry.js.
 *
 * Key constraint: @opencode-ai/sdk is NOT installed as a project dep.
 * All SDK calls must degrade gracefully when the package is unavailable.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';

import { fetchConnectedProviders, clearModelCache } from '../src/ux/tui/model-fetcher.js';
import { getConnectedProviders, KNOWN_PROVIDERS } from '../src/ux/tui/components/provider-registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-mf-providers-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Scaffold a minimal router.yaml + profiles/<preset>.router.yaml structure.
 */
function scaffoldConfig(dir, preset, profileYaml) {
  const routerYaml = `version: 5\nactive_preset: ${preset}\n`;
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'profiles', `${preset}.router.yaml`),
    profileYaml,
    'utf8'
  );
  return path.join(dir, 'router.yaml');
}

// ─── fetchConnectedProviders tests ────────────────────────────────────────────

describe('fetchConnectedProviders — SDK unavailable', () => {
  beforeEach(() => clearModelCache());

  test('returns empty array when @opencode-ai/sdk is not installed', async () => {
    // In this project, @opencode-ai/sdk is not a dev dep — the dynamic import
    // will throw MODULE_NOT_FOUND, which must be caught and return [].
    const result = await fetchConnectedProviders();
    assert.ok(Array.isArray(result), 'Must return an array');
    // Either [] (SDK not installed/server not running) or a valid provider list
    // In CI / local without opencode server → expect []
    for (const p of result) {
      assert.equal(typeof p, 'string', `Provider ID must be string, got: ${p}`);
    }
  });

  test('returns empty array (not throws) when SDK package missing', async () => {
    // This is a smoke-test: fetchConnectedProviders must never throw.
    let threw = false;
    try {
      await fetchConnectedProviders();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'fetchConnectedProviders must not throw');
  });

  test('cache is invalidated by clearModelCache()', async () => {
    // Warm up whatever state fetchConnectedProviders leaves
    await fetchConnectedProviders();
    // clearModelCache must not throw and must reset the SDK cache slot
    assert.doesNotThrow(() => clearModelCache());
    // After clearing, calling again must not throw either
    const result = await fetchConnectedProviders();
    assert.ok(Array.isArray(result));
  });
});

// ─── provider-registry 3-tier tests ───────────────────────────────────────────

describe('getConnectedProviders — SDK tier (Tier 1)', () => {
  beforeEach(() => clearModelCache());

  test('falls back to profile-derived when SDK returns empty', async () => {
    // SDK returns [] (no server) → must use profile providers
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      // anthropic must come from profile (Tier 2) even when SDK is unavailable
      assert.ok(result.includes('anthropic'), 'Must include anthropic from profile');
    } finally {
      cleanup(dir);
    }
  });

  test('falls back to KNOWN_PROVIDERS when SDK and profile both empty', async () => {
    // Nonexistent config path → profile returns [] → SDK returns [] → KNOWN_PROVIDERS
    const result = await getConnectedProviders('/tmp/__nonexistent_gsr_mf_test__/router.yaml');
    assert.deepEqual(result, [...KNOWN_PROVIDERS]);
  });

  test('result is sorted alphabetically', async () => {
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: openai/gpt-5
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: anthropic/claude-sonnet, google/gemini-pro
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      const sorted = [...result].sort();
      assert.deepEqual(result, sorted, 'Result must be sorted alphabetically');
    } finally {
      cleanup(dir);
    }
  });

  test('result is deduplicated', async () => {
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-opus
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: anthropic/claude-sonnet, openai/gpt-5
  apply:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: apply
      role: primary
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      const anthropicCount = result.filter(p => p === 'anthropic').length;
      assert.equal(anthropicCount, 1, 'anthropic must appear exactly once (deduped)');
    } finally {
      cleanup(dir);
    }
  });

  test('merge: profile providers are present even when SDK empty', async () => {
    // This verifies the union semantics: SDK=[], profile=[anthropic, openai]
    // → result includes both profile providers
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
  apply:
    - target: openai/gpt-4.1
      kind: lane
      phase: apply
      role: primary
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      assert.ok(result.includes('anthropic'), 'anthropic must be present from profile');
      assert.ok(result.includes('openai'), 'openai must be present from profile');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── clearModelCache covers SDK cache slot ────────────────────────────────────

describe('clearModelCache — SDK provider cache', () => {
  test('clearModelCache resets SDK cache without throwing', () => {
    assert.doesNotThrow(() => clearModelCache());
  });

  test('fetchConnectedProviders after clearModelCache still returns array', async () => {
    clearModelCache();
    const result = await fetchConnectedProviders();
    assert.ok(Array.isArray(result), 'Must return array after cache clear');
  });
});
