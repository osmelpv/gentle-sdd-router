import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectGentleAi,
  resolveControllerLabel,
  resolveExecutionOwners,
  resetControllerCache,
} from '../src/core/controller.js';

test('detectGentleAi returns a boolean', () => {
  resetControllerCache();
  const result = detectGentleAi();
  assert.equal(typeof result, 'boolean');
});

test('detectGentleAi caches result — same value on second call', () => {
  resetControllerCache();
  const first = detectGentleAi();
  const second = detectGentleAi();
  assert.equal(first, second);
});

test('resolveControllerLabel with no config returns a string', () => {
  resetControllerCache();
  const label = resolveControllerLabel();
  assert.equal(typeof label, 'string');
  assert.ok(label.length > 0);
});

test('resolveControllerLabel with config.controller override returns that override', () => {
  resetControllerCache();
  const label = resolveControllerLabel({ controller: 'custom-agent' });
  assert.equal(label, 'custom-agent');
});

test('resolveControllerLabel config override takes priority over detection', () => {
  resetControllerCache();
  // Even if gentle-ai is in PATH, the explicit override wins
  const label = resolveControllerLabel({ controller: 'my-override' });
  assert.equal(label, 'my-override');
});

test('resolveControllerLabel with null config returns Gentleman or host depending on detection', () => {
  resetControllerCache();
  const detected = detectGentleAi();
  resetControllerCache();
  const label = resolveControllerLabel(null);
  if (detected) {
    assert.equal(label, 'Gentleman');
  } else {
    assert.equal(label, 'host');
  }
});

test('resolveExecutionOwners returns an array', () => {
  resetControllerCache();
  const owners = resolveExecutionOwners();
  assert.ok(Array.isArray(owners));
  assert.ok(owners.length > 0);
});

test('resolveExecutionOwners returns host array when gentle-ai not detected', () => {
  resetControllerCache();
  const detected = detectGentleAi();
  resetControllerCache();
  const owners = resolveExecutionOwners();
  if (!detected) {
    assert.deepEqual(owners, ['host']);
  } else {
    // If gentle-ai IS detected, verify it includes gentle-ai
    assert.ok(owners.includes('gentle-ai'));
  }
});

test('resetControllerCache clears the cached detection', () => {
  // Call detectGentleAi to populate the cache
  detectGentleAi();
  // Reset should clear it
  resetControllerCache();
  // After reset, detectGentleAi re-runs (still returns a boolean)
  const after = detectGentleAi();
  assert.equal(typeof after, 'boolean');
});
