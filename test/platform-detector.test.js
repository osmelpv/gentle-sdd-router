import assert from 'node:assert/strict';
import { describe, test, mock, beforeEach, afterEach } from 'node:test';
import os from 'node:os';

// We need to mock fs.existsSync before importing the module.
// Use node:test's mock.module approach via dynamic import after mock setup.

// ─── Direct unit tests (no fs mock needed) ───────────────────────────────────

import {
  PLATFORMS,
  getProvidersForPlatforms,
  detectInstalledPlatforms,
} from '../src/ux/tui/platform-detector.js';

describe('platform-detector — PLATFORMS array', () => {
  test('has exactly 8 entries', () => {
    assert.equal(PLATFORMS.length, 8);
  });

  test('each entry has id, label, detectPath, and providers', () => {
    for (const platform of PLATFORMS) {
      assert.equal(typeof platform.id, 'string', `platform.id must be string: ${JSON.stringify(platform)}`);
      assert.ok(platform.id.length > 0, `platform.id must not be empty`);

      assert.equal(typeof platform.label, 'string', `platform.label must be string for id=${platform.id}`);
      assert.ok(platform.label.length > 0, `platform.label must not be empty for id=${platform.id}`);

      assert.equal(typeof platform.detectPath, 'string', `platform.detectPath must be string for id=${platform.id}`);
      assert.ok(platform.detectPath.length > 0, `platform.detectPath must not be empty for id=${platform.id}`);

      assert.ok(Array.isArray(platform.providers), `platform.providers must be array for id=${platform.id}`);
      assert.ok(platform.providers.length > 0, `platform.providers must be non-empty for id=${platform.id}`);
    }
  });

  test('all 8 known platform IDs are present', () => {
    const expectedIds = [
      'claude-code',
      'opencode',
      'gemini-cli',
      'cursor',
      'vscode-copilot',
      'codex',
      'windsurf',
      'antigravity',
    ];
    const actualIds = PLATFORMS.map(p => p.id);
    for (const id of expectedIds) {
      assert.ok(actualIds.includes(id), `Expected platform id "${id}" to be in PLATFORMS`);
    }
  });

  test('all detectPath entries start with ~/  (home-relative)', () => {
    for (const p of PLATFORMS) {
      assert.ok(
        p.detectPath.startsWith('~/'),
        `Expected detectPath to start with ~/ for platform "${p.id}", got: ${p.detectPath}`
      );
    }
  });

  test('providers arrays contain only non-empty strings', () => {
    for (const p of PLATFORMS) {
      for (const provider of p.providers) {
        assert.equal(typeof provider, 'string', `Provider in ${p.id} must be string`);
        assert.ok(provider.length > 0, `Provider in ${p.id} must not be empty`);
      }
    }
  });
});

// ─── getProvidersForPlatforms ─────────────────────────────────────────────────

describe('platform-detector — getProvidersForPlatforms', () => {
  test('returns correct unique providers for opencode + claude-code', () => {
    const result = getProvidersForPlatforms(['opencode', 'claude-code']);
    // opencode providers: opencode, opencode-go, openai, anthropic, mistral
    // claude-code providers: anthropic
    // Merged unique: anthropic, mistral, openai, opencode, opencode-go
    assert.ok(result.includes('anthropic'), 'Must include anthropic');
    assert.ok(result.includes('opencode'), 'Must include opencode');
    assert.ok(result.includes('opencode-go'), 'Must include opencode-go');
    assert.ok(result.includes('openai'), 'Must include openai');
    assert.ok(result.includes('mistral'), 'Must include mistral');
  });

  test('deduplicates providers across platforms', () => {
    // Both opencode and claude-code include 'anthropic'
    const result = getProvidersForPlatforms(['opencode', 'claude-code']);
    const anthropicCount = result.filter(p => p === 'anthropic').length;
    assert.equal(anthropicCount, 1, 'anthropic should appear exactly once');
  });

  test('returns sorted array', () => {
    const result = getProvidersForPlatforms(['opencode', 'claude-code', 'cursor']);
    const sorted = [...result].sort();
    assert.deepEqual(result, sorted, 'Result must be sorted alphabetically');
  });

  test('returns empty array for unknown platform IDs', () => {
    const result = getProvidersForPlatforms(['nonexistent-platform']);
    assert.deepEqual(result, []);
  });

  test('returns empty array for empty input', () => {
    const result = getProvidersForPlatforms([]);
    assert.deepEqual(result, []);
  });

  test('returns only google for gemini-cli', () => {
    const result = getProvidersForPlatforms(['gemini-cli']);
    assert.deepEqual(result, ['google']);
  });

  test('returns only openai for codex', () => {
    const result = getProvidersForPlatforms(['codex']);
    assert.deepEqual(result, ['openai']);
  });

  test('returns anthropic + google + openai for windsurf', () => {
    const result = getProvidersForPlatforms(['windsurf']);
    assert.ok(result.includes('anthropic'), 'windsurf needs anthropic');
    assert.ok(result.includes('openai'), 'windsurf needs openai');
    assert.ok(result.includes('google'), 'windsurf needs google');
    assert.equal(result.length, 3);
  });
});

// ─── detectInstalledPlatforms — uses real fs ──────────────────────────────────

describe('platform-detector — detectInstalledPlatforms (real fs)', () => {
  test('returns an array', () => {
    const result = detectInstalledPlatforms();
    assert.ok(Array.isArray(result), 'detectInstalledPlatforms must return an array');
  });

  test('all returned IDs are valid platform IDs', () => {
    const validIds = new Set(PLATFORMS.map(p => p.id));
    const result = detectInstalledPlatforms();
    for (const id of result) {
      assert.ok(validIds.has(id), `Returned ID "${id}" is not a known platform ID`);
    }
  });

  test('only returns platforms whose path exists', async () => {
    // We cannot mock fs.existsSync in ESM after-the-fact easily,
    // but we can verify invariant: each returned ID's resolved path must exist
    const result = detectInstalledPlatforms();
    const home = os.homedir();
    const { existsSync } = await import('node:fs');

    for (const id of result) {
      const platform = PLATFORMS.find(p => p.id === id);
      const resolved = platform.detectPath.replace('~', home);
      // If detectInstalledPlatforms says it's installed, the path must exist
      assert.ok(existsSync(resolved), `Platform "${id}" was detected but path does not exist: ${resolved}`);
    }
  });
});
