import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createTokenBudgetHint,
  createOpenCodeSessionSyncContract,
  loadRouterConfig,
  resolveRouterState,
} from '../src/adapters/opencode/index.js';
import { assembleV4Config, validateProfileFile } from '../src/core/router-v4-io.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeAssembledConfig(presetOverrides = {}) {
  const coreConfig = {
    version: 4,
    active_catalog: 'default',
    active_preset: 'test-preset',
    activation_state: 'active',
    metadata: {},
  };

  const preset = {
    name: 'test-preset',
    availability: 'stable',
    complexity: 'medium',
    phases: {
      orchestrator: [{
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        inputPerMillion: 15,
        outputPerMillion: 75,
        contextWindow: 200000,
      }],
      explore: [{
        target: 'google/gemini-pro',
        kind: 'lane',
        phase: 'explore',
        role: 'primary',
        inputPerMillion: 1.25,
        outputPerMillion: 5,
        contextWindow: 2000000,
      }],
      apply: [{
        target: 'anthropic/claude-sonnet',
        kind: 'lane',
        phase: 'apply',
        role: 'primary',
        inputPerMillion: 3,
        outputPerMillion: 15,
        contextWindow: 200000,
      }],
      ...presetOverrides,
    },
  };

  const profiles = [{
    filePath: null,
    fileName: 'test-preset.router.yaml',
    catalogName: 'default',
    content: preset,
  }];

  return assembleV4Config(coreConfig, profiles);
}

// ── createTokenBudgetHint ───────────────────────────────────────────────────

describe('createTokenBudgetHint', () => {
  test('returns null when config is null', () => {
    assert.equal(createTokenBudgetHint(null, {}), null);
  });

  test('returns null when config has no catalogs', () => {
    assert.equal(createTokenBudgetHint({}, {}), null);
  });

  test('returns null when state is null', () => {
    assert.equal(createTokenBudgetHint({ catalogs: {} }, null), null);
  });

  test('returns null when catalog does not exist', () => {
    const config = makeAssembledConfig();
    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'nonexistent',
      selectedPresetName: 'test-preset',
    });
    assert.equal(result, null);
  });

  test('returns null when preset does not exist', () => {
    const config = makeAssembledConfig();
    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      selectedPresetName: 'nonexistent',
    });
    assert.equal(result, null);
  });

  test('returns valid token budget hint for preset with contextWindow', () => {
    const config = makeAssembledConfig();
    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      selectedPresetName: 'test-preset',
    });

    assert.notEqual(result, null);
    assert.equal(result.kind, 'token-budget-hint');
    assert.equal(result.contractVersion, '1');
    assert.equal(result.catalogName, 'default');
    assert.equal(result.presetName, 'test-preset');

    // Policy
    assert.equal(result.policy.nonExecuting, true);
    assert.equal(result.policy.informationalOnly, true);
    assert.equal(result.policy.hostAccumulates, true);

    // Phases
    assert.ok(result.phases.orchestrator);
    assert.equal(result.phases.orchestrator.contextWindow, 200000);
    assert.equal(result.phases.orchestrator.inputCostPerMillion, 15);
    assert.equal(result.phases.orchestrator.outputCostPerMillion, 75);
    assert.equal(result.phases.orchestrator.target, 'anthropic/claude-opus');

    assert.ok(result.phases.explore);
    assert.equal(result.phases.explore.contextWindow, 2000000);
    assert.equal(result.phases.explore.inputCostPerMillion, 1.25);
    assert.equal(result.phases.explore.outputCostPerMillion, 5);

    assert.ok(result.phases.apply);
    assert.equal(result.phases.apply.contextWindow, 200000);
  });

  test('returns null when no lane has any budget data', () => {
    const config = makeAssembledConfig({
      orchestrator: [{
        target: 'test/model',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
      }],
    });
    // Remove phases added in default
    delete config.catalogs.default.presets['test-preset'].phases.explore;
    delete config.catalogs.default.presets['test-preset'].phases.apply;

    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      selectedPresetName: 'test-preset',
    });
    assert.equal(result, null);
  });

  test('handles lanes with partial budget data (contextWindow only)', () => {
    const config = makeAssembledConfig({
      orchestrator: [{
        target: 'test/model',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        contextWindow: 128000,
      }],
    });
    delete config.catalogs.default.presets['test-preset'].phases.explore;
    delete config.catalogs.default.presets['test-preset'].phases.apply;

    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      selectedPresetName: 'test-preset',
    });

    assert.notEqual(result, null);
    assert.equal(result.phases.orchestrator.contextWindow, 128000);
    assert.equal(result.phases.orchestrator.inputCostPerMillion, null);
    assert.equal(result.phases.orchestrator.outputCostPerMillion, null);
  });

  test('handles lanes with partial budget data (pricing only)', () => {
    const config = makeAssembledConfig({
      orchestrator: [{
        target: 'test/model',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        inputPerMillion: 3,
        outputPerMillion: 15,
      }],
    });
    delete config.catalogs.default.presets['test-preset'].phases.explore;
    delete config.catalogs.default.presets['test-preset'].phases.apply;

    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      selectedPresetName: 'test-preset',
    });

    assert.notEqual(result, null);
    assert.equal(result.phases.orchestrator.contextWindow, null);
    assert.equal(result.phases.orchestrator.inputCostPerMillion, 3);
  });

  test('uses activeProfileName as fallback for presetName', () => {
    const config = makeAssembledConfig();
    const result = createTokenBudgetHint(config, {
      selectedCatalogName: 'default',
      activeProfileName: 'test-preset',
    });

    assert.notEqual(result, null);
    assert.equal(result.presetName, 'test-preset');
  });
});

// ── validateProfileFile contextWindow validation ────────────────────────────

describe('validateProfileFile: contextWindow', () => {
  test('accepts profile without contextWindow (backward compat)', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
        }],
      },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, 'test.yaml'));
  });

  test('accepts profile with valid contextWindow', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          contextWindow: 200000,
        }],
      },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, 'test.yaml'));
  });

  test('rejects profile with non-integer contextWindow', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          contextWindow: 200.5,
        }],
      },
    };
    assert.throws(() => validateProfileFile(profile, 'test.yaml'), /contextWindow/);
  });

  test('rejects profile with zero contextWindow', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          contextWindow: 0,
        }],
      },
    };
    assert.throws(() => validateProfileFile(profile, 'test.yaml'), /contextWindow/);
  });

  test('rejects profile with negative contextWindow', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          contextWindow: -1,
        }],
      },
    };
    assert.throws(() => validateProfileFile(profile, 'test.yaml'), /contextWindow/);
  });

  test('rejects profile with string contextWindow', () => {
    const profile = {
      name: 'test',
      phases: {
        orchestrator: [{
          target: 'test/model',
          kind: 'lane',
          phase: 'orchestrator',
          role: 'primary',
          contextWindow: '200000',
        }],
      },
    };
    assert.throws(() => validateProfileFile(profile, 'test.yaml'), /contextWindow/);
  });
});

// ── Session sync contract includes tokenBudgetHint ──────────────────────────

describe('session sync contract: tokenBudgetHint', () => {
  test('session sync contract includes tokenBudgetHint when budget data exists', () => {
    const config = makeAssembledConfig();
    const state = resolveRouterState(config);

    const contract = createOpenCodeSessionSyncContract({
      config,
      state,
      configPath: '/fake/router/router.yaml',
    });

    assert.ok(contract.tokenBudgetHint, 'tokenBudgetHint should be present');
    assert.equal(contract.tokenBudgetHint.kind, 'token-budget-hint');
    assert.equal(contract.tokenBudgetHint.contractVersion, '1');
    assert.ok(contract.tokenBudgetHint.phases.orchestrator);
    assert.equal(contract.tokenBudgetHint.phases.orchestrator.contextWindow, 200000);
  });

  test('session sync contract has null tokenBudgetHint when no budget data', () => {
    const coreConfig = {
      version: 4,
      active_catalog: 'default',
      active_preset: 'bare',
      activation_state: 'active',
      metadata: {},
    };

    const profiles = [{
      filePath: null,
      fileName: 'bare.router.yaml',
      catalogName: 'default',
      content: {
        name: 'bare',
        phases: {
          orchestrator: [{
            target: 'test/model',
            kind: 'lane',
            phase: 'orchestrator',
            role: 'primary',
          }],
        },
      },
    }];

    const config = assembleV4Config(coreConfig, profiles);
    const state = resolveRouterState(config);

    const contract = createOpenCodeSessionSyncContract({
      config,
      state,
      configPath: '/fake/router/router.yaml',
    });

    assert.equal(contract.tokenBudgetHint, null);
  });

  test('session sync contract preserves non-executing boundary', () => {
    const config = makeAssembledConfig();
    const state = resolveRouterState(config);

    const contract = createOpenCodeSessionSyncContract({
      config,
      state,
      configPath: '/fake/router/router.yaml',
    });

    assert.equal(contract.nonExecuting, true);
    assert.equal(contract.tokenBudgetHint.policy.nonExecuting, true);
    assert.equal(contract.tokenBudgetHint.policy.informationalOnly, true);
    assert.equal(contract.tokenBudgetHint.policy.hostAccumulates, true);
  });
});

// ── Integration: factory presets have contextWindow ─────────────────────────

describe('factory presets: contextWindow', () => {
  test('multivendor preset loads with contextWindow in all phases', () => {
    const config = loadRouterConfig();
    const catalog = config.catalogs.default;
    const preset = catalog.presets.multivendor;

    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      assert.ok(Array.isArray(lanes), `${phaseName} should have lanes array`);
      const primaryLane = lanes[0];
      assert.ok(primaryLane.contextWindow, `${phaseName} primary lane should have contextWindow`);
      assert.ok(Number.isInteger(primaryLane.contextWindow), `${phaseName} contextWindow should be integer`);
      assert.ok(primaryLane.contextWindow > 0, `${phaseName} contextWindow should be positive`);
    }
  });

  test('token budget hint works with live config', () => {
    const config = loadRouterConfig();
    const state = resolveRouterState(config);
    const hint = createTokenBudgetHint(config, state);

    assert.notEqual(hint, null, 'Token budget hint should not be null for multivendor');
    assert.equal(hint.kind, 'token-budget-hint');
    assert.ok(Object.keys(hint.phases).length > 0, 'Should have at least one phase');

    // Every phase should have contextWindow
    for (const [phaseName, phaseData] of Object.entries(hint.phases)) {
      assert.ok(phaseData.target, `${phaseName} should have a target`);
      assert.ok(phaseData.contextWindow > 0, `${phaseName} should have positive contextWindow`);
    }
  });
});
