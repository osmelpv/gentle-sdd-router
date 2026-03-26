import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  projectShareableMultimodelMetadata,
} from '../src/router-config.js';

const multimodelFixtureYaml = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  active_profile: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      availability: 'stable',
      metadata: {
        labels: ['multimodel', 'shared'],
        pricing: {
          band: 'platform',
          currency: 'usd',
        },
      },
      guidance: {
        default: {
          laneCount: 2,
          ordering: ['primary', 'judge', 'radar'],
        },
      },
      presets: {
        balanced: {
          aliases: ['latest'],
          availability: 'stable',
          complexity: 'high',
          metadata: {
            labels: ['balanced', 'recommended'],
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
            byComplexity: {
              high: {
                laneCount: 3,
                ordering: ['primary', 'judge', 'radar'],
              },
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
          complexity: { label: 'focused' },
          metadata: {
            labels: ['focused', 'fast'],
            pricing: {
              band: 'starter',
              currency: 'eur',
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
              {
                kind: 'lane',
                phase: 'orchestrator',
                role: 'radar',
                target: 'google/gemini-pro',
                fallbacks: ['openai/o3'],
              },
            ],
          },
        },
      },
    },
  },
};

test('browse contract projects shareable multimodel metadata', () => {
  const report = createMultimodelBrowseContract(multimodelFixtureYaml);

  assert.equal(report.kind, 'multimodel-browse-contract');
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.selector, 'default/balanced');
  assert.equal(report.resolvedSelector, 'default/balanced');
  assert.deepEqual(report.visibility, {
    availability: true,
    pricing: true,
    labels: true,
    guidance: true,
  });
  assert.deepEqual(report.policy, {
    nonRecommendation: true,
    nonExecution: true,
  });
  assert.equal(report.catalog.name, 'default');
  assert.deepEqual(report.catalog.labels, ['multimodel', 'shared']);
  assert.equal(report.catalog.availability, 'stable');
  assert.deepEqual(report.preset.aliases, ['latest']);
  assert.equal(report.preset.availability, 'stable');
  assert.equal(report.preset.complexity, 'high');
  assert.equal(report.pricing.band, 'team');
  assert.equal(report.pricing.currency, 'usd');
  assert.equal(report.guidance.summary.default.laneCount, 2);
  assert.deepEqual(report.preset.laneSummary[0], {
    phase: 'orchestrator',
    laneCount: 2,
    roles: ['primary', 'judge'],
  });
});

test('browse contract redacts hidden metadata flags', () => {
  const projected = projectShareableMultimodelMetadata(
    multimodelFixtureYaml.catalogs.default,
    multimodelFixtureYaml.catalogs.default.presets.focused,
    { availability: true, pricing: false, labels: false, guidance: false },
  );

  assert.equal(projected.visibility.pricing, false);
  assert.equal(projected.visibility.labels, false);
  assert.equal(projected.visibility.guidance, false);
  assert.deepEqual(projected.catalog.labels, []);
  assert.deepEqual(projected.preset.aliases, []);
  assert.equal(projected.pricing.band, null);
  assert.equal(projected.pricing.currency, null);
  assert.equal(projected.guidance.summary, null);
  assert.deepEqual(projected.preset.laneSummary, []);
});

test('compare contract diffs projected metadata only', () => {
  const report = createMultimodelCompareContract(multimodelFixtureYaml, 'default/balanced', 'default/focused');

  assert.equal(report.kind, 'multimodel-compare-contract');
  assert.equal(report.leftResolvedSelector, 'default/balanced');
  assert.equal(report.rightResolvedSelector, 'default/focused');
  assert.ok(report.differences.some((diff) => diff.path === 'preset.availability'));
  assert.ok(report.differences.some((diff) => diff.path === 'preset.aliases'));
  assert.ok(report.differences.some((diff) => diff.path === 'pricing.band'));
  assert.ok(report.differences.some((diff) => diff.path === 'guidance.summary'));
  assert.ok(report.differences.every((diff) => !String(diff.path).includes('execution')));
});
