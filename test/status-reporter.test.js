/**
 * Tests for src/core/status-reporter.js
 *
 * Covers: getSimpleStatus(), getDetailedStatus()
 * Status levels: configured, synchronized, visible, ready, requires_reopen, error
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getSimpleStatus,
  getDetailedStatus,
  STATUS_LEVELS,
} from '../src/core/status-reporter.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid config object */
const minConfig = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      enabled: true,
      presets: {
        balanced: {
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet' }],
          },
        },
      },
    },
  },
};

/** Sync result with all steps ok and no reopen needed */
const syncOk = {
  status: 'ok',
  requiresReopen: false,
  noop: false,
  steps: [
    { name: 'contracts', status: 'ok', data: { roles: 2, phases: 5, total: 7 } },
    { name: 'overlay', status: 'ok', data: { agent: { 'gsr-balanced': {} }, warnings: [] } },
    { name: 'apply', status: 'ok', data: { gsrCount: 1, writtenPath: '/project/opencode.json' } },
    { name: 'commands', status: 'ok', data: { written: 3, skipped: 0 } },
    { name: 'validate', status: 'ok', data: { expectedAgents: 1, agentsVisible: 1, missingAgents: [] } },
  ],
  warnings: [],
};

/** Sync result where agent changes require editor reopen */
const syncRequiresReopen = {
  ...syncOk,
  requiresReopen: true,
};

/** Sync result with overlay step failed */
const syncPartial = {
  status: 'partial',
  requiresReopen: false,
  noop: false,
  steps: [
    { name: 'contracts', status: 'ok', data: { roles: 2, phases: 5, total: 7 } },
    { name: 'overlay', status: 'failed', error: 'No config found' },
    { name: 'apply', status: 'skipped', data: { reason: 'overlay step failed' } },
    { name: 'commands', status: 'ok', data: { written: 0, skipped: 0 } },
    { name: 'validate', status: 'ok', data: { expectedAgents: 0, agentsVisible: 0, missingAgents: [] } },
  ],
  warnings: ['No config found — overlay is empty'],
};

// ── STATUS_LEVELS export ───────────────────────────────────────────────────

describe('STATUS_LEVELS constant', () => {
  test('exports an object with all six level keys', () => {
    const keys = Object.keys(STATUS_LEVELS);
    assert.ok(keys.includes('configured'));
    assert.ok(keys.includes('synchronized'));
    assert.ok(keys.includes('visible'));
    assert.ok(keys.includes('ready'));
    assert.ok(keys.includes('requires_reopen'));
    assert.ok(keys.includes('error'));
  });

  test('each level has emoji and message', () => {
    for (const [key, level] of Object.entries(STATUS_LEVELS)) {
      assert.ok(typeof level.emoji === 'string', `${key} should have emoji`);
      assert.ok(level.emoji.length > 0, `${key} emoji should not be empty`);
      assert.ok(typeof level.message === 'string', `${key} should have message`);
      assert.ok(level.message.length > 0, `${key} message should not be empty`);
    }
  });
});

// ── getSimpleStatus — null/missing inputs ──────────────────────────────────

describe('getSimpleStatus — no config', () => {
  test('returns error level when config is null', () => {
    const result = getSimpleStatus(null, null);
    assert.equal(result.level, 'error');
    assert.ok(typeof result.emoji === 'string');
    assert.ok(typeof result.message === 'string');
  });

  test('returns error level when config is undefined', () => {
    const result = getSimpleStatus(undefined, undefined);
    assert.equal(result.level, 'error');
  });
});

// ── getSimpleStatus — configured (no sync result) ─────────────────────────

describe('getSimpleStatus — configured only', () => {
  test('returns configured level when config present and no sync result', () => {
    const result = getSimpleStatus(minConfig, null);
    assert.equal(result.level, 'configured');
    assert.ok(result.emoji.length > 0);
    assert.ok(result.message.length > 0);
  });

  test('configured level message does NOT contain internal terms', () => {
    const result = getSimpleStatus(minConfig, null);
    const lower = result.message.toLowerCase();
    assert.ok(!lower.includes('overlay'), 'should not expose overlay term');
    assert.ok(!lower.includes('manifest'), 'should not expose manifest term');
    assert.ok(!lower.includes('_gsr_generated'), 'should not expose internal marker');
  });
});

// ── getSimpleStatus — synchronized ────────────────────────────────────────

describe('getSimpleStatus — synchronized', () => {
  test('returns synchronized level when sync status is ok and no reopen', () => {
    const result = getSimpleStatus(minConfig, syncOk);
    assert.equal(result.level, 'synchronized');
  });

  test('synchronized emoji is the sync/refresh emoji', () => {
    const result = getSimpleStatus(minConfig, syncOk);
    assert.equal(result.emoji, '🔄');
  });

  test('synchronized message does NOT expose internal details', () => {
    const result = getSimpleStatus(minConfig, syncOk);
    const lower = result.message.toLowerCase();
    assert.ok(!lower.includes('overlay'));
    assert.ok(!lower.includes('step'));
    assert.ok(!lower.includes('manifest'));
  });
});

// ── getSimpleStatus — requires_reopen ─────────────────────────────────────

describe('getSimpleStatus — requires_reopen', () => {
  test('returns requires_reopen level when sync requiresReopen is true', () => {
    const result = getSimpleStatus(minConfig, syncRequiresReopen);
    assert.equal(result.level, 'requires_reopen');
  });

  test('requires_reopen message contains actionable guidance', () => {
    const result = getSimpleStatus(minConfig, syncRequiresReopen);
    // Should tell user to reopen — but in simple terms
    const lower = result.message.toLowerCase();
    assert.ok(
      lower.includes('reopen') || lower.includes('restart') || lower.includes('reload'),
      'message should mention reopen/restart/reload'
    );
  });
});

// ── getSimpleStatus — error ───────────────────────────────────────────────

describe('getSimpleStatus — error', () => {
  test('returns error level when sync status is failed', () => {
    const failedSync = { ...syncOk, status: 'failed', requiresReopen: false };
    const result = getSimpleStatus(minConfig, failedSync);
    assert.equal(result.level, 'error');
  });

  test('error result includes a message explaining the issue', () => {
    const failedSync = {
      ...syncOk,
      status: 'failed',
      steps: [
        { name: 'contracts', status: 'failed', error: 'Contracts directory not found' },
      ],
      warnings: [],
    };
    const result = getSimpleStatus(minConfig, failedSync);
    assert.equal(result.level, 'error');
    assert.ok(result.message.length > 0);
  });
});

// ── getSimpleStatus — result shape ────────────────────────────────────────

describe('getSimpleStatus — result shape', () => {
  test('always returns an object with level, emoji, message', () => {
    const cases = [
      [null, null],
      [minConfig, null],
      [minConfig, syncOk],
      [minConfig, syncRequiresReopen],
    ];
    for (const [config, syncResult] of cases) {
      const result = getSimpleStatus(config, syncResult);
      assert.ok(typeof result === 'object' && result !== null);
      assert.ok(typeof result.level === 'string', 'level should be string');
      assert.ok(typeof result.emoji === 'string', 'emoji should be string');
      assert.ok(typeof result.message === 'string', 'message should be string');
    }
  });

  test('level is always one of the valid STATUS_LEVELS keys', () => {
    const validLevels = Object.keys(STATUS_LEVELS);
    const cases = [
      [null, null],
      [minConfig, null],
      [minConfig, syncOk],
      [minConfig, syncRequiresReopen],
      [minConfig, { ...syncOk, status: 'failed' }],
    ];
    for (const [config, syncResult] of cases) {
      const result = getSimpleStatus(config, syncResult);
      assert.ok(validLevels.includes(result.level), `level "${result.level}" is not valid`);
    }
  });
});

// ── getDetailedStatus ────────────────────────────────────────────────────

describe('getDetailedStatus — basic shape', () => {
  test('returns object with level, emoji, message, and details', () => {
    const result = getDetailedStatus(minConfig, syncOk);
    assert.ok(typeof result.level === 'string');
    assert.ok(typeof result.emoji === 'string');
    assert.ok(typeof result.message === 'string');
    assert.ok(typeof result.details === 'object' && result.details !== null);
  });

  test('details contains steps array from sync result', () => {
    const result = getDetailedStatus(minConfig, syncOk);
    assert.ok(Array.isArray(result.details.steps));
    assert.equal(result.details.steps.length, syncOk.steps.length);
  });

  test('details exposes requiresReopen flag', () => {
    const result = getDetailedStatus(minConfig, syncRequiresReopen);
    assert.equal(result.details.requiresReopen, true);
  });
});

describe('getDetailedStatus — exposes internal info', () => {
  test('details includes overlay agent count', () => {
    const result = getDetailedStatus(minConfig, syncOk);
    // The details object should have something about the overlay/agents
    const detailStr = JSON.stringify(result.details);
    // Either the steps contain the overlay step or there's an agent count
    assert.ok(
      detailStr.includes('overlay') || detailStr.includes('agent') || detailStr.includes('gsrCount'),
      'details should contain overlay/agent info'
    );
  });

  test('details includes config active preset', () => {
    const result = getDetailedStatus(minConfig, syncOk);
    assert.equal(result.details.activePreset, 'balanced');
  });

  test('details includes config active catalog', () => {
    const result = getDetailedStatus(minConfig, syncOk);
    assert.equal(result.details.activeCatalog, 'default');
  });
});

describe('getDetailedStatus — null inputs', () => {
  test('handles null config gracefully', () => {
    const result = getDetailedStatus(null, null);
    assert.equal(result.level, 'error');
    assert.ok(typeof result.details === 'object');
  });

  test('handles null syncResult with valid config', () => {
    const result = getDetailedStatus(minConfig, null);
    assert.equal(result.level, 'configured');
    assert.ok(typeof result.details === 'object');
  });
});

// ── Vocabulary contract (simple status should use simple words) ───────────

describe('getSimpleStatus — vocabulary contract', () => {
  const FORBIDDEN_INTERNAL_TERMS = [
    'overlay',
    'manifest',
    '_gsr_generated',
    'boundary',
    'execution mode',
    'host sync metadata',
    'sync-manifest',
  ];

  const cases = [
    ['null config', null, null],
    ['configured only', minConfig, null],
    ['synchronized', minConfig, syncOk],
    ['requires_reopen', minConfig, syncRequiresReopen],
    ['partial sync', minConfig, syncPartial],
  ];

  for (const [caseName, config, syncResult] of cases) {
    test(`simple status for "${caseName}" hides internal terms`, () => {
      const result = getSimpleStatus(config, syncResult);
      const lower = result.message.toLowerCase();
      for (const term of FORBIDDEN_INTERNAL_TERMS) {
        assert.ok(
          !lower.includes(term.toLowerCase()),
          `"${caseName}": message should not contain "${term}" — got: "${result.message}"`
        );
      }
    });
  }
});
