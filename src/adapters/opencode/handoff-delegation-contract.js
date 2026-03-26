const DEFAULT_CONTRACT_VERSION = '1';
const DEFAULT_ROUTER_OWNER = 'gentle-sdd-router';
const DEFAULT_DOWNSTREAM_CONSUMER = 'agent-teams-lite';

const DEFAULT_CAPABILITIES = {
  triggerPublication: 'supported',
  payloadPublication: 'supported',
  contextCapsule: 'supported',
  compatibilityGating: 'supported',
  acceptance: 'supported',
  rejection: 'supported',
  deferred: 'supported',
  recoveryHints: 'limited',
  nextSteps: 'limited',
  orchestration: 'unsupported',
  workflowOwnership: 'unsupported',
  delegationExecution: 'unsupported',
  memoryOwnership: 'unsupported',
};

const DEFAULT_REASONS = {
  triggerPublication: 'The router publishes report-only handoff triggers.',
  payloadPublication: 'The handoff payload identifies the requested outcome only.',
  contextCapsule: 'The context capsule carries minimal routing facts and environment hints.',
  compatibilityGating: 'Compatibility is evaluated without executing orchestration.',
  acceptance: 'Accepted handoffs remain report-only and non-executing.',
  rejection: 'Rejected handoffs explain why the report cannot be accepted.',
  deferred: 'Deferred handoffs wait for downstream readiness without side effects.',
  recoveryHints: 'Recovery hints are advisory metadata for downstream consumers.',
  nextSteps: 'Next steps are advisory metadata for downstream consumers.',
  orchestration: 'Workflow orchestration belongs to downstream consumers, not the router.',
  workflowOwnership: 'The router does not own workflow execution or scheduling.',
  delegationExecution: 'Delegation execution is outside the router boundary.',
  memoryOwnership: 'Durable memory ownership belongs to Engram.',
};

export const HANDOFF_DELEGATION_CONTRACT_VERSION = DEFAULT_CONTRACT_VERSION;

export function createHandoffDelegationTriggerEnvelope(name, value, reason = '') {
  const normalized = normalizeCapabilityValue(name, value, reason);

  return {
    kind: 'handoff-delegation-capability',
    name,
    state: normalized.state,
    supported: normalized.state === 'supported',
    limited: normalized.state === 'limited',
    unsupported: normalized.state === 'unsupported',
    reason: normalized.reason,
    details: normalized.details,
  };
}

export function createHandoffDelegationBoundary(overrides = {}) {
  const capabilityOverrides = overrides.capabilities ?? {};
  const capabilities = {};

  for (const [name, state] of Object.entries(DEFAULT_CAPABILITIES)) {
    capabilities[name] = createHandoffDelegationTriggerEnvelope(
      name,
      capabilityOverrides[name] ?? state,
      DEFAULT_REASONS[name],
    );
  }

  for (const [name, value] of Object.entries(capabilityOverrides)) {
    if (name in capabilities) {
      continue;
    }

    capabilities[name] = createHandoffDelegationTriggerEnvelope(name, value, 'Custom handoff boundary capability.');
  }

  return {
    kind: 'handoff-delegation-boundary',
    contractVersion: overrides.contractVersion ?? DEFAULT_CONTRACT_VERSION,
    owner: overrides.owner ?? DEFAULT_ROUTER_OWNER,
    downstreamConsumer: overrides.downstreamConsumer ?? DEFAULT_DOWNSTREAM_CONSUMER,
    consumerOwners: [...(overrides.consumerOwners ?? [DEFAULT_DOWNSTREAM_CONSUMER])],
    reportOnly: true,
    nonGoals: [
      'workflow orchestration',
      'delegation execution',
      'provider execution',
      'durable memory ownership',
    ],
    capabilities,
    notes: overrides.notes ?? 'Config-first report-only handoff boundary publication.',
  };
}

export function createHandoffDelegationRequestEnvelope(input = {}) {
  const request = isObject(input) ? input : { trigger: input };
  const trigger = normalizeTrigger(request.trigger ?? request.event ?? request.command ?? request.operation);
  const payload = normalizePayload(request.payload ?? request.requestedOutcome ?? request.outcome ?? request.intent);
  const contextCapsule = normalizeContextCapsule(request.contextCapsule ?? request.context ?? request.capsule);

  return {
    kind: 'handoff-delegation-request',
    status: 'pending',
    compatibility: normalizeCompatibility(request.compatibility ?? request.consumerCompatibility),
    supported: null,
    trigger,
    payload,
    contextCapsule,
    contractVersion: normalizeText(request.contractVersion ?? DEFAULT_CONTRACT_VERSION),
    consumerContractVersion: normalizeText(request.consumerContractVersion ?? DEFAULT_CONTRACT_VERSION),
    downstreamConsumer: normalizeText(request.downstreamConsumer ?? DEFAULT_DOWNSTREAM_CONSUMER),
    reportOnly: true,
  };
}

export function createHandoffDelegationResultEnvelope(request, boundary, status, reason, recoveryHints = [], nextSteps = []) {
  return {
    kind: 'handoff-delegation-result',
    status,
    compatibility: status === 'accepted' ? 'supported' : 'limited',
    supported: true,
    trigger: request.trigger,
    payload: request.payload,
    contextCapsule: request.contextCapsule,
    contractVersion: request.contractVersion,
    boundary,
    request,
    result: {
      decision: status,
      reportOnly: true,
      nonExecuting: true,
      reason,
      recoveryHints,
      nextSteps,
    },
  };
}

export function createHandoffDelegationErrorEnvelope(request, boundary, status, reason, missingFields = [], recoveryHints = [], nextSteps = []) {
  return {
    kind: 'handoff-delegation-error',
    status,
    compatibility: status === 'invalid-contract' ? 'unknown' : 'unsupported',
    supported: false,
    trigger: request.trigger,
    payload: request.payload,
    contextCapsule: request.contextCapsule,
    contractVersion: request.contractVersion,
    boundary,
    request,
    error: {
      errorType: status,
      reason,
      missingFields,
      missingField: missingFields[0] ?? null,
      recoveryHints,
      nextSteps,
    },
  };
}

export function validateHandoffDelegationRequest(input = {}, boundaryOverrides = {}) {
  const boundary = isBoundary(boundaryOverrides)
    ? boundaryOverrides
    : createHandoffDelegationBoundary(boundaryOverrides);
  const request = isRequestEnvelope(input) ? input : createHandoffDelegationRequestEnvelope(input);

  if (!request.trigger) {
    return createHandoffDelegationErrorEnvelope(
      request,
      boundary,
      'invalid-contract',
      'Request envelope is missing a trigger.',
      ['trigger'],
      [],
      ['Publish a trigger before building the handoff report.'],
    );
  }

  const missingFields = [];
  if (!request.payload || Object.keys(request.payload).length === 0) {
    missingFields.push('payload');
  }

  if (!request.contextCapsule || Object.keys(request.contextCapsule).length === 0) {
    missingFields.push('contextCapsule');
  }

  if (missingFields.length > 0) {
    return createHandoffDelegationErrorEnvelope(
      request,
      boundary,
      'rejected',
      'Request envelope is missing required report-only fields.',
      missingFields,
      ['Capture the payload and context capsule before publishing the handoff report.'],
      ['Rebuild the report with bounded context and payload metadata.'],
    );
  }

  if (request.contractVersion !== boundary.contractVersion) {
    return createHandoffDelegationErrorEnvelope(
      request,
      boundary,
      'invalid-contract',
      `Contract version ${request.contractVersion} does not match boundary version ${boundary.contractVersion}.`,
      ['contractVersion'],
      ['Align the handoff contract version before publishing.'],
      ['Regenerate the report using the boundary contract version.'],
    );
  }

  if (request.compatibility === 'unsupported') {
    return createHandoffDelegationErrorEnvelope(
      request,
      boundary,
      'rejected',
      'The downstream consumer contract is unsupported for this handoff.',
      ['compatibility'],
      ['Keep the report-only boundary and hand off to the downstream consumer later.'],
      ['Record the unsupported state for downstream review.'],
    );
  }

  if (request.compatibility === 'limited' || request.compatibility === 'unknown') {
    return createHandoffDelegationResultEnvelope(
      request,
      boundary,
      'deferred',
      'The downstream consumer contract is not ready for acceptance yet.',
      ['Retry when downstream compatibility is confirmed.'],
      ['Keep the report-only payload available for a later handoff.'],
    );
  }

  return createHandoffDelegationResultEnvelope(
    request,
    boundary,
    'accepted',
    'The downstream consumer contract is compatible.',
    [],
    [],
  );
}

function normalizeCapabilityValue(name, value, fallbackReason) {
  if (isObject(value)) {
    const state = normalizeState(value.state ?? value.status ?? value.compatibility ?? 'unsupported');
    return {
      state,
      reason: normalizeText(value.reason ?? fallbackReason),
      details: {
        ...value,
        name,
        state,
        reason: normalizeText(value.reason ?? fallbackReason),
      },
    };
  }

  const state = normalizeState(value);
  return {
    state,
    reason: fallbackReason,
    details: {
      name,
      state,
      reason: fallbackReason,
    },
  };
}

function normalizeState(value) {
  const text = normalizeText(value, 'unsupported');
  return text === 'supported' || text === 'limited' || text === 'unsupported'
    ? text
    : 'unsupported';
}

function normalizeCompatibility(value) {
  const text = normalizeText(value, 'unknown');
  return text === 'supported' || text === 'limited' || text === 'unsupported' || text === 'unknown'
    ? text
    : 'unknown';
}

function normalizeTrigger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (isObject(value)) {
    return {
      ...value,
      kind: normalizeText(value.kind ?? 'handoff-trigger'),
    };
  }

  return {
    kind: 'handoff-trigger',
    value: normalizeText(value),
  };
}

function normalizePayload(value) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (isObject(value)) {
    return normalizeObject(value);
  }

  return {
    requestedOutcome: normalizeText(value),
  };
}

function normalizeContextCapsule(value) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (isObject(value)) {
    return {
      ...normalizeObject(value),
      kind: normalizeText(value.kind ?? 'handoff-context-capsule'),
      scope: normalizeText(value.scope ?? 'report-only'),
    };
  }

  return {
    kind: 'handoff-context-capsule',
    scope: 'report-only',
    value: normalizeText(value),
  };
}

function normalizeObject(value) {
  if (!isObject(value)) {
    return {};
  }

  return { ...value };
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text === '' ? fallback : text;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundary(value) {
  return isObject(value) && value.kind === 'handoff-delegation-boundary';
}

function isRequestEnvelope(value) {
  return isObject(value) && value.kind === 'handoff-delegation-request';
}
