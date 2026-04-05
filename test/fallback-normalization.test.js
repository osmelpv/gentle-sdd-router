import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import { normalizeFallbacks, validateFallbackModelId } from '../src/core/router-v4-io.js';

describe('normalizeFallbacks', () => {
  test('CSV string → normalized array with on:[any]', () => {
    const result = normalizeFallbacks('modelA, modelB');
    assert.deepEqual(result, [
      { model: 'modelA', on: ['any'] },
      { model: 'modelB', on: ['any'] },
    ]);
  });

  test('CSV string with extra spaces is trimmed', () => {
    const result = normalizeFallbacks('  provider/model-one ,  provider/model-two  ');
    assert.deepEqual(result, [
      { model: 'provider/model-one', on: ['any'] },
      { model: 'provider/model-two', on: ['any'] },
    ]);
  });

  test('CSV string with single model → array of one', () => {
    const result = normalizeFallbacks('openai/gpt-5');
    assert.deepEqual(result, [
      { model: 'openai/gpt-5', on: ['any'] },
    ]);
  });

  test('array of strings → normalized array with on:[any]', () => {
    const result = normalizeFallbacks(['modelA', 'modelB']);
    assert.deepEqual(result, [
      { model: 'modelA', on: ['any'] },
      { model: 'modelB', on: ['any'] },
    ]);
  });

  test('already-structured array → pass through unchanged', () => {
    const input = [{ model: 'openai/gpt', on: ['quota_exceeded'] }];
    const result = normalizeFallbacks(input);
    assert.deepEqual(result, [{ model: 'openai/gpt', on: ['quota_exceeded'] }]);
  });

  test('structured array with on:[any] → pass through', () => {
    const input = [
      { model: 'anthropic/claude-sonnet', on: ['any'] },
      { model: 'openai/gpt', on: ['quota_exceeded', 'rate_limited'] },
    ];
    const result = normalizeFallbacks(input);
    assert.deepEqual(result, input);
  });

  test('null → empty array', () => {
    const result = normalizeFallbacks(null);
    assert.deepEqual(result, []);
  });

  test('undefined → empty array', () => {
    const result = normalizeFallbacks(undefined);
    assert.deepEqual(result, []);
  });

  test('empty string → empty array', () => {
    const result = normalizeFallbacks('');
    assert.deepEqual(result, []);
  });

  test('empty array → empty array', () => {
    const result = normalizeFallbacks([]);
    assert.deepEqual(result, []);
  });

  test('mixed CSV with 3+ providers works', () => {
    const result = normalizeFallbacks('mistral/mistral-large-3, opencode/qwen3.6-plus-free, opencode-go/glm-5');
    assert.equal(result.length, 3);
    assert.equal(result[0].model, 'mistral/mistral-large-3');
    assert.equal(result[1].model, 'opencode/qwen3.6-plus-free');
    assert.equal(result[2].model, 'opencode-go/glm-5');
    assert.deepEqual(result[0].on, ['any']);
  });
});

describe('validateFallbackModelId', () => {
  test('valid provider/model format → no warning', () => {
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnCalls.push(args);
    try {
      validateFallbackModelId('openai/gpt-5');
      validateFallbackModelId('anthropic/claude-sonnet');
      validateFallbackModelId('opencode-go/glm-5');
      assert.equal(warnCalls.length, 0, 'no warnings for valid model IDs');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('invalid format without slash → warns', () => {
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnCalls.push(args);
    try {
      validateFallbackModelId('gpt-5');
      assert.ok(warnCalls.length > 0, 'should warn for model ID without slash');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('empty string → warns', () => {
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnCalls.push(args);
    try {
      validateFallbackModelId('');
      assert.ok(warnCalls.length > 0, 'should warn for empty model ID');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('never throws — only warns', () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.doesNotThrow(() => validateFallbackModelId('no-slash-here'));
      assert.doesNotThrow(() => validateFallbackModelId(''));
      assert.doesNotThrow(() => validateFallbackModelId(null));
    } finally {
      console.warn = originalWarn;
    }
  });
});
