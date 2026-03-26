import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRouterSchemaV3,
  validateRouterSchemaV3,
} from '../src/router-config.js';

test('maps v1 chains into a normalized v3 view without mutation', () => {
  const config = {
    version: 1,
    active_profile: 'default',
    activation_state: 'active',
    profiles: {
      default: {
        phases: {
          orchestrator: [
            'anthropic/claude-sonnet',
            {
              kind: 'judge',
              target: 'openai/o3',
              instructions: 'run the verifier now',
              metadata: {
                role: 'verifier',
              },
            },
          ],
          explore: ['google/gemini-flash', 'openai/gpt'],
        },
      },
    },
  };
  const snapshot = JSON.parse(JSON.stringify(config));

  const normalized = normalizeRouterSchemaV3(config);

  assert.deepEqual(config, snapshot);
  assert.equal(normalized.sourceVersion, 1);
  assert.equal(normalized.activeCatalogName, 'legacy');
  assert.equal(normalized.activePresetName, 'default');
  assert.equal(normalized.resolvedPhases.orchestrator.active.target, 'anthropic/claude-sonnet');
  assert.equal(normalized.resolvedPhases.orchestrator.roles[0], 'primary');
  assert.equal(normalized.selectedPreset.phases[0].lanes[0].path[1].instructions, undefined);
  assert.equal(normalized.resolvedPhases.explore.active.target, 'google/gemini-flash');
});

test('resolves latest aliases and unavailable fallbacks deterministically', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          alpha: {
            availability: 'stable',
            aliases: ['latest'],
            phases: {
              orchestrator: [
                {
                  phase: 'orchestrator',
                  role: 'primary',
                  target: 'alpha/model',
                  fallbacks: ['beta/model'],
                },
              ],
            },
          },
          beta: {
            availability: 'stable',
            aliases: ['latest'],
            phases: {
              orchestrator: [
                {
                  phase: 'orchestrator',
                  role: 'primary',
                  target: 'beta/model',
                  fallbacks: [],
                },
              ],
            },
          },
          fallback: {
            availability: 'unavailable',
            fallbacks: ['alpha'],
            phases: {
              orchestrator: [
                {
                  phase: 'orchestrator',
                  role: 'primary',
                  target: 'fallback/model',
                  fallbacks: ['alpha/model'],
                },
              ],
            },
          },
        },
      },
    },
  };

  const first = normalizeRouterSchemaV3(config);
  const second = normalizeRouterSchemaV3(config);

  assert.equal(first.activePresetName, 'alpha');
  assert.equal(second.activePresetName, 'alpha');
  assert.deepEqual(first.selectedPreset, second.selectedPreset);
  assert.match(first.compatibilityNotes.join(' '), /resolved to "alpha"/i);

  const fallbackConfig = {
    ...config,
    active_preset: 'fallback',
  };

  const resolvedFallback = normalizeRouterSchemaV3(fallbackConfig);
  assert.equal(resolvedFallback.activePresetName, 'alpha');
});

test('rejects execution wording in v3 configs', () => {
  const invalid = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  phase: 'verify',
                  role: 'judge',
                  target: 'openai/o3',
                  instructions: 'run the verifier now',
                  fallbacks: ['anthropic/claude-opus'],
                },
              ],
            },
          },
        },
      },
    },
  };

  assert.throws(() => validateRouterSchemaV3(invalid), /execution-oriented field "instructions"/i);
});

test('rejects v3 lanes missing phase or role', () => {
  const base = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  phase: 'verify',
                  role: 'judge',
                  target: 'openai/o3',
                },
              ],
            },
          },
        },
      },
    },
  };

  assert.throws(() => validateRouterSchemaV3({
    ...base,
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  role: 'judge',
                  target: 'openai/o3',
                },
              ],
            },
          },
        },
      },
    },
  }), /requires phase/i);

  assert.throws(() => validateRouterSchemaV3({
    ...base,
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  phase: 'verify',
                  target: 'openai/o3',
                },
              ],
            },
          },
        },
      },
    },
  }), /requires a valid role/i);
});

test('normalizes missing lane metadata and high complexity guidance', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        guidance: {
          default: {
            laneCount: 2,
            ordering: ['primary', 'judge'],
          },
          byComplexity: {
            high: {
              laneCount: 3,
              ordering: ['primary', 'secondary', 'judge'],
            },
          },
        },
        presets: {
          latest: {
            complexity: 'high',
            phases: {
              verify: [
                {
                  phase: 'verify',
                  role: 'judge',
                  target: 'openai/o3',
                  fallbacks: ['anthropic/claude-opus'],
                },
              ],
            },
          },
        },
      },
    },
  };

  const normalized = normalizeRouterSchemaV3(config);

  assert.deepEqual(normalized.resolvedPhases.verify.active.metadata, {});
  assert.equal(normalized.complexityGuidance.complexity.label, 'high');
  assert.equal(normalized.complexityGuidance.recommendation.laneCount, 3);
  assert.deepEqual(normalized.complexityGuidance.recommendation.ordering, ['primary', 'secondary', 'judge']);
});

test('normalizes a v3 lane without metadata to an empty metadata object', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  phase: 'verify',
                  role: 'judge',
                  target: 'openai/o3',
                  fallbacks: ['anthropic/claude-opus'],
                },
              ],
            },
          },
        },
      },
    },
  };

  const normalized = normalizeRouterSchemaV3(config);

  assert.deepEqual(normalized.resolvedPhases.verify.active.metadata, {});
});

test('drops v1 execution hints during migration into v3 lanes', () => {
  const config = {
    version: 1,
    active_profile: 'default',
    activation_state: 'active',
    profiles: {
      default: {
        phases: {
          orchestrator: [
            'anthropic/claude-sonnet',
            {
              kind: 'judge',
              target: 'openai/o3',
              execute: 'run the verifier now',
              instructions: 'run the verifier now',
              command: 'verify --now',
              metadata: {
                role: 'verifier',
              },
            },
          ],
        },
      },
    },
  };

  const normalized = normalizeRouterSchemaV3(config);
  const lane = normalized.selectedPreset.phases[0].lanes[0];
  const pathEntry = lane.path[1];

  assert.equal(pathEntry.execute, undefined);
  assert.equal(pathEntry.instructions, undefined);
  assert.equal(pathEntry.command, undefined);
  assert.deepEqual(pathEntry.metadata, { role: 'verifier' });
  assert.equal(lane.role, 'primary');
});

test('falls back to default complexity guidance when the label is unknown', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        guidance: {
          default: {
            laneCount: 2,
            ordering: ['primary', 'judge'],
          },
          byComplexity: {
            high: {
              laneCount: 3,
              ordering: ['primary', 'secondary', 'judge'],
            },
          },
        },
        presets: {
          latest: {
            complexity: 'mystery',
            phases: {
              orchestrator: [
                {
                  phase: 'orchestrator',
                  role: 'primary',
                  target: 'openai/gpt',
                  fallbacks: ['anthropic/claude-sonnet'],
                },
              ],
            },
          },
        },
      },
    },
  };

  const normalized = normalizeRouterSchemaV3(config);

  assert.equal(normalized.complexityGuidance.recommendation.laneCount, 2);
  assert.deepEqual(normalized.complexityGuidance.recommendation.ordering, ['primary', 'judge']);
});
