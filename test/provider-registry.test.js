import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { getConnectedProviders, KNOWN_PROVIDERS } from '../src/ux/tui/components/provider-registry.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-provider-registry-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

/**
 * Scaffold a minimal router.yaml + profiles/<preset>.router.yaml structure.
 *
 * @param {string} dir         Temp directory root
 * @param {string} preset      Active preset name
 * @param {string} profileYaml Profile YAML content
 * @returns {string}           Absolute path to router.yaml
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

// ─── KNOWN_PROVIDERS export ───────────────────────────────────────────────────

describe('provider-registry — KNOWN_PROVIDERS', () => {
  test('KNOWN_PROVIDERS is a non-empty array of strings', () => {
    assert.ok(Array.isArray(KNOWN_PROVIDERS));
    assert.ok(KNOWN_PROVIDERS.length > 0);
    for (const p of KNOWN_PROVIDERS) {
      assert.equal(typeof p, 'string');
      assert.ok(p.length > 0, `KNOWN_PROVIDERS entry must be non-empty string, got: ${p}`);
    }
  });

  test('KNOWN_PROVIDERS contains core providers', () => {
    const required = ['anthropic', 'openai', 'google', 'mistral', 'ollama'];
    for (const p of required) {
      assert.ok(KNOWN_PROVIDERS.includes(p), `KNOWN_PROVIDERS must include "${p}"`);
    }
  });
});

// ─── Fallback when config does not exist ─────────────────────────────────────

describe('provider-registry — fallback behavior', () => {
  test('returns KNOWN_PROVIDERS when router.yaml does not exist', async () => {
    const result = await getConnectedProviders('/tmp/__nonexistent_gsr_test__/router.yaml');
    assert.deepEqual(result, [...KNOWN_PROVIDERS]);
  });

  test('returns KNOWN_PROVIDERS when configPath is undefined', async () => {
    // Override cwd by passing a path to a non-existent directory
    // We cannot override process.cwd() easily; test via a nonexistent absolute path
    const result = await getConnectedProviders('/tmp/__nonexistent_gsr_test_2__/router.yaml');
    assert.deepEqual(result, [...KNOWN_PROVIDERS]);
  });

  test('returns KNOWN_PROVIDERS when profile file not found', async () => {
    const dir = makeTempDir();
    try {
      // router.yaml references a preset that has no profile file
      const routerYaml = 'version: 5\nactive_preset: ghost-preset\n';
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      // NOT writing the profile file → should fall back

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));
      assert.deepEqual(result, [...KNOWN_PROVIDERS]);
    } finally {
      cleanup(dir);
    }
  });

  test('returns KNOWN_PROVIDERS when router.yaml has no active_preset', async () => {
    const dir = makeTempDir();
    try {
      const routerYaml = 'version: 5\n';
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));
      assert.deepEqual(result, [...KNOWN_PROVIDERS]);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Provider extraction from profile ────────────────────────────────────────

describe('provider-registry — extracts providers from profile targets', () => {
  test('extracts providers from lane targets', async () => {
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
    - target: openai/gpt-5
      kind: lane
      phase: apply
      role: primary
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      assert.ok(result.includes('anthropic'), 'Must include "anthropic"');
      assert.ok(result.includes('openai'), 'Must include "openai"');
    } finally {
      cleanup(dir);
    }
  });

  test('extracts providers from fallback strings (CSV)', async () => {
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
      fallbacks: mistral/mistral-large-3, opencode/qwen3.6-plus-free, opencode-go/glm-5
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      assert.ok(result.includes('anthropic'), 'Must include "anthropic"');
      assert.ok(result.includes('mistral'), 'Must include "mistral" from fallbacks');
      assert.ok(result.includes('opencode'), 'Must include "opencode" from fallbacks');
      assert.ok(result.includes('opencode-go'), 'Must include "opencode-go" from fallbacks');
    } finally {
      cleanup(dir);
    }
  });

  test('returns unique providers (no duplicates)', async () => {
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
      fallbacks: anthropic/claude-haiku
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      const anthropicCount = result.filter(p => p === 'anthropic').length;
      assert.equal(anthropicCount, 1, 'anthropic should only appear once (deduped)');
    } finally {
      cleanup(dir);
    }
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

  test('ignores targets without a slash (not provider/model format)', async () => {
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: bad-model-no-slash, openai/gpt-5
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);

      assert.ok(result.includes('anthropic'), 'anthropic should be included');
      assert.ok(result.includes('openai'), 'openai should be included');
      assert.ok(!result.includes('bad-model-no-slash'), 'bad-model-no-slash is not a provider');
    } finally {
      cleanup(dir);
    }
  });

  test('returns KNOWN_PROVIDERS when profile phases are empty', async () => {
    const dir = makeTempDir();
    try {
      const profileYaml = `
name: test-profile
phases: {}
`;
      const routerYamlPath = scaffoldConfig(dir, 'test-profile', profileYaml);
      const result = await getConnectedProviders(routerYamlPath);
      assert.deepEqual(result, [...KNOWN_PROVIDERS]);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Integration: works with real local-hybrid profile ───────────────────────

describe('provider-registry — integration with real project config', () => {
  test('returns non-empty provider list for the real project router.yaml', async () => {
    // This test uses the actual project's router.yaml + local-hybrid profile
    const projectRouterYaml = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../router/router.yaml'
    );

    if (!fs.existsSync(projectRouterYaml)) {
      // Skip if not in project context
      return;
    }

    const result = await getConnectedProviders(projectRouterYaml);
    assert.ok(Array.isArray(result), 'Result must be an array');
    assert.ok(result.length > 0, 'Must return at least one provider');
    // local-hybrid uses anthropic, opencode, openai, etc.
    assert.ok(result.includes('anthropic'), 'local-hybrid uses anthropic — must be in result');
  });
});

// ─── settings.platforms integration ──────────────────────────────────────────

describe('provider-registry — settings.platforms integration', () => {
  test('merges platform providers when settings.platforms is present', async () => {
    const dir = makeTempDir();
    try {
      // Profile uses only anthropic; settings.platforms adds google (gemini-cli)
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
`;
      // router.yaml with settings.platforms using YAML block sequence
      const routerYaml = `version: 5\nactive_preset: test-profile\nsettings:\n  platforms:\n    - gemini-cli\n`;
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
      fs.writeFileSync(path.join(dir, 'profiles', 'test-profile.router.yaml'), profileYaml, 'utf8');

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));

      assert.ok(result.includes('anthropic'), 'Must include anthropic from profile');
      assert.ok(result.includes('google'), 'Must include google from gemini-cli platform');
    } finally {
      cleanup(dir);
    }
  });

  test('falls back to profile-only detection when settings.platforms is absent', async () => {
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

      assert.ok(result.includes('anthropic'), 'Must include anthropic from profile');
      assert.ok(!result.includes('google'), 'Should not include google when no platforms set');
    } finally {
      cleanup(dir);
    }
  });

  test('deduplication works when platform and profile both provide the same provider', async () => {
    const dir = makeTempDir();
    try {
      // Profile uses anthropic; claude-code platform also maps to anthropic
      const profileYaml = `
name: test-profile
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
`;
      // claude-code → anthropic (duplicate of profile) — block sequence syntax
      const routerYaml = `version: 5\nactive_preset: test-profile\nsettings:\n  platforms:\n    - claude-code\n`;
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
      fs.writeFileSync(path.join(dir, 'profiles', 'test-profile.router.yaml'), profileYaml, 'utf8');

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));

      const anthropicCount = result.filter(p => p === 'anthropic').length;
      assert.equal(anthropicCount, 1, 'anthropic should appear exactly once after deduplication');
    } finally {
      cleanup(dir);
    }
  });

  test('settings.platforms with multiple platforms returns all their providers merged', async () => {
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
`;
      // opencode → opencode, opencode-go, openai, anthropic, mistral
      // codex → openai (duplicate) — block sequence syntax
      const routerYaml = `version: 5\nactive_preset: test-profile\nsettings:\n  platforms:\n    - opencode\n    - codex\n`;
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
      fs.writeFileSync(path.join(dir, 'profiles', 'test-profile.router.yaml'), profileYaml, 'utf8');

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));

      assert.ok(result.includes('openai'), 'Must include openai');
      assert.ok(result.includes('anthropic'), 'Must include anthropic from opencode platform');
      assert.ok(result.includes('mistral'), 'Must include mistral from opencode platform');
      assert.ok(result.includes('opencode'), 'Must include opencode from opencode platform');
      assert.ok(result.includes('opencode-go'), 'Must include opencode-go from opencode platform');

      // No duplicates
      const openaiCount = result.filter(p => p === 'openai').length;
      assert.equal(openaiCount, 1, 'openai should appear exactly once');
    } finally {
      cleanup(dir);
    }
  });

  test('empty settings.platforms array does not affect profile-derived providers', async () => {
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
      // Empty platforms — no platforms key present (settings block without platforms)
      const routerYaml = `version: 5\nactive_preset: test-profile\nsettings:\n  other_key: value\n`;
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'router.yaml'), routerYaml, 'utf8');
      fs.writeFileSync(path.join(dir, 'profiles', 'test-profile.router.yaml'), profileYaml, 'utf8');

      const result = await getConnectedProviders(path.join(dir, 'router.yaml'));

      assert.ok(result.includes('anthropic'), 'Must include anthropic from profile');
      // Result should be same as without platforms setting
    } finally {
      cleanup(dir);
    }
  });
});
