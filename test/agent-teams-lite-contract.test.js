import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAgentTeamsLiteIntegrationContract,
  normalizeAgentTeamsLiteStatus,
} from '../src/adapters/opencode/agent-teams-lite-contract.js';

test('agent-teams-lite normalization maps source statuses consistently', () => {
  assert.equal(normalizeAgentTeamsLiteStatus('runtime', 'supported'), 'ready');
  assert.equal(normalizeAgentTeamsLiteStatus('runtime', 'limited'), 'degraded');
  assert.equal(normalizeAgentTeamsLiteStatus('providerExecution', 'invalid-contract'), 'blocked');
  assert.equal(normalizeAgentTeamsLiteStatus('handoff', 'deferred'), 'deferred');
});

test('agent-teams-lite contract exposes read and recovery metadata', () => {
  const contract = createAgentTeamsLiteIntegrationContract({
    command: 'render',
    status: 'degraded',
    reason: 'Render is configuration-backed and non-executing.',
    configPath: 'router/router.yaml',
    runtimeContract: {
      supportLevel: 'limited',
      fallback: {
        reason: 'Use the shell bootstrap path.',
      },
    },
    providerExecutionContract: {
      status: 'supported',
      compatibility: 'supported',
      result: {
        missingCapabilities: [],
      },
    },
    handoffDelegationContract: {
      status: 'accepted',
      compatibility: 'supported',
      result: {
        decision: 'accepted',
        nextSteps: [],
      },
    },
  }, {
    runtimeContext: { cwd: '/tmp/gsr-contract' },
  });

  assert.equal(contract.kind, 'agent-teams-lite-integration-contract');
  assert.equal(contract.status, 'degraded');
  assert.equal(contract.compatibility, 'limited');
  assert.equal(contract.supported, true);
  assert.equal(contract.sources.runtime.status, 'degraded');
  assert.equal(contract.sources.providerExecution.status, 'ready');
  assert.equal(contract.sources.handoff.status, 'ready');
  assert.equal(contract.read.available, true);
  assert.ok(contract.read.refs.includes('router/router.yaml'));
  assert.ok(contract.recovery.hints.some((hint) => hint.includes('shell bootstrap path')));
  assert.equal(contract.metadata.reportOnly, true);
  assert.equal(contract.metadata.consumer, 'agent-teams-lite');
});
