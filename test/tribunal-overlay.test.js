/**
 * Unit tests for tribunal sub-agent overlay generation.
 *
 * Spec reference: SDD-4 tribunal-logic — Phase 5 (Overlay)
 *
 * Test scenarios:
 *   S1 — Profile with tribunal generates judge/minister/radar agent entries
 *   S2 — Sub-agents have hidden: true
 *   S3 — Sub-agents have _gsr_generated: true
 *   S4 — Minister count matches ministers array length
 *   S5 — Naming pattern: gsr-{profile}-judge, gsr-{profile}-minister-1, etc.
 *   S6 — Profile WITHOUT tribunal generates only orchestrator (backward compat)
 *   S7 — Radar agent only generated when radar.enabled === true
 *   S8 — Sub-agent tools are restricted (read only)
 *   S9 — Orchestrator entry is unchanged (additive only)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateOpenCodeOverlay } from '../src/adapters/opencode/overlay-generator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal v3 config with a single preset in the default catalog. */
function makeConfig(presets = {}) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'my-profile',
    catalogs: {
      default: {
        availability: 'stable',
        presets,
      },
    },
  };
}

/** A preset with tribunal enabled in the explore phase — 2 ministers + radar. */
const TRIBUNAL_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
    explore: {
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
      ],
      radar: {
        model: 'google/gemini-1.5-pro',
        enabled: true,
      },
    },
  },
};

/** Same as TRIBUNAL_PRESET but with 3 ministers and no radar. */
const TRIBUNAL_PRESET_3_MIN_NO_RADAR = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
    explore: {
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      ],
      tribunal: {
        enabled: true,
        max_rounds: 4,
        escalate_after: 4,
      },
      judge: {
        model: 'openai/o3',
      },
      ministers: [
        { model: 'openai/gpt-5' },
        { model: 'google/gemini-pro' },
        { model: 'anthropic/claude-sonnet' },
      ],
      // No radar block
    },
  },
};

/** A preset with tribunal in explore and verify (to test multi-phase max-count behavior). */
const TRIBUNAL_PRESET_MULTI_PHASE = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
    explore: {
      lanes: [
        { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
      ],
      tribunal: { enabled: true, max_rounds: 4, escalate_after: 4 },
      judge: { model: 'anthropic/claude-opus' },
      ministers: [
        { model: 'openai/gpt-5' },
        { model: 'google/gemini-pro' },
        { model: 'anthropic/claude-sonnet' },
      ],
      radar: { model: 'google/gemini-1.5-pro', enabled: true },
    },
    verify: {
      lanes: [
        { phase: 'verify', role: 'primary', target: 'openai/o3' },
      ],
      tribunal: { enabled: true, max_rounds: 3, escalate_after: 3 },
      judge: { model: 'openai/o3' },
      ministers: [
        { model: 'openai/gpt-5' },
        { model: 'google/gemini-pro' },
      ],
      // No radar
    },
  },
};

/** A plain preset with no tribunal fields — backward compat. */
const PLAIN_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
    explore: [
      { target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'explore', role: 'primary' },
    ],
  },
};

/** A preset with tribunal.enabled = false — should not generate sub-agents. */
const TRIBUNAL_DISABLED_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
    explore: {
      lanes: [{ phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' }],
      tribunal: { enabled: false, max_rounds: 4 },
      judge: { model: 'anthropic/claude-opus' },
      ministers: [{ model: 'openai/gpt-5' }, { model: 'google/gemini-pro' }],
      radar: { model: 'google/gemini-1.5-pro', enabled: true },
    },
  },
};

// ── S1: Profile with tribunal generates judge/minister/radar entries ───────────

describe('S1 — tribunal profile generates judge, minister, and radar agent entries', () => {
  test('generates gsr-{profile}-judge entry', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-my-profile-judge'], 'gsr-my-profile-judge must be present');
  });

  test('generates gsr-{profile}-minister-1 and minister-2 entries', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-my-profile-minister-1'], 'minister-1 must be present');
    assert.ok(agent['gsr-my-profile-minister-2'], 'minister-2 must be present');
  });

  test('generates gsr-{profile}-radar entry when radar enabled', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-my-profile-radar'], 'radar must be present when enabled');
  });

  test('judge model is extracted from profile tribunal config', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-judge'].model, 'anthropic/claude-opus');
  });

  test('minister models are extracted in order', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-minister-1'].model, 'openai/gpt-5');
    assert.equal(agent['gsr-my-profile-minister-2'].model, 'google/gemini-pro');
  });

  test('radar model is extracted from profile tribunal config', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-radar'].model, 'google/gemini-1.5-pro');
  });
});

// ── S2: Sub-agents have hidden: true ─────────────────────────────────────────

describe('S2 — tribunal sub-agents have hidden: true', () => {
  test('judge entry has hidden: true', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-judge'].hidden, true);
  });

  test('minister entries have hidden: true', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-minister-1'].hidden, true);
    assert.equal(agent['gsr-my-profile-minister-2'].hidden, true);
  });

  test('radar entry has hidden: true', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-radar'].hidden, true);
  });
});

// ── S3: Sub-agents have _gsr_generated: true ─────────────────────────────────

describe('S3 — tribunal sub-agents have _gsr_generated: true', () => {
  test('all tribunal sub-agents are marked as GSR-generated', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-judge']._gsr_generated, true);
    assert.equal(agent['gsr-my-profile-minister-1']._gsr_generated, true);
    assert.equal(agent['gsr-my-profile-minister-2']._gsr_generated, true);
    assert.equal(agent['gsr-my-profile-radar']._gsr_generated, true);
  });
});

// ── S4: Minister count matches ministers array length ─────────────────────────

describe('S4 — minister count matches ministers array length', () => {
  test('2 ministers in config → 2 minister agents generated', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const ministerKeys = Object.keys(agent).filter(k => k.startsWith('gsr-my-profile-minister-'));
    assert.equal(ministerKeys.length, 2);
    assert.ok(!agent['gsr-my-profile-minister-3'], 'minister-3 must not exist');
  });

  test('3 ministers in config → 3 minister agents generated', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET_3_MIN_NO_RADAR });
    const { agent } = generateOpenCodeOverlay(config);

    const ministerKeys = Object.keys(agent).filter(k => k.startsWith('gsr-my-profile-minister-'));
    assert.equal(ministerKeys.length, 3);
    assert.ok(agent['gsr-my-profile-minister-3'], 'minister-3 must exist');
  });

  test('multi-phase: max minister count across phases is used', () => {
    // explore has 3 ministers, verify has 2 → should generate 3
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET_MULTI_PHASE });
    const { agent } = generateOpenCodeOverlay(config);

    const ministerKeys = Object.keys(agent).filter(k => k.startsWith('gsr-my-profile-minister-'));
    assert.equal(ministerKeys.length, 3, 'max(3,2)=3 ministers must be generated');
  });
});

// ── S5: Naming pattern ────────────────────────────────────────────────────────

describe('S5 — naming pattern is gsr-{profile}-{role}[-{n}]', () => {
  test('judge follows gsr-{profile}-judge pattern', () => {
    const config = makeConfig({ 'enterprise': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-enterprise-judge'], 'gsr-enterprise-judge must exist');
  });

  test('ministers follow gsr-{profile}-minister-{n} pattern (1-indexed)', () => {
    const config = makeConfig({ 'enterprise': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-enterprise-minister-1'], 'gsr-enterprise-minister-1 must exist');
    assert.ok(agent['gsr-enterprise-minister-2'], 'gsr-enterprise-minister-2 must exist');
    // Verify no 0-indexed minister exists
    assert.ok(!agent['gsr-enterprise-minister-0'], 'minister-0 must NOT exist (1-indexed)');
  });

  test('radar follows gsr-{profile}-radar pattern', () => {
    const config = makeConfig({ 'enterprise': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-enterprise-radar'], 'gsr-enterprise-radar must exist');
  });

  test('profile name is part of all sub-agent keys', () => {
    const config = makeConfig({ 'custom-name': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-custom-name-judge'], 'profile name embedded in judge key');
    assert.ok(agent['gsr-custom-name-minister-1'], 'profile name embedded in minister key');
    assert.ok(agent['gsr-custom-name-radar'], 'profile name embedded in radar key');
  });
});

// ── S6: Profile WITHOUT tribunal generates only orchestrator ──────────────────

describe('S6 — profile without tribunal generates only orchestrator (backward compat)', () => {
  test('plain preset generates exactly one agent entry', () => {
    const config = makeConfig({ 'balanced': PLAIN_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-balanced'], 'gsr-balanced orchestrator must be generated');
    // No tribunal sub-agents
    const subAgentKeys = Object.keys(agent).filter(k =>
      k.startsWith('gsr-balanced-judge') ||
      k.startsWith('gsr-balanced-minister') ||
      k.startsWith('gsr-balanced-radar')
    );
    assert.equal(subAgentKeys.length, 0, 'no tribunal sub-agents for plain preset');
    assert.equal(Object.keys(agent).length, 1, 'exactly 1 agent for plain preset');
  });

  test('preset with tribunal.enabled=false generates only orchestrator', () => {
    const config = makeConfig({ 'balanced': TRIBUNAL_DISABLED_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-balanced'], 'orchestrator must be generated');
    const subAgentKeys = Object.keys(agent).filter(k => k !== 'gsr-balanced');
    assert.equal(subAgentKeys.length, 0, 'disabled tribunal must not generate sub-agents');
  });
});

// ── S7: Radar only when radar.enabled === true ────────────────────────────────

describe('S7 — radar agent only generated when radar.enabled === true', () => {
  test('no radar entry when radar block is absent', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET_3_MIN_NO_RADAR });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(!agent['gsr-my-profile-radar'], 'radar must NOT be generated when absent');
  });

  test('no radar entry when radar.enabled is false', () => {
    const presetWithRadarDisabled = {
      availability: 'stable',
      phases: {
        orchestrator: [
          { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
        ],
        explore: {
          lanes: [{ phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' }],
          tribunal: { enabled: true, max_rounds: 4, escalate_after: 4 },
          judge: { model: 'anthropic/claude-opus' },
          ministers: [{ model: 'openai/gpt-5' }, { model: 'google/gemini-pro' }],
          radar: { model: 'google/gemini-1.5-pro', enabled: false }, // explicitly disabled
        },
      },
    };

    const config = makeConfig({ 'my-profile': presetWithRadarDisabled });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(!agent['gsr-my-profile-radar'], 'radar must NOT be generated when enabled: false');
  });

  test('radar entry generated when radar.enabled === true', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-my-profile-radar'], 'radar must be generated when enabled: true');
  });
});

// ── S8: Sub-agent tools are restricted (read only) ───────────────────────────

describe('S8 — sub-agent tools match per-role permissions', () => {
  test('judge tools: full access (read + write + edit + bash)', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-my-profile-judge'].tools;
    assert.equal(tools.read, true, 'judge read must be true');
    assert.equal(tools.write, true, 'judge write must be true (channel I/O + delegation)');
    assert.equal(tools.edit, true, 'judge edit must be true (metadata updates)');
    assert.equal(tools.bash, true, 'judge bash must be true (polling + delegation)');
  });

  test('minister tools: read + write + bash (channel I/O + polling)', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-my-profile-minister-1'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, true, 'minister write must be true (channel responses)');
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, true, 'minister bash must be true (polling sleep)');
  });

  test('radar tools: read + write + bash (investigation + channel I/O)', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-my-profile-radar'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, true, 'radar write must be true (channel findings)');
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, true, 'radar bash must be true (investigation grep/find)');
  });
});

// ── S9: Orchestrator entry is unchanged (additive only) ───────────────────────

describe('S9 — orchestrator entry is unchanged when tribunal sub-agents are added', () => {
  test('orchestrator model is not affected by tribunal config', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    // The orchestrator target in TRIBUNAL_PRESET is anthropic/claude-opus
    assert.equal(agent['gsr-my-profile'].model, 'anthropic/claude-opus',
      'orchestrator model must remain unchanged');
  });

  test('orchestrator has mode: primary', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile'].mode, 'primary',
      'orchestrator mode must remain primary');
  });

  test('orchestrator has _gsr_generated: true', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile']._gsr_generated, true);
  });

  test('orchestrator does not get hidden flag (unless preset.hidden is set)', () => {
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(!agent['gsr-my-profile'].hidden,
      'orchestrator must not be hidden (tribunal sub-agents are hidden, not orchestrator)');
  });

  test('total agents count = 1 (orchestrator) + judge + ministers + radar', () => {
    // TRIBUNAL_PRESET: 1 orchestrator + 1 judge + 2 ministers + 1 radar = 5
    const config = makeConfig({ 'my-profile': TRIBUNAL_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const myProfileKeys = Object.keys(agent).filter(k => k.startsWith('gsr-my-profile'));
    assert.equal(myProfileKeys.length, 5, 'expected 5 entries: orch + judge + 2min + radar');
  });
});
