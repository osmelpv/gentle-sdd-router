import {
  PROVIDER_EXECUTION_CONTRACT_VERSION,
  createProviderExecutionBoundary,
  createProviderExecutionRequestEnvelope,
  validateProviderExecutionRequest,
} from './provider-execution-contract.js';

const COMMAND_ALIASES = {
  render: 'render',
  preview: 'render',
  install: 'install',
  apply: 'install',
  bootstrap: 'bootstrap',
  adopt: 'bootstrap',
  activate: 'activate',
  enable: 'activate',
  deactivate: 'deactivate',
  disable: 'deactivate',
};

const TARGET_ALIASES = {
  opencode: 'opencode',
  'open-code': 'opencode',
  gsr: 'opencode',
  router: 'opencode',
};

export function detectOpenCodeRuntimeCapabilities(context = {}) {
  const platform = context.platform ?? 'unknown';
  const release = context.release ?? '';
  const isLinux = context.isLinux ?? platform === 'linux';
  const isWSL = context.isWSL ?? (platform === 'linux' && /microsoft|wsl/i.test(release));
  const platformValidated = context.supported ?? (isLinux || isWSL);

  return {
    platform: {
      state: platformValidated ? 'supported' : 'unsupported',
      reason: platformValidated
        ? 'Linux or WSL runtime detected.'
        : 'OpenCode runtime is only supported on Linux/WSL in v1.',
    },
    providerExecution: {
      state: 'unsupported',
      reason: 'Provider execution is out of scope for runtime-contract v1.',
    },
    intentNormalization: {
      state: 'supported',
      reason: 'Runtime intent is normalized before routing decisions are made.',
    },
    fallbackSelection: {
      state: platformValidated ? 'limited' : 'unsupported',
      reason: platformValidated
        ? 'Only a minimal non-executing fallback path is available.'
        : 'No safe fallback exists on this platform.',
    },
    supported: platformValidated,
  };
}

export function normalizeOpenCodeRuntimeIntent(rawIntent = {}) {
  const source = Array.isArray(rawIntent)
    ? { intent: rawIntent }
    : isObject(rawIntent)
      ? rawIntent
      : { intent: rawIntent };

  const command = normalizeCommand(source.command ?? source.mode ?? source.action ?? source.operation);
  const target = normalizeTarget(source.target ?? source.adapter ?? source.runtime ?? 'opencode');
  const apply = normalizeApply(source.apply, command);
  const fragments = normalizeFragments(source.intent ?? source.fragments ?? source.rawIntent ?? source.request);

  return {
    command,
    target,
    apply,
    fragments,
    raw: source.intent ?? source.rawIntent ?? null,
    aliases: collectAliases(source),
    canonical: `${command}:${target}:${apply ? 'apply' : 'plan'}`,
  };
}

export function evaluateOpenCodeRuntimeContract({
  command = 'render',
  context = {},
  intent = undefined,
  configAvailable = false,
  configValid = true,
} = {}) {
  const capabilities = detectOpenCodeRuntimeCapabilities(context);
  const normalizedIntent = normalizeOpenCodeRuntimeIntent({ command, intent });
  const providerExecutionBoundary = createProviderExecutionBoundary();
  const providerExecutionRequest = createProviderExecutionRequestEnvelope({
    operation: normalizedIntent.command,
    capability: normalizedIntent.command,
    requiredCapabilities: [normalizedIntent.command],
    contractVersion: PROVIDER_EXECUTION_CONTRACT_VERSION,
    context: {
      command: normalizedIntent.command,
      target: normalizedIntent.target,
      apply: normalizedIntent.apply,
      configAvailable,
      configValid,
      platformSupported: capabilities.supported,
    },
    intent: normalizedIntent,
  });
  const providerExecutionContract = validateProviderExecutionRequest(
    providerExecutionRequest,
    providerExecutionBoundary,
  );
  const limits = [];

  addLimit(limits, 'providerExecution', capabilities.providerExecution.state, capabilities.providerExecution.reason);
  addLimit(
    limits,
    'providerExecutionContract',
    providerExecutionContract.status,
    providerExecutionContract.supported
      ? 'The router publishes and validates the requested boundary without executing it.'
      : providerExecutionContract.error?.reason ?? 'The router boundary rejected the request.',
  );

  if (!capabilities.supported) {
    addLimit(limits, 'platform', capabilities.platform.state, capabilities.platform.reason);
  }

  if (!configValid) {
    addLimit(limits, 'routerConfig', 'unsupported', 'router/router.yaml is invalid and cannot be treated as a safe runtime input.');
  } else if (!configAvailable) {
    addLimit(limits, 'routerConfig', 'limited', 'router/router.yaml is missing; only the shell bootstrap fallback is available.');
  } else {
    addLimit(limits, 'routerConfig', 'supported', 'router/router.yaml is available for configuration-backed routing.');
  }

  const configBackedRouting = {
    state: !configValid ? 'unsupported' : (configAvailable ? 'supported' : 'limited'),
    reason: !configValid
      ? 'The router config is invalid.'
      : configAvailable
        ? 'The runtime contract can stay configuration-backed.'
        : 'The router can fall back to a shell bootstrap path until router/router.yaml exists.',
  };

  const supportLevel = !capabilities.supported || !configValid
    ? 'unsupported'
    : 'limited';

  return {
    target: normalizedIntent.target,
    command: normalizedIntent.command,
    supportLevel,
    supported: supportLevel !== 'unsupported',
    providerExecutionContract,
    capabilities: {
      ...capabilities,
      configBackedRouting,
    },
    intent: normalizedIntent,
    limits,
    fallback: chooseFallback({
      command: normalizedIntent.command,
      configAvailable,
      configValid,
      capabilities,
    }),
  };
}

function chooseFallback({ command, configAvailable, configValid, capabilities }) {
  if (!capabilities.supported || !configValid) {
    return {
      verdict: 'no-safe-fallback',
      target: 'none',
      reason: !capabilities.supported
        ? 'The runtime is not available on this platform.'
        : 'The router config is invalid, so no safe fallback can be trusted.',
    };
  }

  if (!configAvailable) {
    return {
      verdict: 'minimal-fallback',
      target: 'shell',
      reason: 'Use the shell bootstrap path to create router/router.yaml before any runtime action.',
    };
  }

  return {
    verdict: 'minimal-fallback',
    target: command === 'render' ? 'config' : 'config',
    reason: 'Keep the adapter configuration-backed; do not execute provider work in v1.',
  };
}

function addLimit(limits, capability, state, reason) {
  limits.push({ capability, state, reason });
}

function normalizeCommand(value) {
  const text = String(value ?? 'render').trim().toLowerCase();
  return COMMAND_ALIASES[text] ?? 'render';
}

function normalizeTarget(value) {
  const text = String(value ?? 'opencode').trim().toLowerCase();
  return TARGET_ALIASES[text] ?? 'opencode';
}

function normalizeApply(value, command) {
  if (value === true || value === false) {
    return value;
  }

  if (command === 'install') {
    return true;
  }

  if (command === 'bootstrap') {
    return false;
  }

  return false;
}

function normalizeFragments(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const parts = Array.isArray(value)
    ? value
    : String(value).split(/[;\n]/);

  const fragments = [];
  const seen = new Set();

  for (const part of parts) {
    const fragment = String(part).trim();
    if (!fragment || seen.has(fragment)) {
      continue;
    }

    seen.add(fragment);
    fragments.push(fragment);
  }

  return fragments;
}

function collectAliases(source) {
  const aliases = [];

  if (source.mode !== undefined) {
    aliases.push(`mode=${source.mode}`);
  }

  if (source.action !== undefined) {
    aliases.push(`action=${source.action}`);
  }

  if (source.operation !== undefined) {
    aliases.push(`operation=${source.operation}`);
  }

  if (source.adapter !== undefined) {
    aliases.push(`adapter=${source.adapter}`);
  }

  if (source.runtime !== undefined) {
    aliases.push(`runtime=${source.runtime}`);
  }

  return aliases;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
