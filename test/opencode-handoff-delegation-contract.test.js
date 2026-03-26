import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHandoffDelegationBoundary,
  createHandoffDelegationRequestEnvelope,
  validateHandoffDelegationRequest,
} from '../src/adapters/opencode/handoff-delegation-contract.js';

test('handoff delegation contract validates accepted, deferred, and rejected semantics', () => {
  const boundary = createHandoffDelegationBoundary();

  const accepted = validateHandoffDelegationRequest(
    createHandoffDelegationRequestEnvelope({
      trigger: { kind: 'opencode-handoff-trigger', command: 'render' },
      payload: { requestedOutcome: 'render opencode' },
      contextCapsule: { routingFacts: { command: 'render' } },
      compatibility: 'supported',
    }),
    boundary,
  );

  assert.equal(accepted.kind, 'handoff-delegation-result');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.supported, true);
  assert.equal(accepted.result.decision, 'accepted');
  assert.equal(accepted.result.reportOnly, true);
  assert.equal(accepted.result.nonExecuting, true);
  assert.equal(accepted.request.reportOnly, true);

  const deferred = validateHandoffDelegationRequest(
    createHandoffDelegationRequestEnvelope({
      trigger: 'render opencode',
      payload: { requestedOutcome: 'render opencode' },
      contextCapsule: { routingFacts: { command: 'render' } },
      compatibility: 'limited',
    }),
    boundary,
  );

  assert.equal(deferred.kind, 'handoff-delegation-result');
  assert.equal(deferred.status, 'deferred');
  assert.equal(deferred.supported, true);
  assert.equal(deferred.result.decision, 'deferred');
  assert.ok(deferred.result.nextSteps.length > 0);

  const rejected = validateHandoffDelegationRequest(
    createHandoffDelegationRequestEnvelope({
      trigger: 'render opencode',
      payload: { requestedOutcome: 'render opencode' },
      contextCapsule: { routingFacts: { command: 'render' } },
      compatibility: 'unsupported',
    }),
    boundary,
  );

  assert.equal(rejected.kind, 'handoff-delegation-error');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.supported, false);
  assert.match(rejected.error.reason, /unsupported/i);
});

test('handoff delegation contract rejects invalid envelopes honestly', () => {
  const boundary = createHandoffDelegationBoundary();
  const invalid = validateHandoffDelegationRequest(
    createHandoffDelegationRequestEnvelope({
      payload: { requestedOutcome: 'render opencode' },
      contextCapsule: { routingFacts: { command: 'render' } },
      compatibility: 'supported',
    }),
    boundary,
  );

  assert.equal(invalid.kind, 'handoff-delegation-error');
  assert.equal(invalid.status, 'invalid-contract');
  assert.equal(invalid.supported, false);
  assert.match(invalid.error.reason, /missing a trigger/i);
});
