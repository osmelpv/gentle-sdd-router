import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, before, after } from 'node:test';
import { generateOpenCodeOverlay } from '../src/adapters/opencode/overlay-generator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal assembled config factory for fallback tests. */
function makeConfig(presets = {}) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'test',
    catalogs: {
      default: {
        availability: 'stable',
        enabled: true,
        presets,
      },
    },
  };
}

/** A preset with CSV fallbacks string */
const CSV_FALLBACK_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      {
        target: 'anthropic/claude-sonnet',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'modelA, modelB',
      },
    ],
    explore: [
      {
        target: 'google/gemini-pro',
        kind: 'lane',
        phase: 'explore',
        role: 'primary',
        fallbacks: 'openai/gpt, anthropic/claude-haiku',
      },
    ],
  },
};

/** A preset without fallbacks */
const NO_FALLBACK_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      {
        target: 'openai/gpt-5',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
      },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateOpenCodeOverlay — fallback emission', () => {
  test('preset with CSV fallbacks produces _gsr_fallbacks map on agent entry', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-test-preset'], 'agent entry must exist');
    assert.ok(
      agent['gsr-test-preset']._gsr_fallbacks,
      '_gsr_fallbacks must be present on agent entry'
    );
    assert.equal(typeof agent['gsr-test-preset']._gsr_fallbacks, 'object', '_gsr_fallbacks must be an object (map)');
  });

  test('_gsr_fallbacks map is keyed by phase name', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const fallbacks = agent['gsr-test-preset']._gsr_fallbacks;
    assert.ok('orchestrator' in fallbacks, '_gsr_fallbacks must have orchestrator key');
    assert.ok('explore' in fallbacks, '_gsr_fallbacks must have explore key');
  });

  test('_gsr_fallbacks orchestrator entry is Array<{model,on}> with on:["any"] for CSV', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const fallbacks = agent['gsr-test-preset']._gsr_fallbacks;
    assert.deepEqual(fallbacks.orchestrator, [
      { model: 'modelA', on: ['any'] },
      { model: 'modelB', on: ['any'] },
    ]);
  });

  test('_gsr_fallbacks explore entry is Array<{model,on}> with on:["any"] for CSV', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const fallbacks = agent['gsr-test-preset']._gsr_fallbacks;
    assert.deepEqual(fallbacks.explore, [
      { model: 'openai/gpt', on: ['any'] },
      { model: 'anthropic/claude-haiku', on: ['any'] },
    ]);
  });

  test('preset without fallbacks produces empty _gsr_fallbacks map', () => {
    const config = makeConfig({ 'no-fallback': NO_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    // _gsr_fallbacks must exist but be empty (or have only empty arrays)
    const fallbacks = agent['gsr-no-fallback']._gsr_fallbacks;
    assert.ok(fallbacks !== undefined, '_gsr_fallbacks must be present');
    // If key exists, it must map to empty array
    if ('orchestrator' in fallbacks) {
      assert.deepEqual(fallbacks.orchestrator, []);
    }
  });

  test('_gsr_orchestrator_fallbacks is set as convenience alias for orchestrator phase fallbacks', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(
      '_gsr_orchestrator_fallbacks' in agent['gsr-test-preset'],
      '_gsr_orchestrator_fallbacks convenience alias must be present'
    );
    assert.deepEqual(
      agent['gsr-test-preset']._gsr_orchestrator_fallbacks,
      [
        { model: 'modelA', on: ['any'] },
        { model: 'modelB', on: ['any'] },
      ],
      '_gsr_orchestrator_fallbacks must match orchestrator fallbacks'
    );
  });

  test('agent prompt includes GSR Fallback Protocol text', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(
      agent['gsr-test-preset'].prompt.includes('GSR Fallback Protocol'),
      'agent prompt must include GSR Fallback Protocol'
    );
  });

  test('idempotency: generating overlay twice does not duplicate protocol text', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });

    // Generate twice
    const first = generateOpenCodeOverlay(config);
    const second = generateOpenCodeOverlay(config);

    const prompt1 = first.agent['gsr-test-preset'].prompt;
    const prompt2 = second.agent['gsr-test-preset'].prompt;

    // Both prompts should be identical
    assert.equal(prompt1, prompt2, 'two generations must produce identical prompts');

    // The protocol text must appear exactly once
    const occurrences = (prompt1.match(/GSR Fallback Protocol/g) || []).length;
    assert.equal(occurrences, 1, 'GSR Fallback Protocol must appear exactly once in prompt');
  });

  test('preset without fallbacks does NOT inject GSR Fallback Protocol (design D2)', () => {
    const config = makeConfig({ 'no-fallback': NO_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    // Per design D2: protocol is ONLY injected when preset has at least one lane with fallbacks
    assert.ok(
      !agent['gsr-no-fallback'].prompt.includes('GSR Fallback Protocol'),
      'preset without fallbacks must NOT have GSR Fallback Protocol in prompt (design D2)'
    );
  });

  test('multiple presets each get their own fallback map', () => {
    const config = makeConfig({
      'with-fallbacks': CSV_FALLBACK_PRESET,
      'no-fallbacks': NO_FALLBACK_PRESET,
    });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-with-fallbacks']._gsr_fallbacks, 'first preset has _gsr_fallbacks');
    assert.ok(agent['gsr-no-fallbacks']._gsr_fallbacks, 'second preset has _gsr_fallbacks');

    // They must be independent objects
    assert.notEqual(
      agent['gsr-with-fallbacks']._gsr_fallbacks,
      agent['gsr-no-fallbacks']._gsr_fallbacks,
      'fallback maps must be independent objects'
    );
  });

  // ── Heartbeat Protocol injection ──────────────────────────────────────────

  test('agent prompt includes GSR Watchdog Heartbeat Protocol text for preset with phases', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(
      agent['gsr-test-preset'].prompt.includes('GSR Watchdog Heartbeat Protocol'),
      'agent prompt must include GSR Watchdog Heartbeat Protocol'
    );
  });

  test('heartbeat protocol appears exactly once (idempotent)', () => {
    const config = makeConfig({ 'test-preset': CSV_FALLBACK_PRESET });
    const first = generateOpenCodeOverlay(config);
    const second = generateOpenCodeOverlay(config);

    const occurrences1 = (first.agent['gsr-test-preset'].prompt.match(/GSR Watchdog Heartbeat Protocol/g) || []).length;
    const occurrences2 = (second.agent['gsr-test-preset'].prompt.match(/GSR Watchdog Heartbeat Protocol/g) || []).length;
    assert.equal(occurrences1, 1, 'must appear exactly once on first generation');
    assert.equal(occurrences2, 1, 'must appear exactly once on second generation');
  });

  test('preset without phases does NOT inject heartbeat protocol', () => {
    const noPhasePreset = { availability: 'stable', phases: {} };
    const config = makeConfig({ 'no-phases': noPhasePreset });
    const { agent } = generateOpenCodeOverlay(config);
    if (agent['gsr-no-phases']) {
      assert.ok(
        !agent['gsr-no-phases'].prompt.includes('GSR Watchdog Heartbeat Protocol'),
        'preset without phases must NOT have heartbeat protocol'
      );
    }
  });

  // ── Structured on-conditions ──────────────────────────────────────────────

  test('structured fallbacks with on-conditions preserve on field in _gsr_fallbacks', () => {
    const structuredPreset = {
      availability: 'stable',
      phases: {
        orchestrator: [{
          target: 'anthropic/claude-sonnet',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          fallbacks: [
            { model: 'mistral/large', on: ['quota_exceeded', 'rate_limited'] },
            { model: 'openai/gpt-4o', on: ['any'] },
          ],
        }],
      },
    };
    const config = makeConfig({ 'structured': structuredPreset });
    const { agent } = generateOpenCodeOverlay(config);

    const fallbacks = agent['gsr-structured']._gsr_fallbacks;
    assert.ok(Array.isArray(fallbacks.orchestrator));
    assert.deepEqual(fallbacks.orchestrator[0], { model: 'mistral/large', on: ['quota_exceeded', 'rate_limited'] });
    assert.deepEqual(fallbacks.orchestrator[1], { model: 'openai/gpt-4o', on: ['any'] });
  });

  test('CSV fallbacks normalize to on:["any"] — backward compatible', () => {
    const config = makeConfig({ 'csv': CSV_FALLBACK_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const fallbacks = agent['gsr-csv']._gsr_fallbacks;
    for (const phaseFallbacks of Object.values(fallbacks)) {
      for (const fb of phaseFallbacks) {
        assert.ok(typeof fb === 'object' && fb !== null, 'each entry must be an object');
        assert.ok(typeof fb.model === 'string', 'each entry must have model string');
        assert.ok(Array.isArray(fb.on), 'each entry must have on array');
        assert.deepEqual(fb.on, ['any'], 'CSV fallbacks must have on:["any"]');
      }
    }
  });
});
