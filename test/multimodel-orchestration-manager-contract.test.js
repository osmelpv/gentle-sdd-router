import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMultimodelCompareContract,
  createMultimodelOrchestrationManagerContract,
} from '../src/router-config.js';

const parallelFixture = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      availability: 'stable',
      metadata: {
        labels: ['multimodel', 'orchestration'],
        pricing: {
          band: 'platform',
          currency: 'usd',
        },
      },
      presets: {
        balanced: {
          aliases: ['latest'],
          availability: 'stable',
          complexity: 'low',
          metadata: {
            labels: ['balanced'],
            pricing: {
              band: 'team',
              currency: 'usd',
            },
          },
          guidance: {
            default: {
              laneCount: 2,
              ordering: ['primary', 'secondary'],
            },
          },
          phases: {
            orchestrator: [
              {
                kind: 'lane',
                phase: 'orchestrator',
                role: 'primary',
                target: 'anthropic/claude-sonnet',
                fallbacks: ['openai/gpt'],
              },
              {
                kind: 'lane',
                phase: 'orchestrator',
                role: 'secondary',
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

const comparisonFixture = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      availability: 'stable',
      metadata: {
        labels: ['multimodel', 'orchestration'],
        pricing: {
          band: 'platform',
          currency: 'usd',
        },
      },
      presets: {
        balanced: {
          aliases: ['latest'],
          availability: 'stable',
          complexity: 'high',
          metadata: {
            labels: ['balanced', 'guided'],
            pricing: {
              band: 'team',
              currency: 'usd',
            },
          },
          guidance: {
            default: {
              laneCount: 2,
              ordering: ['primary', 'judge'],
            },
          },
          phases: {
            orchestrator: [
              {
                kind: 'lane',
                phase: 'orchestrator',
                role: 'primary',
                target: 'anthropic/claude-sonnet',
                fallbacks: ['openai/gpt'],
              },
              {
                kind: 'lane',
                phase: 'orchestrator',
                role: 'judge',
                target: 'openai/o3',
                fallbacks: ['anthropic/claude-opus'],
              },
            ],
          },
        },
        focused: {
          aliases: ['quick'],
          availability: 'beta',
          complexity: 'medium',
          metadata: {
            labels: ['focused', 'fast'],
            pricing: {
              band: 'starter',
              currency: 'usd',
            },
          },
          guidance: {
            default: {
              laneCount: 1,
              ordering: ['primary'],
            },
          },
          phases: {
            orchestrator: [
              {
                kind: 'lane',
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

test('manager contract keeps independent branches parallel', () => {
  const report = createMultimodelOrchestrationManagerContract({
    schemaFacts: parallelFixture,
    reportRefs: {
      runtimeContract: { kind: 'runtime-contract', status: 'limited', contractVersion: '1' },
      providerExecutionContract: { kind: 'provider-execution-contract', status: 'unsupported', contractVersion: '1' },
    },
    handoffTarget: 'agent-teams-lite',
  });

  assert.equal(report.kind, 'multimodel-orchestration-manager-contract');
  assert.equal(report.contractVersion, '1');
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.source.catalog.name, 'default');
  assert.equal(report.source.preset.name, 'balanced');
  assert.equal(report.complexity.mode, 'parallel');
  assert.equal(report.split.length, 1);
  assert.equal(report.dispatch.length, 2);
  assert.ok(report.dispatch.every((entry) => entry.order === 'parallel'));
  assert.equal(report.judge.length, 0);
  assert.equal(report.radar.length, 0);
  assert.equal(report.recovery.resumeToken, report.planId);
  assert.equal(report.recovery.handoffTarget, 'agent-teams-lite');
  assert.ok(report.recovery.sourceEnvelopeIds.includes('runtimeContract'));
  assert.ok(report.recovery.sourceEnvelopeIds.includes('providerExecutionContract'));
  assert.deepEqual(report.policy, {
    nonExecuting: true,
    nonRoutingMutation: true,
    routerExternal: true,
  });
});

test('manager contract inserts judge and radar steps around compare boundaries', () => {
  const compareProjection = createMultimodelCompareContract(comparisonFixture, 'default/balanced', 'default/focused');
  const report = createMultimodelOrchestrationManagerContract({
    schemaFacts: comparisonFixture,
    compareProjection,
    reportRefs: {
      runtimeContract: { kind: 'runtime-contract', status: 'limited', contractVersion: '1' },
      handoffDelegationContract: { kind: 'handoff-delegation-contract', status: 'accepted', contractVersion: '1' },
    },
    parentPlanId: 'render:opencode',
  });

  assert.equal(report.complexity.mode, 'sequential');
  assert.ok(report.dispatch.some((entry) => entry.order === 'sequential'));
  assert.ok(report.judge.some((step) => step.boundary === 'merge'));
  assert.ok(report.judge.some((step) => step.boundary === 'orchestrator'));
  assert.ok(report.radar.some((step) => step.signalScope === 'compare-projection'));
  assert.ok(report.radar.some((step) => step.signal === 'divergence'));
  assert.equal(report.recovery.parentPlanId, 'render:opencode');
  assert.equal(report.inputs.compareProjection.leftResolvedSelector, 'default/balanced');
  assert.equal(report.inputs.compareProjection.rightResolvedSelector, 'default/focused');
  assert.ok(report.inputs.compareProjection.differences.length > 0);
});
