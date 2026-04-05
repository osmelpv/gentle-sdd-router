/**
 * Tests for debug_invoke validation in router-v4-io.js (validateProfileFile).
 * Also tests integration: preset files have correct debug_invoke blocks,
 * and sdd-debug presets do NOT have debug_invoke (no recursion).
 *
 * Strict TDD: tests written FIRST.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { validateProfileFile } from '../src/core/router-v4-io.js';
import { parseYaml } from '../src/core/router.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '..'
);

const PROFILES_DIR = path.join(PROJECT_ROOT, 'router', 'profiles');

const BASE_PHASES = {
  orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-opus' }],
};

function makeProfile(overrides = {}) {
  return {
    name: 'test-profile',
    phases: BASE_PHASES,
    ...overrides,
  };
}

function loadPreset(filename) {
  const raw = fs.readFileSync(path.join(PROFILES_DIR, filename), 'utf8');
  return parseYaml(raw);
}

// ─── validateProfileFile — debug_invoke accepted ──────────────────────────────

describe('validateProfileFile — debug_invoke: valid cases', () => {
  test('profile without debug_invoke passes validation', () => {
    const profile = makeProfile();
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });

  test('profile with full valid debug_invoke passes validation', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'on_issues',
        input_from: 'verify_output',
        required_fields: ['issues', 'affected_files', 'last_change_files', 'test_baseline'],
      },
    });
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });

  test('debug_invoke with trigger:always passes validation', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'always',
        input_from: 'verify_output',
        required_fields: ['issues'],
      },
    });
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });

  test('debug_invoke with trigger:never passes validation', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'never',
      },
    });
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });

  test('debug_invoke with trigger:manual passes validation', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'manual',
      },
    });
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });

  test('debug_invoke with empty required_fields array passes validation', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-multi',
        trigger: 'on_issues',
        input_from: 'verify_output',
        required_fields: [],
      },
    });
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/test.router.yaml'));
  });
});

// ─── validateProfileFile — debug_invoke rejected ──────────────────────────────

describe('validateProfileFile — debug_invoke: invalid cases', () => {
  test('debug_invoke with empty preset string throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: '',
        trigger: 'on_issues',
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*preset.*non-empty string/i
    );
  });

  test('debug_invoke with non-string preset throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 42,
        trigger: 'on_issues',
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*preset.*non-empty string/i
    );
  });

  test('debug_invoke with invalid trigger throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'sometimes',
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*trigger.*on_issues.*always.*never.*manual/i
    );
  });

  test('debug_invoke with non-string input_from throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'on_issues',
        input_from: 123,
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*input_from.*string/i
    );
  });

  test('debug_invoke with required_fields as non-array throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'on_issues',
        required_fields: 'issues',
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*required_fields.*array/i
    );
  });

  test('debug_invoke with required_fields containing non-string element throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        preset: 'sdd-debug-mono',
        trigger: 'on_issues',
        required_fields: ['issues', 123],
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*required_fields.*strings/i
    );
  });

  test('debug_invoke as non-object throws', () => {
    const profile = makeProfile({
      debug_invoke: 'on_issues',
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*object/i
    );
  });

  test('debug_invoke missing preset throws', () => {
    const profile = makeProfile({
      debug_invoke: {
        trigger: 'on_issues',
        input_from: 'verify_output',
      },
    });
    assert.throws(
      () => validateProfileFile(profile, '/fake/test.router.yaml'),
      /debug_invoke.*preset.*non-empty string/i
    );
  });
});

// ─── Integration: main presets have debug_invoke ─────────────────────────────

const MAIN_PRESETS = [
  'multivendor.router.yaml',
  'multiagent.router.yaml',
  'local-hybrid.router.yaml',
  'ollama.router.yaml',
  'claude.router.yaml',
  'openai.router.yaml',
  'cheap.router.yaml',
  'heavyweight.router.yaml',
];

describe('Integration: main presets have debug_invoke block', () => {
  for (const filename of MAIN_PRESETS) {
    test(`${filename} has debug_invoke block`, () => {
      const preset = loadPreset(filename);
      assert.ok(
        preset.debug_invoke !== undefined,
        `${filename} must have a debug_invoke block`
      );
    });

    test(`${filename} debug_invoke.preset is a non-empty string`, () => {
      const preset = loadPreset(filename);
      assert.ok(
        typeof preset.debug_invoke?.preset === 'string' && preset.debug_invoke.preset.trim().length > 0,
        `${filename} debug_invoke.preset must be a non-empty string`
      );
    });

    test(`${filename} debug_invoke.trigger is a valid value`, () => {
      const preset = loadPreset(filename);
      const VALID_TRIGGERS = ['on_issues', 'always', 'never', 'manual'];
      assert.ok(
        VALID_TRIGGERS.includes(preset.debug_invoke?.trigger),
        `${filename} debug_invoke.trigger must be one of: ${VALID_TRIGGERS.join(', ')}`
      );
    });

    test(`${filename} passes validateProfileFile with debug_invoke`, () => {
      const preset = loadPreset(filename);
      assert.doesNotThrow(
        () => validateProfileFile(preset, path.join(PROFILES_DIR, filename)),
        `${filename} must pass validateProfileFile`
      );
    });
  }
});

// ─── Integration: safety preset has trigger:never ────────────────────────────

describe('Integration: safety preset debug_invoke', () => {
  test('safety.router.yaml has debug_invoke with trigger:never', () => {
    const preset = loadPreset('safety.router.yaml');
    assert.ok(
      preset.debug_invoke !== undefined,
      'safety.router.yaml must have debug_invoke block'
    );
    assert.equal(
      preset.debug_invoke?.trigger,
      'never',
      'safety.router.yaml must have trigger:never'
    );
  });

  test('safety preset passes validateProfileFile', () => {
    const preset = loadPreset('safety.router.yaml');
    assert.doesNotThrow(
      () => validateProfileFile(preset, path.join(PROFILES_DIR, 'safety.router.yaml'))
    );
  });
});

// ─── Integration: sdd-debug presets do NOT have debug_invoke (no recursion) ───
// NOTE: Tests temporarily removed — sdd-debug presets deleted in sdd-debug-v2 Phase 1.
// Will be rewritten with new v2 preset structure in Phase 3 (task 3.5).

// ─── Integration: multiagent uses sdd-debug-multi ────────────────────────────

describe('Integration: multiagent uses sdd-debug-multi variant', () => {
  test('multiagent.router.yaml debug_invoke.preset is sdd-debug-multi', () => {
    const preset = loadPreset('multiagent.router.yaml');
    assert.equal(
      preset.debug_invoke?.preset,
      'sdd-debug-multi',
      'multiagent must use sdd-debug-multi (has judges, multi-agent debugging)'
    );
  });
});

// ─── Integration: all other main presets use sdd-debug-mono ──────────────────

describe('Integration: non-multiagent presets use sdd-debug-mono', () => {
  const MONO_PRESETS = MAIN_PRESETS.filter((f) => f !== 'multiagent.router.yaml');

  for (const filename of MONO_PRESETS) {
    test(`${filename} debug_invoke.preset is sdd-debug-mono`, () => {
      const preset = loadPreset(filename);
      assert.equal(
        preset.debug_invoke?.preset,
        'sdd-debug-mono',
        `${filename} must use sdd-debug-mono`
      );
    });
  }
});

// ─── Round-trip: delegation/checkpoint/loop_target survive validation (S02, S05) ─

import { validateSddYaml } from '../src/core/sdd-catalog-io.js';

describe('Round-trip: delegation field survives validation (S02)', () => {
  test('delegation: sub-agent is preserved through validateSddYaml', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase', delegation: 'sub-agent' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.analyze.delegation, 'sub-agent');
  });

  test('delegation: orchestrator is preserved through validateSddYaml', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        diagnose: { intent: 'Test phase', delegation: 'orchestrator' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.diagnose.delegation, 'orchestrator');
  });

  test('delegation defaults to sub-agent when absent', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.analyze.delegation, 'sub-agent');
  });

  test('invalid delegation value throws', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase', delegation: 'self' },
      },
    };
    assert.throws(
      () => validateSddYaml(parsed, '/fake/test.yaml'),
      /delegation.*invalid|invalid.*delegation/i
    );
  });
});

describe('Round-trip: checkpoint survives validation (S02)', () => {
  test('checkpoint block is preserved through validateSddYaml', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        diagnose: {
          intent: 'Test phase',
          checkpoint: {
            before_next: true,
            show_user: ['report'],
            user_actions: ['approve', 'contradict'],
            on_contradict: 'loop_self',
          },
        },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.ok(result.phases.diagnose.checkpoint !== null, 'checkpoint must be preserved');
    assert.equal(result.phases.diagnose.checkpoint.before_next, true);
    assert.deepEqual(result.phases.diagnose.checkpoint.show_user, ['report']);
    assert.deepEqual(result.phases.diagnose.checkpoint.user_actions, ['approve', 'contradict']);
    assert.equal(result.phases.diagnose.checkpoint.on_contradict, 'loop_self');
  });

  test('absent checkpoint normalizes to null', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.analyze.checkpoint, null);
  });
});

describe('Round-trip: loop_target survives validation (S02, S05)', () => {
  test('valid loop_target is preserved through validateSddYaml', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        diagnose: { intent: 'Diagnose' },
        finalize: { intent: 'Finalize', depends_on: ['diagnose'], loop_target: 'diagnose' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.finalize.loop_target, 'diagnose');
  });

  test('absent loop_target normalizes to null', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.phases.analyze.loop_target, null);
  });

  test('invalid loop_target referencing non-existent phase throws (S05)', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        finalize: { intent: 'Finalize', loop_target: 'nonexistent-phase' },
      },
    };
    assert.throws(
      () => validateSddYaml(parsed, '/fake/test.yaml'),
      /loop_target.*nonexistent-phase/i
    );
  });
});

describe('Round-trip: orchestrator block survives validation', () => {
  test('orchestrator.retained_phases is preserved', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      orchestrator: {
        retained_phases: ['diagnose', 'finalize'],
      },
      phases: {
        diagnose: { intent: 'Diagnose', delegation: 'orchestrator' },
        finalize: { intent: 'Finalize', delegation: 'orchestrator', depends_on: ['diagnose'] },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.ok(result.orchestrator !== null, 'orchestrator block must exist');
    assert.deepEqual(result.orchestrator.retained_phases, ['diagnose', 'finalize']);
  });

  test('absent orchestrator block normalizes to null', () => {
    const parsed = {
      name: 'test-sdd',
      version: 1,
      phases: {
        analyze: { intent: 'Test phase' },
      },
    };
    const result = validateSddYaml(parsed, '/fake/test.yaml');
    assert.equal(result.orchestrator, null);
  });
});
