/**
 * Unit tests for Tribunal schema validation and phase metadata.
 *
 * Spec reference: SPEC-TRIBUNAL-003
 * Strict TDD: tests describe expected behavior before/during implementation.
 *
 * Test scenarios:
 *   S1  — Profile with tribunal.enabled + 3 ministers + judge.model passes validation
 *   S2  — Profile with tribunal.enabled + only 1 minister fails (min 2)
 *   S3  — Profile with tribunal.enabled + no judge.model fails validation
 *   S4  — Profile without tribunal fields passes validation unchanged (backward compat)
 *   S5  — Profile with tribunal.enabled=false + 0 ministers passes (tribunal disabled)
 *   S6  — 'minister' is in ALLOWED_LANE_ROLES (lane with role 'minister' is valid)
 *   S7  — ROLE_RECOMMENDATIONS has entries for judge, radar, minister
 *   S8  — max_rounds must be a positive integer
 *   S9  — escalate_after must be <= max_rounds
 *   S10 — optionalRoles includes 'minister' for multiagent-capable phases
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateRouterSchemaV3 } from '../src/core/router-schema-v3.js';
import { PHASE_METADATA, ROLE_RECOMMENDATIONS } from '../src/core/phases.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal v3 config wrapping a single preset with the given phase config.
 *
 * @param {object} phaseEntry - The value of phases.explore
 * @returns {object} Full v3 config object
 */
function makeConfigWithPhase(phaseEntry) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              explore: phaseEntry,
            },
          },
        },
      },
    },
  };
}

/**
 * Build a phase entry (object form) with the given lanes array and extra fields.
 */
function makePhaseWithTribunal(overrides = {}) {
  return {
    lanes: [
      { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
    ],
    tribunal: {
      enabled: true,
      max_rounds: 4,
      escalate_after: 4,
    },
    judge: {
      model: 'anthropic/claude-opus',
    },
    ministers: [
      { model: 'openai/gpt-5' },
      { model: 'google/gemini-pro' },
      { model: 'anthropic/claude-sonnet' },
    ],
    radar: {
      model: 'google/gemini-1.5-pro',
      enabled: true,
    },
    judge_fallbacks: ['openai/o3-mini'],
    minister_fallbacks: ['openai/gpt-4o'],
    ...overrides,
  };
}

// ── S1: tribunal.enabled + 3 ministers + judge.model passes ──────────────────

describe('S1 — valid tribunal config with 3 ministers passes validation', () => {
  it('does not throw for a fully configured tribunal', () => {
    const config = makeConfigWithPhase(makePhaseWithTribunal());
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });
});

// ── S2: tribunal.enabled + only 1 minister fails ─────────────────────────────

describe('S2 — tribunal.enabled with only 1 minister fails', () => {
  it('throws when ministers has fewer than 2 entries', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        ministers: [{ model: 'openai/gpt-5' }],
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /requires at least 2 ministers/i
    );
  });
});

// ── S3: tribunal.enabled + no judge.model fails ──────────────────────────────

describe('S3 — tribunal.enabled without judge.model fails', () => {
  it('throws when judge block is missing', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({ judge: undefined })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /requires judge\.model/i
    );
  });

  it('throws when judge.model is an empty string', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({ judge: { model: '  ' } })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /requires judge\.model/i
    );
  });
});

// ── S4: profile without tribunal fields passes (backward compat) ──────────────

describe('S4 — profile without tribunal fields passes validation unchanged', () => {
  it('passes when phase is a plain lane array (no tribunal)', () => {
    const config = makeConfigWithPhase([
      { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
    ]);
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });

  it('passes when phase is an object with lanes but no tribunal block', () => {
    const config = makeConfigWithPhase({
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      ],
    });
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });
});

// ── S5: tribunal.enabled=false + 0 ministers passes ──────────────────────────

describe('S5 — tribunal.enabled=false skips minister/judge requirements', () => {
  it('passes when tribunal.enabled is false with no ministers', () => {
    const config = makeConfigWithPhase({
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      ],
      tribunal: {
        enabled: false,
        max_rounds: 4,
        escalate_after: 4,
      },
    });
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });

  it('passes when tribunal block is present but enabled is omitted', () => {
    const config = makeConfigWithPhase({
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      ],
      tribunal: {
        max_rounds: 3,
        escalate_after: 2,
      },
    });
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });
});

// ── S6: 'minister' is a valid lane role ──────────────────────────────────────

describe('S6 — minister is in ALLOWED_LANE_ROLES', () => {
  it('a lane with role "minister" passes schema validation', () => {
    const config = makeConfigWithPhase([
      { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      { phase: 'explore', role: 'minister', target: 'openai/gpt-5' },
    ]);
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });

  it('a lane with role "minister" in an object-form phase passes validation', () => {
    const config = makeConfigWithPhase({
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
        { phase: 'explore', role: 'minister', target: 'openai/gpt-5' },
      ],
    });
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });
});

// ── S7: ROLE_RECOMMENDATIONS has entries for judge, radar, minister ───────────

describe('S7 — ROLE_RECOMMENDATIONS has entries for judge, radar, minister', () => {
  it('ROLE_RECOMMENDATIONS exports an object', () => {
    assert.ok(ROLE_RECOMMENDATIONS !== null && typeof ROLE_RECOMMENDATIONS === 'object');
  });

  it('has a judge entry with hint, preferred, reason', () => {
    assert.ok(ROLE_RECOMMENDATIONS.judge, 'judge key must exist');
    assert.ok(typeof ROLE_RECOMMENDATIONS.judge.hint === 'string');
    assert.ok(Array.isArray(ROLE_RECOMMENDATIONS.judge.preferred));
    assert.ok(typeof ROLE_RECOMMENDATIONS.judge.reason === 'string');
  });

  it('has a radar entry with hint, preferred, reason', () => {
    assert.ok(ROLE_RECOMMENDATIONS.radar, 'radar key must exist');
    assert.ok(typeof ROLE_RECOMMENDATIONS.radar.hint === 'string');
    assert.ok(Array.isArray(ROLE_RECOMMENDATIONS.radar.preferred));
    assert.ok(typeof ROLE_RECOMMENDATIONS.radar.reason === 'string');
  });

  it('has a minister entry with hint, preferred, reason', () => {
    assert.ok(ROLE_RECOMMENDATIONS.minister, 'minister key must exist');
    assert.ok(typeof ROLE_RECOMMENDATIONS.minister.hint === 'string');
    assert.ok(Array.isArray(ROLE_RECOMMENDATIONS.minister.preferred));
    assert.ok(typeof ROLE_RECOMMENDATIONS.minister.reason === 'string');
  });
});

// ── S8: max_rounds must be a positive integer ─────────────────────────────────

describe('S8 — tribunal.max_rounds must be a positive integer', () => {
  it('throws when max_rounds is 0', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 0, escalate_after: 0 },
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /max_rounds must be a positive integer/i
    );
  });

  it('throws when max_rounds is a negative number', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: -1, escalate_after: 1 },
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /max_rounds must be a positive integer/i
    );
  });

  it('throws when max_rounds is a float', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 2.5, escalate_after: 2 },
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /max_rounds must be a positive integer/i
    );
  });

  it('passes when max_rounds is a positive integer', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 4, escalate_after: 4 },
      })
    );
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });
});

// ── S9: escalate_after must be <= max_rounds ──────────────────────────────────

describe('S9 — tribunal.escalate_after must be <= max_rounds', () => {
  it('throws when escalate_after exceeds max_rounds', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 3, escalate_after: 5 },
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /escalate_after must be <= tribunal\.max_rounds/i
    );
  });

  it('passes when escalate_after equals max_rounds', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 4, escalate_after: 4 },
      })
    );
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });

  it('passes when escalate_after is less than max_rounds', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 6, escalate_after: 3 },
      })
    );
    assert.doesNotThrow(() => validateRouterSchemaV3(config));
  });

  it('throws when escalate_after is 0', () => {
    const config = makeConfigWithPhase(
      makePhaseWithTribunal({
        tribunal: { enabled: true, max_rounds: 4, escalate_after: 0 },
      })
    );
    assert.throws(
      () => validateRouterSchemaV3(config),
      /escalate_after must be a positive integer/i
    );
  });
});

// ── S10: optionalRoles includes 'minister' for multiagent-capable phases ──────

describe('S10 — optionalRoles includes minister for multiagent-capable phases', () => {
  const multiagentPhases = ['orchestrator', 'explore', 'propose', 'spec', 'design', 'verify', 'debug'];

  for (const phase of multiagentPhases) {
    it(`${phase} optionalRoles includes 'minister'`, () => {
      assert.ok(
        PHASE_METADATA[phase]?.optionalRoles?.includes('minister'),
        `Expected ${phase}.optionalRoles to include 'minister', got: ${JSON.stringify(PHASE_METADATA[phase]?.optionalRoles)}`
      );
    });
  }

  it('tasks phase does not include minister (alwaysMono)', () => {
    assert.ok(
      !PHASE_METADATA.tasks?.optionalRoles?.includes('minister'),
      'tasks phase must not include minister'
    );
  });

  it('apply phase does not include minister (alwaysMono)', () => {
    assert.ok(
      !PHASE_METADATA.apply?.optionalRoles?.includes('minister'),
      'apply phase must not include minister'
    );
  });

  it('archive phase does not include minister (alwaysMono)', () => {
    assert.ok(
      !PHASE_METADATA.archive?.optionalRoles?.includes('minister'),
      'archive phase must not include minister'
    );
  });
});
