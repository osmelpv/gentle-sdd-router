/**
 * Tests for shouldInvokeDebug() — pure function, no I/O.
 *
 * Strict TDD: ALL tests written first (RED phase).
 * Module: src/core/debug-invoke.js
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { shouldInvokeDebug } from '../src/core/debug-invoke.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FULL_VERIFY_OUTPUT = {
  issues: ['test failure in auth.test.js'],
  affected_files: ['src/auth.js'],
  last_change_files: ['src/auth.js'],
  test_baseline: '100/120 passing',
};

const VERIFY_OUTPUT_NO_ISSUES = {
  issues: [],
  affected_files: ['src/utils.js'],
  last_change_files: ['src/utils.js'],
  test_baseline: '120/120 passing',
};

const DEFAULT_DEBUG_INVOKE = {
  preset: 'sdd-debug-mono',
  trigger: 'on_issues',
  input_from: 'verify_output',
  required_fields: ['issues', 'affected_files', 'last_change_files', 'test_baseline'],
};

// ─── trigger: never ───────────────────────────────────────────────────────────

describe('shouldInvokeDebug — trigger: never', () => {
  test('returns invoke:false with reason:disabled when trigger is never', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'never' },
      FULL_VERIFY_OUTPUT
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'disabled');
  });

  test('returns invoke:false even when issues exist and trigger is never', () => {
    const result = shouldInvokeDebug(
      { preset: 'sdd-debug-mono', trigger: 'never' },
      FULL_VERIFY_OUTPUT
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'disabled');
  });
});

// ─── trigger: manual ─────────────────────────────────────────────────────────

describe('shouldInvokeDebug — trigger: manual', () => {
  test('returns invoke:false with reason:manual when trigger is manual', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'manual' },
      FULL_VERIFY_OUTPUT
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'manual');
  });

  test('manual trigger blocks even with issues present', () => {
    const result = shouldInvokeDebug(
      { preset: 'sdd-debug-multi', trigger: 'manual' },
      FULL_VERIFY_OUTPUT
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'manual');
  });
});

// ─── trigger: on_issues ───────────────────────────────────────────────────────

describe('shouldInvokeDebug — trigger: on_issues', () => {
  test('returns invoke:true when issues exist and all required fields present', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, FULL_VERIFY_OUTPUT);
    assert.equal(result.invoke, true);
    assert.equal(result.preset, 'sdd-debug-mono');
    assert.deepEqual(result.payload, FULL_VERIFY_OUTPUT);
  });

  test('returns invoke:false with reason:no_issues when issues array is empty', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, VERIFY_OUTPUT_NO_ISSUES);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'no_issues');
  });

  test('returns invoke:false with reason:no_issues when verifyOutput has no issues field', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, {
      affected_files: ['src/x.js'],
      last_change_files: ['src/x.js'],
      test_baseline: '10/10 passing',
    });
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'no_issues');
  });

  test('returns invoke:false with reason:no_issues when verifyOutput is null', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, null);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'no_issues');
  });

  test('returns invoke:false with reason:no_issues when verifyOutput is undefined', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, undefined);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'no_issues');
  });
});

// ─── trigger: always ─────────────────────────────────────────────────────────

describe('shouldInvokeDebug — trigger: always', () => {
  test('returns invoke:true when no issues but trigger is always and all fields present', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'always' },
      VERIFY_OUTPUT_NO_ISSUES
    );
    assert.equal(result.invoke, true);
    assert.equal(result.preset, 'sdd-debug-mono');
    assert.deepEqual(result.payload, VERIFY_OUTPUT_NO_ISSUES);
  });

  test('always trigger: returns invoke:true even with empty issues', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'always' },
      { ...FULL_VERIFY_OUTPUT, issues: [] }
    );
    assert.equal(result.invoke, true);
  });

  test('always trigger with missing required fields returns invoke:false', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'always' },
      { issues: [], affected_files: ['x.js'] } // missing last_change_files, test_baseline
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'missing_fields');
    assert.ok(Array.isArray(result.missing));
    assert.ok(result.missing.includes('last_change_files'));
    assert.ok(result.missing.includes('test_baseline'));
  });
});

// ─── missing required fields ──────────────────────────────────────────────────

describe('shouldInvokeDebug — missing required fields', () => {
  test('on_issues: missing single field returns invoke:false with missing list', () => {
    const verifyOutput = {
      issues: ['a bug'],
      affected_files: ['src/x.js'],
      last_change_files: ['src/x.js'],
      // test_baseline missing
    };
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, verifyOutput);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'missing_fields');
    assert.deepEqual(result.missing, ['test_baseline']);
  });

  test('on_issues: missing multiple fields returns all missing in array', () => {
    const verifyOutput = {
      issues: ['a bug'],
      // affected_files, last_change_files, test_baseline all missing
    };
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, verifyOutput);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'missing_fields');
    assert.ok(result.missing.includes('affected_files'));
    assert.ok(result.missing.includes('last_change_files'));
    assert.ok(result.missing.includes('test_baseline'));
    assert.equal(result.missing.length, 3);
  });

  test('missing fields: payload is not set on invoke:false result', () => {
    const verifyOutput = { issues: ['bug'] };
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, verifyOutput);
    assert.equal(result.invoke, false);
    assert.equal(result.payload, undefined);
  });

  test('no required_fields in debug_invoke defaults to no validation — invoke:true when issues present', () => {
    const debugInvoke = {
      preset: 'sdd-debug-mono',
      trigger: 'on_issues',
      input_from: 'verify_output',
      // required_fields absent
    };
    const result = shouldInvokeDebug(debugInvoke, FULL_VERIFY_OUTPUT);
    assert.equal(result.invoke, true);
    assert.equal(result.preset, 'sdd-debug-mono');
  });
});

// ─── null/undefined debugInvoke ───────────────────────────────────────────────

describe('shouldInvokeDebug — null/undefined debugInvoke', () => {
  test('null debugInvoke returns invoke:false with reason:disabled', () => {
    const result = shouldInvokeDebug(null, FULL_VERIFY_OUTPUT);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'disabled');
  });

  test('undefined debugInvoke returns invoke:false with reason:disabled', () => {
    const result = shouldInvokeDebug(undefined, FULL_VERIFY_OUTPUT);
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'disabled');
  });
});

// ─── return shape contract ────────────────────────────────────────────────────

describe('shouldInvokeDebug — return shape', () => {
  test('invoke:true result has preset and payload fields', () => {
    const result = shouldInvokeDebug(DEFAULT_DEBUG_INVOKE, FULL_VERIFY_OUTPUT);
    assert.ok('invoke' in result);
    assert.ok('preset' in result);
    assert.ok('payload' in result);
    assert.equal(typeof result.invoke, 'boolean');
    assert.equal(typeof result.preset, 'string');
  });

  test('invoke:false result has reason field', () => {
    const result = shouldInvokeDebug(
      { ...DEFAULT_DEBUG_INVOKE, trigger: 'never' },
      FULL_VERIFY_OUTPUT
    );
    assert.ok('invoke' in result);
    assert.ok('reason' in result);
    assert.equal(result.invoke, false);
    assert.equal(typeof result.reason, 'string');
  });

  test('invoke:false with missing_fields has missing array', () => {
    const result = shouldInvokeDebug(
      DEFAULT_DEBUG_INVOKE,
      { issues: ['bug'] } // missing 3 fields
    );
    assert.equal(result.invoke, false);
    assert.equal(result.reason, 'missing_fields');
    assert.ok(Array.isArray(result.missing));
  });

  test('preset in return matches debugInvoke.preset', () => {
    const debugInvoke = { ...DEFAULT_DEBUG_INVOKE, preset: 'sdd-debug-multi' };
    const result = shouldInvokeDebug(debugInvoke, FULL_VERIFY_OUTPUT);
    assert.equal(result.preset, 'sdd-debug-multi');
  });
});
