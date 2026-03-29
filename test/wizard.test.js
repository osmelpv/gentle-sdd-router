import assert from 'node:assert/strict';
import test from 'node:test';
import { runWizard } from '../src/ux/wizard.js';

test('runWizard is exported as a function', () => {
  assert.equal(typeof runWizard, 'function');
});

test('runWizard is an async function', () => {
  // Async functions return a Promise when called; we can check via the prototype
  assert.ok(runWizard.constructor.name === 'AsyncFunction');
});
