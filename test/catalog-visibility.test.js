import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  loadRouterConfig,
  resolveRouterState,
} from '../src/adapters/opencode/index.js';
import { generateOpenCodeOverlay } from '../src/adapters/opencode/overlay-generator.js';
import { getCatalogDisplayName } from '../src/core/preset-io.js';
import { assembleV4Config } from '../src/core/router-v4-io.js';

describe('getCatalogDisplayName', () => {
  test('returns "SDD-Orchestrator (default)" for default catalog with displayName', () => {
    const result = getCatalogDisplayName('default', { displayName: 'SDD-Orchestrator' });
    assert.equal(result, 'SDD-Orchestrator (default)');
  });

  test('returns "SDD-Orchestrator (default)" for default catalog without meta', () => {
    const resultNull = getCatalogDisplayName('default', null);
    assert.equal(resultNull, 'SDD-Orchestrator (default)');
    const resultUndefined = getCatalogDisplayName('default', undefined);
    assert.equal(resultUndefined, 'SDD-Orchestrator (default)');
  });

  test('returns custom displayName for non-default catalog', () => {
    const result = getCatalogDisplayName('experimental', { displayName: 'Lab' });
    assert.equal(result, 'Lab');
  });

  test('returns catalog key for non-default catalog without displayName', () => {
    const resultNull = getCatalogDisplayName('experimental', null);
    assert.equal(resultNull, 'experimental');
    const resultUndefined = getCatalogDisplayName('experimental', undefined);
    assert.equal(resultUndefined, 'experimental');
  });
});

describe('assembleV4Config catalog metadata pass-through', () => {
  test('passes through enabled flag from coreConfig', () => {
    const coreConfig = {
      version: 4,
      active_preset: 'test',
      catalogs: { default: { enabled: true } },
    };
    const profiles = [
      {
        filePath: null,
        catalogName: 'default',
        content: {
          name: 'test',
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
          },
        },
      },
    ];
    const assembled = assembleV4Config(coreConfig, profiles);
    assert.equal(assembled.catalogs.default.enabled, true);
  });

  test('defaults enabled to true for default catalog without metadata', () => {
    const coreConfig = {
      version: 4,
      active_preset: 'test',
    };
    const profiles = [
      {
        filePath: null,
        catalogName: 'default',
        content: {
          name: 'test',
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
          },
        },
      },
    ];
    const assembled = assembleV4Config(coreConfig, profiles);
    assert.equal(assembled.catalogs.default.enabled, true);
  });

  test('defaults enabled to false for non-default catalog without metadata', () => {
    const coreConfig = {
      version: 4,
      active_preset: 'test',
    };
    const profiles = [
      {
        filePath: null,
        catalogName: 'mycat',
        content: {
          name: 'test',
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
          },
        },
      },
    ];
    const assembled = assembleV4Config(coreConfig, profiles);
    assert.equal(assembled.catalogs.mycat.enabled, false);
  });

  test('passes through displayName from coreConfig', () => {
    const coreConfig = {
      version: 4,
      active_preset: 'test',
      catalogs: { default: { displayName: 'SDD-Orchestrator' } },
    };
    const profiles = [
      {
        filePath: null,
        catalogName: 'default',
        content: {
          name: 'test',
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
          },
        },
      },
    ];
    const assembled = assembleV4Config(coreConfig, profiles);
    assert.equal(assembled.catalogs.default.displayName, 'SDD-Orchestrator');
  });
});

describe('generateOpenCodeOverlay catalog filtering', () => {
  function makeConfig({ defaultEnabled = true, otherEnabled = false } = {}) {
    return {
      version: 3,
      active_catalog: 'default',
      active_preset: 'test',
      catalogs: {
        default: {
          enabled: defaultEnabled,
          presets: {
            test: {
              phases: {
                orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
              },
            },
          },
        },
        other: {
          enabled: otherEnabled,
          presets: {
            other_preset: {
              phases: {
                orchestrator: [{ target: 'openai/gpt', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
              },
            },
          },
        },
      },
    };
  }

  test('skips disabled catalogs — only default preset appears', () => {
    const config = makeConfig({ defaultEnabled: true, otherEnabled: false });
    const { agent } = generateOpenCodeOverlay(config);
    const agentNames = Object.keys(agent);
    assert.ok(agentNames.some((n) => n.includes('test')), 'default catalog preset should appear');
    assert.ok(!agentNames.some((n) => n.includes('other_preset')), 'disabled catalog preset should not appear');
  });

  test('includes all presets from enabled catalogs when both enabled', () => {
    const config = makeConfig({ defaultEnabled: true, otherEnabled: true });
    const { agent } = generateOpenCodeOverlay(config);
    const agentNames = Object.keys(agent);
    assert.ok(agentNames.some((n) => n.includes('test')), 'default catalog preset should appear');
    assert.ok(agentNames.some((n) => n.includes('other_preset')), 'other catalog preset should appear');
  });
});

describe('live config catalog metadata', () => {
  test('live config has SDD-Orchestrator displayName', () => {
    const config = loadRouterConfig();
    assert.equal(config.catalogs?.default?.displayName, 'SDD-Orchestrator');
  });

  test('live config has default catalog enabled', () => {
    const config = loadRouterConfig();
    assert.equal(config.catalogs?.default?.enabled, true);
  });
});
