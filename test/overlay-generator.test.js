import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  generateOpenCodeOverlay,
  mapPermissions,
  mergeOverlayWithExisting,
} from '../src/adapters/opencode/overlay-generator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal assembled config with the given presets. */
function makeConfig(presets = {}) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'balanced',
    catalogs: {
      default: {
        availability: 'stable',
        presets,
      },
    },
  };
}

const MULTIVENDOR_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const SAFETY_PRESET = {
  availability: 'unavailable',
  permissions: {
    read: true,
    write: false,
    edit: false,
    bash: false,
    delegate: true,
  },
  phases: {
    orchestrator: [
      { target: 'openai/gpt', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const HIDDEN_PRESET = {
  availability: 'experimental',
  hidden: true,
  phases: {
    orchestrator: [
      { target: 'openai/o3', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const NO_ORCHESTRATOR_PRESET = {
  availability: 'stable',
  phases: {
    verify: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'verify', role: 'judge' },
    ],
  },
};

// ── mapPermissions ────────────────────────────────────────────────────────────

describe('mapPermissions', () => {
  test('defaults to all true when permissions is undefined', () => {
    const tools = mapPermissions(undefined);
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
    assert.equal(tools.delegate, true);
    assert.equal(tools.delegation_read, true);
    assert.equal(tools.delegation_list, true);
  });

  test('defaults to all true when permissions is null', () => {
    const tools = mapPermissions(null);
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
  });

  test('applies restrictive safety permissions', () => {
    const tools = mapPermissions({
      read: true,
      write: false,
      edit: false,
      bash: false,
      delegate: true,
    });
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, false);
    assert.equal(tools.delegate, true);
    assert.equal(tools.delegation_read, true);
    assert.equal(tools.delegation_list, true);
  });

  test('delegate false disables delegation_read and delegation_list', () => {
    const tools = mapPermissions({ delegate: false });
    assert.equal(tools.delegate, false);
    assert.equal(tools.delegation_read, false);
    assert.equal(tools.delegation_list, false);
  });

  test('partial permissions use defaults for missing keys', () => {
    const tools = mapPermissions({ write: false });
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
  });
});

// ── generateOpenCodeOverlay ───────────────────────────────────────────────────

describe('generateOpenCodeOverlay', () => {
  test('generates gsr-{name} agent for multivendor preset', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-multivendor'], 'gsr-multivendor key exists');
    assert.equal(agent['gsr-multivendor'].mode, 'primary');
    assert.equal(agent['gsr-multivendor'].model, 'anthropic/claude-sonnet');
    assert.equal(warnings.length, 0);
  });

  test('generates correct description format', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);
    assert.equal(agent['gsr-multivendor'].description, 'gsr: multivendor — stable');
  });

  test('generates restricted tools for safety preset', () => {
    const config = makeConfig({ safety: SAFETY_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-safety'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, false);
    assert.equal(tools.delegate, true);
  });

  test('sets hidden:true for hidden preset', () => {
    const config = makeConfig({ internal: HIDDEN_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-internal'].hidden, true);
  });

  test('non-hidden preset does not have hidden key', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(Object.prototype.hasOwnProperty.call(agent['gsr-multivendor'], 'hidden'), false);
  });

  test('skips preset with no orchestrator phase and adds warning', () => {
    const config = makeConfig({ noOrch: NO_ORCHESTRATOR_PRESET });
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /noOrch.*no orchestrator phase/);
  });

  test('generates multiple agents for multiple presets', () => {
    const config = makeConfig({
      multivendor: MULTIVENDOR_PRESET,
      safety: SAFETY_PRESET,
      internal: HIDDEN_PRESET,
    });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 3);
    assert.ok(agent['gsr-multivendor']);
    assert.ok(agent['gsr-safety']);
    assert.ok(agent['gsr-internal']);
  });

  test('handles empty catalogs gracefully', () => {
    const config = { version: 3, catalogs: {} };
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 0);
    assert.equal(warnings.length, 0);
  });

  test('preset without permissions gets all-true tools', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-multivendor'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
    assert.equal(tools.delegate, true);
  });

  test('uses availability in description', () => {
    const config = makeConfig({ safety: SAFETY_PRESET });
    const { agent } = generateOpenCodeOverlay(config);
    assert.equal(agent['gsr-safety'].description, 'gsr: safety — unavailable');
  });
});

// ── mergeOverlayWithExisting ──────────────────────────────────────────────────

describe('mergeOverlayWithExisting', () => {
  test('preserves non-gsr-* agent keys', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };
    const existing = {
      agent: {
        'my-custom-agent': { model: 'openai/gpt-4o' },
        'gentleman': { mode: 'primary' },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.ok(result.agent['my-custom-agent'], 'my-custom-agent preserved');
    assert.ok(result.agent['gentleman'], 'gentleman preserved');
    assert.ok(result.agent['gsr-balanced'], 'gsr-balanced added');
  });

  test('removes stale gsr-* entries', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };
    const existing = {
      agent: {
        'gsr-old-preset': { mode: 'primary' },
        'gsr-another-stale': { mode: 'primary' },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(Object.prototype.hasOwnProperty.call(result.agent, 'gsr-old-preset'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.agent, 'gsr-another-stale'), false);
    assert.ok(result.agent['gsr-balanced']);
  });

  test('works with empty existing config', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };

    const result = mergeOverlayWithExisting(overlay, {});

    assert.ok(result.agent['gsr-balanced']);
  });

  test('works with existing config that has no agent key', () => {
    const overlay = {
      agent: { 'gsr-safety': { mode: 'primary' } },
    };
    const existing = { theme: 'dark', someOtherKey: 42 };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(result.theme, 'dark');
    assert.equal(result.someOtherKey, 42);
    assert.ok(result.agent['gsr-safety']);
  });

  test('does not mutate the existing object', () => {
    const overlay = { agent: { 'gsr-balanced': { mode: 'primary' } } };
    const existing = {
      agent: { 'gsr-old': { mode: 'primary' } },
    };
    const existingCopy = JSON.parse(JSON.stringify(existing));

    mergeOverlayWithExisting(overlay, existing);

    // existing should be unchanged
    assert.deepEqual(existing, existingCopy);
  });

  test('overlay with multiple agents merges all', () => {
    const overlay = {
      agent: {
        'gsr-balanced': { mode: 'primary' },
        'gsr-safety': { mode: 'primary', tools: { write: false } },
      },
    };
    const existing = { agent: { 'sdd-explorer': { mode: 'primary' } } };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.ok(result.agent['gsr-balanced']);
    assert.ok(result.agent['gsr-safety']);
    assert.ok(result.agent['sdd-explorer']);
  });
});
