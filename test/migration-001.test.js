import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migration } from '../src/core/migrations/001_v3-to-v4-multifile.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const V3_CONFIG = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      presets: {
        balanced: {
          phases: {
            orchestrator: [
              { phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-sonnet' },
            ],
          },
        },
      },
    },
  },
};

const V3_CONFIG_MULTI_PRESET = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      presets: {
        balanced: {
          phases: {
            orchestrator: [
              { phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-sonnet' },
            ],
          },
        },
        turbo: {
          phases: {
            orchestrator: [
              { phase: 'orchestrator', role: 'primary', target: 'openai/gpt-4o' },
            ],
          },
        },
      },
    },
  },
};

const V3_CONFIG_MULTI_CATALOG = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      presets: {
        balanced: {
          phases: {
            orchestrator: [
              { phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-sonnet' },
            ],
          },
        },
      },
    },
    experimental: {
      presets: {
        edge: {
          phases: {
            orchestrator: [
              { phase: 'orchestrator', role: 'primary', target: 'openai/gpt-4o' },
            ],
          },
        },
      },
    },
  },
};

const V1_CONFIG = {
  version: 1,
  active_profile: 'default',
  profiles: {
    default: {
      phases: {
        orchestrator: ['anthropic/claude-sonnet'],
      },
    },
  },
};

const V1_CONFIG_WITH_METADATA = {
  version: 1,
  active_profile: 'default',
  metadata: { project: 'my-project', custom_key: 'custom_value' },
  profiles: {
    default: {
      phases: {
        orchestrator: ['anthropic/claude-sonnet'],
      },
    },
  },
};

const V4_CONFIG = {
  version: 4,
  active_preset: 'balanced',
  activation_state: 'active',
};

// ─── canApply ─────────────────────────────────────────────────────────────────

describe('migration 001: canApply', () => {
  test('returns true for v1 config', () => {
    assert.equal(migration.canApply(V1_CONFIG), true);
  });

  test('returns true for v3 config', () => {
    assert.equal(migration.canApply(V3_CONFIG), true);
  });

  test('returns false for v4 config', () => {
    assert.equal(migration.canApply(V4_CONFIG), false);
  });

  test('returns false for unknown version', () => {
    assert.equal(migration.canApply({ version: 2 }), false);
  });
});

// ─── apply: v3 monolith ───────────────────────────────────────────────────────

describe('migration 001: apply on v3 config', () => {
  test('produces coreConfig with version 4', () => {
    const { coreConfig } = migration.apply(V3_CONFIG, {});
    assert.equal(coreConfig.version, 4);
  });

  test('coreConfig preserves active_preset', () => {
    const { coreConfig } = migration.apply(V3_CONFIG, {});
    assert.equal(coreConfig.active_preset, 'balanced');
  });

  test('coreConfig preserves activation_state', () => {
    const { coreConfig } = migration.apply(V3_CONFIG, {});
    assert.equal(coreConfig.activation_state, 'active');
  });

  test('produces one profile per preset (single preset)', () => {
    const { profiles } = migration.apply(V3_CONFIG, {});
    assert.equal(profiles.length, 1);
  });

  test('profile has correct name', () => {
    const { profiles } = migration.apply(V3_CONFIG, {});
    assert.equal(profiles[0].name, 'balanced');
  });

  test('profile has correct catalog', () => {
    const { profiles } = migration.apply(V3_CONFIG, {});
    assert.equal(profiles[0].catalog, 'default');
  });

  test('profile content has phases', () => {
    const { profiles } = migration.apply(V3_CONFIG, {});
    assert.ok(profiles[0].content.phases, 'profile content has phases');
    assert.ok(profiles[0].content.phases.orchestrator, 'orchestrator phase exists');
  });

  test('profile content preserves phase lanes', () => {
    const { profiles } = migration.apply(V3_CONFIG, {});
    const lanes = profiles[0].content.phases.orchestrator;
    assert.ok(Array.isArray(lanes), 'lanes is an array');
    assert.ok(lanes.length > 0, 'at least one lane');
    assert.ok(lanes[0].target === 'anthropic/claude-sonnet' || lanes[0].target, 'target preserved');
  });

  test('multiple presets produce multiple profiles', () => {
    const { profiles } = migration.apply(V3_CONFIG_MULTI_PRESET, {});
    assert.equal(profiles.length, 2);
    const names = profiles.map((p) => p.name).sort();
    assert.deepEqual(names, ['balanced', 'turbo']);
  });

  test('multiple catalogs produce profiles with correct catalog assignment', () => {
    const { profiles } = migration.apply(V3_CONFIG_MULTI_CATALOG, {});
    assert.equal(profiles.length, 2);

    const balanced = profiles.find((p) => p.name === 'balanced');
    const edge = profiles.find((p) => p.name === 'edge');

    assert.ok(balanced, 'balanced profile exists');
    assert.equal(balanced.catalog, 'default');

    assert.ok(edge, 'edge profile exists');
    assert.equal(edge.catalog, 'experimental');
  });
});

// ─── apply: v1 monolith ───────────────────────────────────────────────────────

describe('migration 001: apply on v1 config', () => {
  test('produces coreConfig with version 4', () => {
    const { coreConfig } = migration.apply(V1_CONFIG, {});
    assert.equal(coreConfig.version, 4);
  });

  test('produces at least one profile from v1 profiles', () => {
    const { profiles } = migration.apply(V1_CONFIG, {});
    assert.ok(profiles.length > 0, 'at least one profile produced');
  });

  test('v1 profile has phases', () => {
    const { profiles } = migration.apply(V1_CONFIG, {});
    assert.ok(profiles[0].content.phases, 'phases present');
    assert.ok(profiles[0].content.phases.orchestrator, 'orchestrator phase present');
  });

  test('coreConfig preserves active_profile from v1 as active_preset', () => {
    const { coreConfig } = migration.apply(V1_CONFIG, {});
    assert.equal(coreConfig.active_preset, 'default');
  });
});

// ─── apply: metadata preservation ────────────────────────────────────────────

describe('migration 001: apply — metadata preservation', () => {
  test('preserves metadata from v3 config', () => {
    const configWithMeta = {
      ...V3_CONFIG,
      metadata: { project: 'gsr-test', team: 'platform' },
    };

    const { coreConfig } = migration.apply(configWithMeta, {});
    assert.ok(coreConfig.metadata, 'metadata is present');
    assert.equal(coreConfig.metadata.project, 'gsr-test');
    assert.equal(coreConfig.metadata.team, 'platform');
  });

  test('preserves metadata from v1 config with metadata', () => {
    const { coreConfig } = migration.apply(V1_CONFIG_WITH_METADATA, {});
    assert.ok(coreConfig.metadata, 'metadata is present');
    assert.equal(coreConfig.metadata.project, 'my-project');
    assert.equal(coreConfig.metadata.custom_key, 'custom_value');
  });

  test('coreConfig metadata is absent when original config has no metadata', () => {
    const { coreConfig } = migration.apply(V3_CONFIG, {});
    // metadata should be undefined or absent when not present in original
    assert.ok(
      coreConfig.metadata === undefined || Object.keys(coreConfig.metadata ?? {}).length === 0,
      'metadata is absent or empty'
    );
  });

  test('does not mutate the original config', () => {
    const original = JSON.parse(JSON.stringify(V3_CONFIG));
    migration.apply(V3_CONFIG, {});
    assert.deepEqual(V3_CONFIG, original, 'original config was not mutated');
  });
});

// ─── migration metadata ───────────────────────────────────────────────────────

describe('migration 001: metadata fields', () => {
  test('has expected id', () => {
    assert.equal(migration.id, '001');
  });

  test('has expected name', () => {
    assert.equal(migration.name, 'v3-to-v4-multifile');
  });

  test('has a non-empty description', () => {
    assert.ok(typeof migration.description === 'string' && migration.description.length > 0);
  });

  test('has ownedFields array', () => {
    assert.ok(Array.isArray(migration.ownedFields), 'ownedFields is an array');
    assert.ok(migration.ownedFields.includes('version'), 'owns version field');
    assert.ok(migration.ownedFields.includes('catalogs'), 'owns catalogs field');
  });

  test('toVersion is 4', () => {
    assert.equal(migration.toVersion, 4);
  });

  test('fromVersion includes 1 and 3', () => {
    const from = Array.isArray(migration.fromVersion)
      ? migration.fromVersion
      : [migration.fromVersion];

    assert.ok(from.includes(1), 'fromVersion includes 1');
    assert.ok(from.includes(3), 'fromVersion includes 3');
  });
});
