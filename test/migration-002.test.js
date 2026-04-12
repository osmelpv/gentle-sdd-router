import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migration } from '../src/core/migrations/002_profile-schema-simplification.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A v4 core config with active_preset (legacy field — migration should apply).
 */
const CORE_WITH_ACTIVE_PRESET = {
  version: 4,
  active_preset: 'multivendor',
  activation_state: 'active',
};

/**
 * A v4 core config without active_preset and no legacy array phases.
 * This represents an already-migrated config.
 */
const CORE_ALREADY_MIGRATED = {
  version: 4,
  activation_state: 'active',
};

/**
 * Profile with phases in OLD array format (array-of-lanes).
 */
const PROFILE_OLD_FORMAT = {
  name: 'multivendor',
  sdd: 'agent-orchestrator',
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'openai/gpt-5',
        inputPerMillion: 15,
        outputPerMillion: 75,
        contextWindow: 200000,
      },
    ],
    explore: [
      {
        target: 'google/gemini-pro',
        kind: 'lane',
        phase: 'explore',
        role: 'primary',
        fallbacks: 'anthropic/claude-sonnet',
        inputPerMillion: 1.25,
        outputPerMillion: 5,
        contextWindow: 2000000,
      },
    ],
  },
};

/**
 * Profile with phases in NEW object format (already migrated).
 */
const PROFILE_NEW_FORMAT = {
  name: 'simple',
  sdd: 'agent-orchestrator',
  phases: {
    orchestrator: { model: 'anthropic/claude-opus', fallbacks: ['openai/gpt-5'] },
    explore: { model: 'google/gemini-pro', fallbacks: ['anthropic/claude-sonnet'] },
  },
};

/**
 * Profile with debug_invoke.preset (old key).
 */
const PROFILE_WITH_DEBUG_PRESET = {
  name: 'local-hybrid',
  sdd: 'agent-orchestrator',
  debug_invoke: {
    preset: 'sdd-debug-mono',
    trigger: 'on_issues',
  },
  phases: {
    orchestrator: [
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: '',
      },
    ],
  },
};

/**
 * Profile with debug_invoke.preset that already has gsr- prefix.
 */
const PROFILE_WITH_GSR_DEBUG_PRESET = {
  name: 'another',
  sdd: 'agent-orchestrator',
  debug_invoke: {
    preset: 'gsr-sdd-debug-mono',
    trigger: 'on_issues',
  },
  phases: {
    orchestrator: [
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: '',
      },
    ],
  },
};

/**
 * sdd-debug profile — should go into invokeConfigs.
 */
const PROFILE_SDD_DEBUG = {
  name: 'sdd-debug-mono',
  sdd: 'sdd-debug',
  phases: {
    orchestrator: [
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'anthropic/claude-sonnet',
      },
    ],
  },
};

/**
 * sdd-debug profile identified by name prefix.
 */
const PROFILE_SDD_DEBUG_BY_NAME = {
  name: 'sdd-debug-multi',
  sdd: 'agent-orchestrator', // NOT sdd: 'sdd-debug' — but name starts with sdd-debug
  phases: {
    orchestrator: [
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: '',
      },
    ],
  },
};

/**
 * Profile with multiple fallbacks as a comma-separated string.
 */
const PROFILE_MULTI_FALLBACKS = {
  name: 'multi',
  sdd: 'agent-orchestrator',
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'anthropic/claude-sonnet, google/gemini-pro',
      },
    ],
  },
};

/**
 * Profile with empty fallbacks string.
 */
const PROFILE_EMPTY_FALLBACKS = {
  name: 'no-fallbacks',
  sdd: 'agent-orchestrator',
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: '',
      },
    ],
  },
};

/**
 * Profile where no lane has role: 'primary' — first element used.
 */
const PROFILE_NO_PRIMARY = {
  name: 'no-primary',
  sdd: 'agent-orchestrator',
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-haiku',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'secondary',
        fallbacks: '',
      },
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'judge',
        fallbacks: '',
      },
    ],
  },
};

/**
 * Profile that already has builtin: true set.
 */
const PROFILE_WITH_BUILTIN = {
  name: 'with-builtin',
  sdd: 'agent-orchestrator',
  builtin: true,
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: '',
      },
    ],
  },
};

// ─── canApply ─────────────────────────────────────────────────────────────────

describe('migration 002: canApply', () => {
  test('returns true when active_preset is present in core config', () => {
    assert.equal(
      migration.canApply(CORE_WITH_ACTIVE_PRESET, []),
      true
    );
  });

  test('returns true when a profile has a phase in old array format', () => {
    assert.equal(
      migration.canApply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]),
      true
    );
  });

  test('returns false when already migrated (no active_preset, all phases are objects)', () => {
    assert.equal(
      migration.canApply(CORE_ALREADY_MIGRATED, [PROFILE_NEW_FORMAT]),
      false
    );
  });

  test('returns false when profiles array is empty and no active_preset', () => {
    assert.equal(
      migration.canApply(CORE_ALREADY_MIGRATED, []),
      false
    );
  });

  test('returns false when active_preset is empty string', () => {
    assert.equal(
      migration.canApply({ version: 4, active_preset: '' }, []),
      false
    );
  });

  test('returns false when active_preset contains only whitespace', () => {
    assert.equal(
      migration.canApply({ version: 4, active_preset: '   ' }, []),
      false
    );
  });
});

// ─── apply: active_preset handling ───────────────────────────────────────────

describe('migration 002: apply — active_preset handling', () => {
  test('sets visible: true on profile matching active_preset', () => {
    const { profiles } = migration.apply(CORE_WITH_ACTIVE_PRESET, [PROFILE_OLD_FORMAT]);
    const p = profiles.find((p) => p.name === 'multivendor');
    assert.ok(p, 'multivendor profile found in output');
    assert.equal(p.content.visible, true);
  });

  test('removes active_preset from coreConfig', () => {
    const { coreConfig } = migration.apply(CORE_WITH_ACTIVE_PRESET, [PROFILE_OLD_FORMAT]);
    assert.ok(!('active_preset' in coreConfig), 'active_preset removed from coreConfig');
  });

  test('active_preset pointing to nonexistent profile: warns but does not throw', () => {
    const coreWithMissingPreset = { version: 4, active_preset: 'nonexistent', activation_state: 'active' };
    // Should not throw
    let result;
    assert.doesNotThrow(() => {
      result = migration.apply(coreWithMissingPreset, [PROFILE_OLD_FORMAT]);
    });
    // active_preset still removed from core
    assert.ok(!('active_preset' in result.coreConfig), 'active_preset removed even when profile not found');
  });
});

// ─── apply: active_catalog removal ───────────────────────────────────────────

describe('migration 002: apply — active_catalog removal', () => {
  test('removes active_catalog from coreConfig if present', () => {
    const coreWithCatalog = { version: 4, active_preset: 'multivendor', active_catalog: 'default', activation_state: 'active' };
    const { coreConfig } = migration.apply(coreWithCatalog, [PROFILE_OLD_FORMAT]);
    assert.ok(!('active_catalog' in coreConfig), 'active_catalog removed from coreConfig');
  });

  test('does not fail when active_catalog is absent', () => {
    const { coreConfig } = migration.apply(CORE_WITH_ACTIVE_PRESET, [PROFILE_OLD_FORMAT]);
    assert.ok(!('active_catalog' in coreConfig), 'active_catalog absent from output');
  });
});

// ─── apply: builtin field ─────────────────────────────────────────────────────

describe('migration 002: apply — builtin field', () => {
  test('adds builtin: true to profiles without it', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]);
    const p = profiles.find((p) => p.name === 'multivendor');
    assert.ok(p, 'multivendor found');
    assert.equal(p.content.builtin, true);
  });

  test('does not overwrite builtin if already set', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_WITH_BUILTIN]);
    const p = profiles.find((p) => p.name === 'with-builtin');
    assert.ok(p, 'with-builtin found');
    assert.equal(p.content.builtin, true); // preserved, not duplicated
  });
});

// ─── apply: phase array → object transformation ───────────────────────────────

describe('migration 002: apply — phase transformation', () => {
  test('transforms old array phase to {model, fallbacks} object', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]);
    const p = profiles.find((p) => p.name === 'multivendor');
    assert.ok(p, 'multivendor found');
    const orch = p.content.phases.orchestrator;
    assert.ok(!Array.isArray(orch), 'orchestrator phase is no longer an array');
    assert.equal(orch.model, 'anthropic/claude-opus');
  });

  test('primary lane target becomes model', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]);
    const p = profiles.find((p) => p.name === 'multivendor');
    assert.equal(p.content.phases.orchestrator.model, 'anthropic/claude-opus');
  });

  test('fallbacks string split into array', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_MULTI_FALLBACKS]);
    const p = profiles.find((p) => p.name === 'multi');
    const orch = p.content.phases.orchestrator;
    assert.deepEqual(orch.fallbacks, ['anthropic/claude-sonnet', 'google/gemini-pro']);
  });

  test('empty fallbacks string becomes empty array', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_EMPTY_FALLBACKS]);
    const p = profiles.find((p) => p.name === 'no-fallbacks');
    assert.deepEqual(p.content.phases.orchestrator.fallbacks, []);
  });

  test('when no lane has role:primary, first element target is used', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_NO_PRIMARY]);
    const p = profiles.find((p) => p.name === 'no-primary');
    assert.equal(p.content.phases.orchestrator.model, 'anthropic/claude-haiku');
  });

  test('strips kind, role, phase, inputPerMillion, outputPerMillion, contextWindow, aliases', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]);
    const p = profiles.find((p) => p.name === 'multivendor');
    const orch = p.content.phases.orchestrator;
    assert.ok(!('kind' in orch), 'kind stripped');
    assert.ok(!('role' in orch), 'role stripped');
    assert.ok(!('phase' in orch), 'phase stripped');
    assert.ok(!('inputPerMillion' in orch), 'inputPerMillion stripped');
    assert.ok(!('outputPerMillion' in orch), 'outputPerMillion stripped');
    assert.ok(!('contextWindow' in orch), 'contextWindow stripped');
  });

  test('phase already in new format is left unchanged', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_NEW_FORMAT]);
    const p = profiles.find((p) => p.name === 'simple');
    assert.ok(p, 'simple profile found');
    assert.deepEqual(p.content.phases.orchestrator, { model: 'anthropic/claude-opus', fallbacks: ['openai/gpt-5'] });
  });
});

// ─── apply: debug_invoke.preset → profile ────────────────────────────────────

describe('migration 002: apply — debug_invoke field rename', () => {
  test('renames debug_invoke.preset to debug_invoke.profile', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_WITH_DEBUG_PRESET]);
    const p = profiles.find((p) => p.name === 'local-hybrid');
    assert.ok(p, 'local-hybrid found');
    assert.ok(!('preset' in p.content.debug_invoke), 'preset key removed');
    assert.ok('profile' in p.content.debug_invoke, 'profile key present');
  });

  test('prepends gsr- to debug_invoke.profile value if not already prefixed', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_WITH_DEBUG_PRESET]);
    const p = profiles.find((p) => p.name === 'local-hybrid');
    assert.ok(p.content.debug_invoke.profile.startsWith('gsr-'), 'profile value has gsr- prefix');
    assert.equal(p.content.debug_invoke.profile, 'gsr-sdd-debug-mono');
  });

  test('does not double-prepend gsr- if value already has it', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_WITH_GSR_DEBUG_PRESET]);
    const p = profiles.find((p) => p.name === 'another');
    assert.equal(p.content.debug_invoke.profile, 'gsr-sdd-debug-mono');
  });
});

// ─── apply: sdd-debug profiles → invokeConfigs ───────────────────────────────

describe('migration 002: apply — sdd-debug profile separation', () => {
  test('sdd-debug profiles (sdd: sdd-debug) go to invokeConfigs, not profiles', () => {
    const { profiles, invokeConfigs } = migration.apply(CORE_ALREADY_MIGRATED, [
      PROFILE_OLD_FORMAT,
      PROFILE_SDD_DEBUG,
    ]);
    const profileNames = profiles.map((p) => p.name);
    const invokeNames = invokeConfigs.map((p) => p.name);
    assert.ok(!profileNames.includes('sdd-debug-mono'), 'sdd-debug-mono not in profiles');
    assert.ok(invokeNames.some((n) => n.includes('sdd-debug-mono')), 'sdd-debug-mono in invokeConfigs');
  });

  test('sdd-debug profiles by name prefix go to invokeConfigs', () => {
    const { profiles, invokeConfigs } = migration.apply(CORE_ALREADY_MIGRATED, [
      PROFILE_OLD_FORMAT,
      PROFILE_SDD_DEBUG_BY_NAME,
    ]);
    const profileNames = profiles.map((p) => p.name);
    const invokeNames = invokeConfigs.map((p) => p.name);
    assert.ok(!profileNames.includes('sdd-debug-multi'), 'sdd-debug-multi not in profiles');
    assert.ok(invokeNames.some((n) => n.includes('sdd-debug-multi')), 'sdd-debug-multi in invokeConfigs');
  });

  test('invokeConfig name gets gsr- prefix if not already present', () => {
    const { invokeConfigs } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_SDD_DEBUG]);
    assert.ok(invokeConfigs.length > 0, 'at least one invokeConfig');
    assert.ok(invokeConfigs[0].name.startsWith('gsr-'), 'invokeConfig name has gsr- prefix');
  });

  test('regular profiles stay in profiles array', () => {
    const { profiles } = migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT, PROFILE_SDD_DEBUG]);
    const profileNames = profiles.map((p) => p.name);
    assert.ok(profileNames.includes('multivendor'), 'multivendor in profiles');
  });
});

// ─── apply: immutability ─────────────────────────────────────────────────────

describe('migration 002: apply — immutability', () => {
  test('does not mutate the original coreConfig', () => {
    const original = JSON.parse(JSON.stringify(CORE_WITH_ACTIVE_PRESET));
    migration.apply(CORE_WITH_ACTIVE_PRESET, [PROFILE_OLD_FORMAT]);
    assert.deepEqual(CORE_WITH_ACTIVE_PRESET, original, 'coreConfig not mutated');
  });

  test('does not mutate the original profiles array', () => {
    const original = JSON.parse(JSON.stringify([PROFILE_OLD_FORMAT]));
    migration.apply(CORE_ALREADY_MIGRATED, [PROFILE_OLD_FORMAT]);
    assert.deepEqual([PROFILE_OLD_FORMAT], original, 'profiles array not mutated');
  });
});

// ─── migration metadata ───────────────────────────────────────────────────────

describe('migration 002: metadata fields', () => {
  test('has expected id', () => {
    assert.equal(migration.id, '002');
  });

  test('has expected name', () => {
    assert.equal(migration.name, 'profile-schema-simplification');
  });

  test('has a non-empty description', () => {
    assert.ok(typeof migration.description === 'string' && migration.description.length > 0);
  });

  test('has canApply function', () => {
    assert.ok(typeof migration.canApply === 'function');
  });

  test('has apply function', () => {
    assert.ok(typeof migration.apply === 'function');
  });
});
