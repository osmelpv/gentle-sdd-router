import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProviderExecutionBoundary,
  createProviderExecutionRequestEnvelope,
  validateProviderExecutionRequest,
} from '../src/adapters/opencode/provider-execution-contract.js';

test('provider execution contract publishes request, result, and error envelopes', () => {
  const boundary = createProviderExecutionBoundary({
    capabilities: {
      providerExecution: 'limited',
    },
  });

  const supported = validateProviderExecutionRequest(
    createProviderExecutionRequestEnvelope({
      operation: 'render',
      capability: 'render',
      requiredCapabilities: ['render'],
      contractVersion: '1',
    }),
    boundary,
  );

  assert.equal(supported.kind, 'provider-execution-result');
  assert.equal(supported.status, 'supported');
  assert.equal(supported.supported, true);
  assert.equal(supported.result.nonExecuting, true);
  assert.deepEqual(supported.result.missingCapabilities, []);

  const limited = validateProviderExecutionRequest(
    {
      operation: 'bootstrap',
      capability: 'bootstrap',
      requiredCapabilities: ['bootstrap', 'providerExecution'],
      contractVersion: '1',
    },
    boundary,
  );

  assert.equal(limited.kind, 'provider-execution-result');
  assert.equal(limited.status, 'limited');
  assert.equal(limited.supported, true);
  assert.deepEqual(limited.result.missingCapabilities, ['providerExecution']);

  const unsupported = validateProviderExecutionRequest(
    {
      operation: 'workflow',
      capability: 'workflowOrchestration',
      requiredCapabilities: ['workflowOrchestration'],
      contractVersion: '1',
    },
    boundary,
  );

  assert.equal(unsupported.kind, 'provider-execution-error');
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.supported, false);
  assert.deepEqual(unsupported.error.missingCapabilities, ['workflowOrchestration']);
});

test('provider execution contract classifies invalid envelopes honestly', () => {
  const boundary = createProviderExecutionBoundary();
  const invalid = validateProviderExecutionRequest({ capability: 'render' }, boundary);

  assert.equal(invalid.kind, 'provider-execution-error');
  assert.equal(invalid.status, 'invalid-contract');
  assert.equal(invalid.supported, false);
  assert.match(invalid.error.reason, /missing an operation/i);
});
