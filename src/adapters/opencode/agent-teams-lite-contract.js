const DEFAULT_CONTRACT_VERSION = '1';
const DEFAULT_CONSUMER = 'agent-teams-lite';
const DEFAULT_SOURCE_ORDER = ['runtime', 'providerExecution', 'handoff'];

const STATUS_SEVERITY = {
  ready: 0,
  degraded: 1,
  deferred: 2,
  blocked: 3,
  unknown: 4,
};

export function createAgentTeamsLiteIntegrationContract(report = {}, context = {}) {
  const sources = {
    runtime: normalizeRuntimeSource(report.runtimeContract, report),
    providerExecution: normalizeProviderExecutionSource(report.providerExecutionContract, report),
    handoff: normalizeHandoffSource(report.handoffDelegationContract, report),
  };
  const sourceList = DEFAULT_SOURCE_ORDER.map((source) => sources[source]);
  const status = chooseOverallStatus(sourceList.map((source) => source.status));
  const compatibility = chooseOverallCompatibility(sourceList.map((source) => source.status));

  return {
    kind: 'agent-teams-lite-integration-contract',
    consumer: DEFAULT_CONSUMER,
    contractVersion: DEFAULT_CONTRACT_VERSION,
    status,
    compatibility,
    supported: status !== 'blocked' && status !== 'unknown',
    sources,
    recovery: createRecoveryEnvelope(sourceList, report, context),
    read: createReadEnvelope(sourceList, report),
    metadata: createMetadataHandoff(report, context),
    raw: {
      runtimeContract: report.runtimeContract ?? null,
      providerExecutionContract: report.providerExecutionContract ?? null,
      handoffDelegationContract: report.handoffDelegationContract ?? null,
    },
  };
}

export function normalizeAgentTeamsLiteStatus(source, value) {
  const normalized = normalizeText(value, 'unknown');

  if (source === 'runtime') {
    return mapByTable(normalized, {
      supported: 'ready',
      limited: 'degraded',
      unsupported: 'blocked',
    }, 'unknown');
  }

  if (source === 'providerExecution') {
    return mapByTable(normalized, {
      supported: 'ready',
      limited: 'degraded',
      unsupported: 'blocked',
      'invalid-contract': 'blocked',
    }, 'unknown');
  }

  if (source === 'handoff') {
    return mapByTable(normalized, {
      accepted: 'ready',
      deferred: 'deferred',
      rejected: 'blocked',
    }, 'unknown');
  }

  return 'unknown';
}

function normalizeRuntimeSource(contract, report) {
  const status = normalizeAgentTeamsLiteStatus('runtime', contract?.supportLevel);
  const compatibility = normalizeCompatibilityFromStatus(status);
  const hints = [];
  const nextSteps = [];

  if (status === 'degraded') {
    hints.push(contract?.fallback?.reason ?? 'Runtime fallback is advisory only.');
    nextSteps.push('Read the runtime contract and keep the router config-backed.');
  } else if (status === 'blocked') {
    hints.push(contract?.fallback?.reason ?? report?.reason ?? 'Runtime input is blocked.');
    nextSteps.push('Inspect the runtime contract and router/router.yaml for the blocked state.');
  }

  return buildSourceEnvelope('runtime', contract, status, compatibility, hints, nextSteps, [
    'runtimeContract',
    'router/router.yaml',
  ], report);
}

function normalizeProviderExecutionSource(contract, report) {
  const status = normalizeAgentTeamsLiteStatus('providerExecution', contract?.status ?? contract?.error?.errorType);
  const compatibility = normalizeProviderCompatibility(contract);
  const hints = [];
  const nextSteps = [];

  if (status === 'degraded') {
    hints.push(contract?.result?.missingCapabilities?.length
      ? `Missing capabilities: ${contract.result.missingCapabilities.join(', ')}.`
      : 'Provider execution is limited by the published boundary.');
    nextSteps.push('Read the provider-execution contract before consuming the report.');
  } else if (status === 'blocked') {
    hints.push(contract?.error?.reason ?? report?.reason ?? 'Provider execution is blocked.');
    nextSteps.push('Inspect the provider-execution boundary and the reported error envelope.');
  }

  return buildSourceEnvelope('providerExecution', contract, status, compatibility, hints, nextSteps, [
    'providerExecutionContract',
    'providerExecutionBoundary',
  ], report);
}

function normalizeHandoffSource(contract, report) {
  const status = normalizeAgentTeamsLiteStatus('handoff', contract?.status);
  const compatibility = normalizeHandoffCompatibility(contract);
  const hints = [];
  const nextSteps = [];

  if (status === 'deferred') {
    hints.push(contract?.result?.reason ?? 'The handoff is deferred until downstream readiness improves.');
    nextSteps.push(...normalizeList(contract?.result?.nextSteps));
  } else if (status === 'blocked') {
    hints.push(contract?.error?.reason ?? 'The handoff report is blocked.');
    nextSteps.push(...normalizeList(contract?.error?.nextSteps));
  }

  return buildSourceEnvelope('handoff', contract, status, compatibility, hints, nextSteps, [
    'handoffDelegationContract',
    'handoffContextCapsule',
  ], report);
}

function buildSourceEnvelope(source, raw, status, compatibility, recoveryHints, nextSteps, refs, report) {
  return {
    kind: 'agent-teams-lite-source-envelope',
    source,
    status,
    compatibility,
    supported: status === 'ready' || status === 'degraded' || status === 'deferred',
    recovery: {
      hints: dedupe(recoveryHints),
      nextSteps: dedupe(nextSteps),
    },
    read: {
      available: Boolean(raw),
      refs: dedupe(refs),
    },
    metadata: createMetadataHandoff(report, { source }),
    raw: raw ?? null,
  };
}

function createRecoveryEnvelope(sources, report, context) {
  const hints = [];
  const nextSteps = [];

  for (const source of sources) {
    hints.push(...source.recovery.hints);
    nextSteps.push(...source.recovery.nextSteps);
  }

  if (hints.length === 0 && report?.reason) {
    hints.push(report.reason);
  }

  if (nextSteps.length === 0) {
    nextSteps.push('Read the report-only envelopes before deciding on follow-up actions.');
  }

  if (context?.runtimeContext?.cwd) {
    nextSteps.push(`Inspect the workspace at ${context.runtimeContext.cwd}.`);
  }

  return {
    hints: dedupe(hints),
    nextSteps: dedupe(nextSteps),
  };
}

function createReadEnvelope(sources, report) {
  const refs = [];

  for (const source of sources) {
    refs.push(...source.read.refs);
  }

  if (report?.configPath) {
    refs.push(report.configPath);
  }

  return {
    available: true,
    refs: dedupe(refs),
  };
}

function createMetadataHandoff(report, context = {}) {
  return {
    reportOnly: true,
    contractVersion: DEFAULT_CONTRACT_VERSION,
    consumer: DEFAULT_CONSUMER,
    command: report?.command ?? null,
    source: context?.source ?? 'report',
    configPath: report?.configPath ?? null,
    activeProfileName: report?.activeProfileName ?? null,
    activationState: report?.activationState ?? null,
    effectiveController: report?.effectiveController ?? null,
    runtimeSupport: report?.runtimeContract?.supportLevel ?? null,
    providerExecutionStatus: report?.providerExecutionContract?.status ?? null,
    handoffStatus: report?.handoffDelegationContract?.status ?? null,
  };
}

function normalizeProviderCompatibility(contract) {
  if (!contract) {
    return 'unknown';
  }

  if (contract.status === 'unsupported') {
    return 'unsupported';
  }

  if (contract.status === 'invalid-contract') {
    return 'unknown';
  }

  return normalizeCompatibilityFromStatus(normalizeAgentTeamsLiteStatus('providerExecution', contract.status));
}

function normalizeHandoffCompatibility(contract) {
  if (!contract) {
    return 'unknown';
  }

  if (contract.status === 'accepted') {
    return 'supported';
  }

  if (contract.status === 'deferred') {
    return 'limited';
  }

  if (contract.status === 'rejected') {
    return 'unsupported';
  }

  return 'unknown';
}

function normalizeCompatibilityFromStatus(status) {
  if (status === 'ready') {
    return 'supported';
  }

  if (status === 'degraded' || status === 'deferred') {
    return 'limited';
  }

  if (status === 'blocked') {
    return 'unsupported';
  }

  return 'unknown';
}

function chooseOverallStatus(statuses) {
  const known = statuses.filter((status) => status !== 'unknown');

  if (known.length === 0) {
    return 'unknown';
  }

  return known.sort((left, right) => STATUS_SEVERITY[left] - STATUS_SEVERITY[right]).at(-1);
}

function chooseOverallCompatibility(statuses) {
  if (statuses.includes('blocked')) {
    return 'unsupported';
  }

  if (statuses.includes('degraded') || statuses.includes('deferred')) {
    return 'limited';
  }

  if (statuses.includes('ready')) {
    return 'supported';
  }

  return 'unknown';
}

function mapByTable(value, table, fallback) {
  return table[value] ?? fallback;
}

function dedupe(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    result.push(text);
  }

  return result;
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return dedupe(list);
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text === '' ? fallback : text;
}
