import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectOpenCodeRuntimeCapabilities,
  evaluateOpenCodeRuntimeContract,
  normalizeOpenCodeRuntimeIntent,
} from '../src/adapters/opencode/runtime-contract.js';

test('runtime contract detects supported config-backed runtime capabilities across platforms', () => {
  const supported = detectOpenCodeRuntimeCapabilities({ platform: 'linux', release: '6.8.0-generic' });
  const windows = detectOpenCodeRuntimeCapabilities({ platform: 'win32', release: '10.0.22631' });

  assert.equal(supported.platform.state, 'supported');
  assert.equal(supported.providerExecution.state, 'unsupported');
  assert.equal(supported.fallbackSelection.state, 'limited');
  assert.equal(windows.platform.state, 'supported');
  assert.equal(windows.fallbackSelection.state, 'limited');
});

test('runtime contract normalizes aliases and duplicate intent signals', () => {
  const intent = normalizeOpenCodeRuntimeIntent({
    mode: 'preview',
    target: 'open-code',
    apply: undefined,
    intent: ['phase=apply', 'phase=apply', 'activation=active'],
  });

  assert.equal(intent.command, 'render');
  assert.equal(intent.target, 'opencode');
  assert.equal(intent.apply, false);
  assert.deepEqual(intent.fragments, ['phase=apply', 'activation=active']);
  assert.equal(intent.canonical, 'render:opencode:plan');
});

test('runtime contract reports honest fallback and limits', () => {
  const report = evaluateOpenCodeRuntimeContract({
    command: 'render',
    context: { platform: 'linux', release: '6.8.0-generic' },
    configAvailable: false,
  });

  assert.equal(report.supportLevel, 'limited');
  assert.equal(report.supported, true);
  assert.equal(report.fallback.verdict, 'minimal-fallback');
  assert.equal(report.fallback.target, 'shell');
  assert.match(report.fallback.reason, /shell bootstrap/i);
  assert.ok(report.limits.some((limit) => limit.capability === 'providerExecution'));
  assert.equal(report.capabilities.configBackedRouting.state, 'limited');
});

test('runtime contract reports minimal config-backed fallback on Windows', () => {
  const report = evaluateOpenCodeRuntimeContract({
    command: 'render',
    context: { platform: 'win32', release: '10.0.22631' },
    configAvailable: true,
  });

  assert.equal(report.supportLevel, 'limited');
  assert.equal(report.supported, true);
  assert.equal(report.fallback.verdict, 'minimal-fallback');
  assert.equal(report.fallback.target, 'config');
});
