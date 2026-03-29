import { resolveExecutionOwners } from '../../core/controller.js';

const DEFAULT_CONTRACT_VERSION = '1';
const DEFAULT_EXECUTION_OWNERS = resolveExecutionOwners();

const DEFAULT_CAPABILITIES = {
  contractPublication: 'supported',
  requestValidation: 'supported',
  render: 'supported',
  install: 'supported',
  bootstrap: 'supported',
  activate: 'supported',
  deactivate: 'supported',
  providerExecution: 'unsupported',
  workflowOrchestration: 'unsupported',
  delegationHandoff: 'unsupported',
  memoryOwnership: 'unsupported',
};

const DEFAULT_REASONS = {
  contractPublication: 'The router publishes contract metadata without executing workflows.',
  requestValidation: 'The router validates request envelopes at the boundary only.',
  render: 'Render is configuration-backed and non-executing.',
  install: 'Install translates intent into YAML updates, not provider execution.',
  bootstrap: 'Bootstrap is shell-first and still non-executing.',
  activate: 'Activation toggles routing control, not provider execution.',
  deactivate: 'Deactivation returns control to the host layer, not provider execution.',
  providerExecution: `Provider execution belongs to ${DEFAULT_EXECUTION_OWNERS.join(' or ')}, not the router.`,
  workflowOrchestration: `Workflow orchestration is owned by ${DEFAULT_EXECUTION_OWNERS.join(' and ')}.`,
  delegationHandoff: 'Delegation and handoff orchestration is outside the router boundary.',
  memoryOwnership: 'Durable memory and context ownership belongs to Engram.',
};

export const PROVIDER_EXECUTION_CONTRACT_VERSION = DEFAULT_CONTRACT_VERSION;

export function createProviderExecutionCapabilityEnvelope(name, value, reason = '') {
  const normalized = normalizeCapabilityValue(name, value, reason);

  return {
    kind: 'provider-execution-capability',
    name,
    state: normalized.state,
    supported: normalized.state === 'supported',
    limited: normalized.state === 'limited',
    unsupported: normalized.state === 'unsupported',
    reason: normalized.reason,
    details: normalized.details,
  };
}

export function createProviderExecutionBoundary(overrides = {}) {
  const capabilityOverrides = overrides.capabilities ?? {};
  const capabilities = {};

  for (const [name, state] of Object.entries(DEFAULT_CAPABILITIES)) {
    capabilities[name] = createProviderExecutionCapabilityEnvelope(
      name,
      capabilityOverrides[name] ?? state,
      DEFAULT_REASONS[name],
    );
  }

  for (const [name, value] of Object.entries(capabilityOverrides)) {
    if (name in capabilities) {
      continue;
    }

    capabilities[name] = createProviderExecutionCapabilityEnvelope(name, value, 'Custom boundary capability.');
  }

  return {
    kind: 'provider-execution-boundary',
    contractVersion: overrides.contractVersion ?? DEFAULT_CONTRACT_VERSION,
    owner: 'gentle-sdd-router',
    executionOwners: [...(overrides.executionOwners ?? DEFAULT_EXECUTION_OWNERS)],
    nonGoals: [
      'workflow orchestration',
      'delegation handoff orchestration',
      'durable memory ownership',
      'provider execution',
    ],
    capabilities,
    notes: overrides.notes ?? 'Config-first boundary publication without provider execution.',
  };
}

export function createProviderExecutionRequestEnvelope(input = {}) {
  const request = isObject(input) ? input : { operation: input };
  const operation = normalizeText(request.operation ?? request.command ?? request.action);
  const capability = normalizeText(request.capability ?? operation);
  const requiredCapabilities = normalizeList(request.requiredCapabilities ?? [capability]);

  return {
    kind: 'provider-execution-request',
    status: 'pending',
    compatibility: 'unknown',
    supported: null,
    operation,
    capability,
    requiredCapabilities,
    contractVersion: normalizeText(request.contractVersion ?? DEFAULT_CONTRACT_VERSION),
    context: normalizeObject(request.context),
    intent: request.intent ?? null,
  };
}

export function createProviderExecutionResultEnvelope(request, boundary, capability, missingCapabilities = []) {
  return {
    kind: 'provider-execution-result',
    status: capability.state,
    compatibility: capability.state,
    supported: capability.state !== 'unsupported',
    operation: request.operation,
    capability: request.capability,
    contractVersion: request.contractVersion,
    boundary,
    request,
    result: {
      execution: 'not-started',
      nonExecuting: true,
      missingCapabilities,
    },
    capabilityEnvelope: capability,
  };
}

export function createProviderExecutionErrorEnvelope(request, boundary, errorType, reason, missingCapabilities = [], capability = null) {
  return {
    kind: 'provider-execution-error',
    status: errorType,
    compatibility: errorType,
    supported: false,
    operation: request.operation,
    capability: request.capability,
    contractVersion: request.contractVersion,
    boundary,
    request,
    error: {
      errorType,
      reason,
      missingCapabilities,
      missingCapability: missingCapabilities[0] ?? null,
    },
    capabilityEnvelope: capability,
  };
}

export function validateProviderExecutionRequest(input = {}, boundaryOverrides = {}) {
  const boundary = isBoundary(boundaryOverrides)
    ? boundaryOverrides
    : createProviderExecutionBoundary(boundaryOverrides);
  const request = isRequestEnvelope(input) ? input : createProviderExecutionRequestEnvelope(input);

  if (!request.operation) {
    return createProviderExecutionErrorEnvelope(
      request,
      boundary,
      'invalid-contract',
      'Request envelope is missing an operation.',
      request.capability ? [request.capability] : [],
    );
  }

  if (!request.capability) {
    return createProviderExecutionErrorEnvelope(
      request,
      boundary,
      'invalid-contract',
      'Request envelope is missing a capability.',
      [request.operation],
    );
  }

  if (request.contractVersion !== boundary.contractVersion) {
    return createProviderExecutionErrorEnvelope(
      request,
      boundary,
      'invalid-contract',
      `Contract version ${request.contractVersion} does not match boundary version ${boundary.contractVersion}.`,
      [request.capability],
    );
  }

  const capabilityNames = request.requiredCapabilities.length > 0
    ? request.requiredCapabilities
    : [request.capability];
  const evaluated = capabilityNames.map((name) => {
    const capability = boundary.capabilities[name];
    return capability ?? createProviderExecutionCapabilityEnvelope(name, 'unsupported', 'Capability is not published by the boundary.');
  });

  const unsupportedCapabilities = evaluated
    .filter((capability) => capability.state === 'unsupported')
    .map((capability) => capability.name);

  if (unsupportedCapabilities.length > 0) {
    return createProviderExecutionErrorEnvelope(
      request,
      boundary,
      'unsupported',
      'The requested capability is not supported by the router boundary.',
      unsupportedCapabilities,
      evaluated[0],
    );
  }

  const limitedCapabilities = evaluated
    .filter((capability) => capability.state === 'limited')
    .map((capability) => capability.name);

  const capability = evaluated[0];

  if (limitedCapabilities.length > 0 || capability.state === 'limited') {
    return createProviderExecutionResultEnvelope(
      request,
      boundary,
      capability.state === 'limited' ? capability : createProviderExecutionCapabilityEnvelope(capability.name, 'limited', capability.reason),
      limitedCapabilities.length > 0 ? limitedCapabilities : [capability.name],
    );
  }

  return createProviderExecutionResultEnvelope(request, boundary, capability, []);
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

function normalizeText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text === '' ? fallback : text;
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : [value];
  const normalized = [];
  const seen = new Set();

  for (const item of list) {
    const text = normalizeText(item);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    normalized.push(text);
  }

  return normalized;
}

function normalizeObject(value) {
  return isObject(value) ? { ...value } : {};
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRequestEnvelope(value) {
  return isObject(value) && value.kind === 'provider-execution-request';
}

function isBoundary(value) {
  return isObject(value) && value.kind === 'provider-execution-boundary';
}
