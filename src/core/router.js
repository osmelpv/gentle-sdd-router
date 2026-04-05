import { normalizeRouterSchemaV3, validateRouterSchemaV3 } from './router-schema-v3.js';
import { findPresetOwner } from './public-preset-metadata.js';

/**
 * Standard SDD phases. These are the conventional phase names used by
 * gentle-ai and the built-in presets. Custom phases beyond this set
 * are fully supported by the schema — catalogs/presets can define any
 * phase name as a routing key.
 */
const CANONICAL_PHASES = [
  'orchestrator',
  'explore',
  'spec',
  'design',
  'tasks',
  'apply',
  'verify',
  'archive',
];

export function setActiveProfile(config, profileName) {
  // v4 assembled configs have version: 3 after assembly, so the v3 path below handles them.
  if (config.version === 3) {
    const requested = profileName.trim();
    const [catalogNameFromSelector, presetNameFromSelector] = requested.includes('/')
      ? requested.split('/', 2)
      : [null, requested];

    let catalogName = catalogNameFromSelector?.trim() || null;
    const presetName = presetNameFromSelector?.trim();

    if (!presetName) {
      throw new Error(`Preset "${profileName}" does not exist.`);
    }

    if (catalogName) {
      if (!config.catalogs?.[catalogName]) {
        throw new Error(`Source "${catalogName}" does not exist.`);
      }
      if (!config.catalogs[catalogName].presets?.[presetName]) {
        throw new Error(`Preset "${presetName}" does not exist in source "${catalogName}".`);
      }
    } else {
      const owner = findPresetOwner(config, presetName);
      if (!owner) {
        throw new Error(`Preset "${presetName}" does not exist.`);
      }
      catalogName = owner.catalogName;
    }

    const newConfig = {
      ...config,
      active_catalog: catalogName,
      active_preset: presetName,
      active_profile: presetName,
    };

    // Object spread does not copy non-enumerable properties; preserve _v4Source explicitly.
    // Also update coreConfig inside _v4Source so buildV4WritePlan writes the new active_preset.
    const v4SourceDescriptor = Object.getOwnPropertyDescriptor(config, '_v4Source');
    if (v4SourceDescriptor) {
      const originalSource = v4SourceDescriptor.value;
      const updatedSource = originalSource
        ? {
            ...originalSource,
            coreConfig: {
              ...(originalSource.coreConfig ?? {}),
              active_catalog: catalogName,
              active_preset: presetName,
            },
          }
        : originalSource;

      Object.defineProperty(newConfig, '_v4Source', {
        ...v4SourceDescriptor,
        value: updatedSource,
      });
    }

    return newConfig;
  }

  if (!config.profiles?.[profileName]) {
    throw new Error(`Profile "${profileName}" does not exist.`);
  }

  return {
    ...config,
    active_profile: profileName,
  };
}

export function setPresetMetadata(config, presetName, updates) {
  if (!isObject(config)) {
    throw new Error('Config is required.');
  }
  if (config.version !== 3) {
    throw new Error('setPresetMetadata currently supports version: 3 configs only.');
  }
  if (!presetName || typeof presetName !== 'string' || !presetName.trim()) {
    throw new Error('Preset name is required.');
  }
  if (!isObject(updates)) {
    throw new Error('Updates must be an object.');
  }

  const owner = findPresetOwner(config, presetName.trim());
  if (!owner) {
    throw new Error(`Preset "${presetName}" does not exist.`);
  }

  const catalogName = owner.catalogName;
  const catalog = config.catalogs?.[catalogName];
  const currentPreset = catalog?.presets?.[presetName];

  const newConfig = {
    ...config,
    catalogs: {
      ...config.catalogs,
      [catalogName]: {
        ...catalog,
        presets: {
          ...catalog.presets,
          [presetName]: {
            ...currentPreset,
            ...updates,
          },
        },
      },
    },
  };

  const v4SourceDescriptor = Object.getOwnPropertyDescriptor(config, '_v4Source');
  if (v4SourceDescriptor) {
    Object.defineProperty(newConfig, '_v4Source', v4SourceDescriptor);
  }

  return newConfig;
}

export function setActivationState(config, activationState) {
  const normalized = normalizeActivationState(activationState, 'activationState');
  const nextConfig = {
    ...config,
    activation_state: normalized,
  };

  delete nextConfig.active;
  delete nextConfig.enabled;

  return nextConfig;
}

export function applyInstallIntent(config, intent) {
  const directives = normalizeInstallIntent(intent);
  return applyInstallDirectives(config, directives);
}

function applyInstallDirectives(config, directives) {
  let nextConfig = config;

  for (const directive of directives) {
    if (directive.type === 'active_profile') {
      const requestedProfile = config.version === 3 && directive.profileName === 'default'
        ? (nextConfig.active_preset ?? 'multivendor')
        : directive.profileName;
      nextConfig = setActiveProfile(nextConfig, requestedProfile);
      continue;
    }

    if (directive.type === 'activation_state') {
      nextConfig = setActivationState(nextConfig, directive.activationState);
      continue;
    }

    if (directive.type === 'phase_chain') {
      nextConfig = setPhaseRouteChain(nextConfig, directive.profileName, directive.phaseName, directive.chain);
      continue;
    }

    if (directive.type === 'profile_rules') {
      nextConfig = setProfileRules(nextConfig, directive.profileName, directive.rules);
      continue;
    }

    if (directive.type === 'metadata_patch') {
      nextConfig = setMetadataPatch(nextConfig, directive.path, directive.value);
    }
  }

  return nextConfig;
}

export function normalizeInstallIntent(intent) {
  if (intent === undefined || intent === null || intent === '') {
    return [];
  }

  if (Array.isArray(intent)) {
    return intent.flatMap((item) => normalizeInstallIntent(item));
  }

  if (isObject(intent)) {
    return normalizeInstallIntentObject(intent);
  }

  if (typeof intent !== 'string') {
    throw new Error('Install intent must be a string, object, or array of directives.');
  }

  return normalizeInstallIntentString(intent);
}

export function describeInstallBootstrap(config, intent) {
  const directives = normalizeInstallIntent(intent);

  if (directives.length === 0) {
    return {
      status: 'shell-ready',
      supported: true,
      reason: 'No install intent was provided; use the YAML-first shell bootstrap flow or pass an explicit intent.',
      nextSteps: [
        'Inspect router/router.yaml and edit the desired profile or phase chain.',
        'Run gsr install --intent "profile=<name>; activation=active|inactive" to apply a YAML update.',
        'Run gsr status to confirm the install contract remains valid.',
      ],
    };
  }

  const nextConfig = applyInstallDirectives(config, directives);
  const changed = JSON.stringify(nextConfig) !== JSON.stringify(config);

  return {
    status: changed ? 'planned' : 'noop',
    supported: true,
    reason: changed
      ? 'The install intent maps to a valid YAML update.'
      : 'The install intent already matches the current YAML state.',
    nextConfig,
    directives,
    nextSteps: changed
      ? [
          'Run gsr install --intent "..." --apply to persist the YAML change.',
          'Or edit router/router.yaml directly and rerun gsr status.',
        ]
      : [
          'The YAML already matches the requested intent.',
          'Use gsr status to verify the current install contract.',
        ],
  };
}

export function resolveRouterState(config, controllerLabel = 'Gentleman') {
  // v4 assembled configs have version: 3 after assembly, so resolveRouterStateV3 handles them.
  if (config.version === 3) {
    return resolveRouterStateV3(config, controllerLabel);
  }

  const activationState = readConfiguredActivationState(config);
  const activeProfileName = config.active_profile;
  const activeProfile = config.profiles[activeProfileName];

  if (!activeProfile) {
    throw new Error(`The active profile "${activeProfileName}" does not exist.`);
  }

  const phases = activeProfile.phases ?? {};
  const resolvedPhases = {};

  for (const [phaseName, routeChain] of Object.entries(phases)) {
    const activeRoute = routeChain.find(isRunnerRoute) ?? routeChain[0];

    resolvedPhases[phaseName] = {
      active: activeRoute,
      candidates: [...routeChain],
    };
  }

  const state = {
    version: config.version,
    activeProfileName,
    resolvedPhases,
    rules: activeProfile.rules ?? {},
    profiles: Object.keys(config.profiles),
  };

  Object.defineProperties(state, {
    installed: {
      value: true,
      enumerable: false,
    },
    activationState: {
      value: activationState,
      enumerable: false,
    },
    effectiveController: {
      value: activationState === 'active' ? 'gsr' : controllerLabel,
      enumerable: false,
    },
  });

  return state;
}

function resolveRouterStateV3(config, controllerLabel = 'Gentleman') {
  const schema = normalizeRouterSchemaV3(config);

  const state = {
    version: 3,
    schemaVersion: 3,
    activeProfileName: schema.activePresetName,
    selectedCatalogName: schema.activeCatalogName,
    selectedPresetName: schema.activePresetName,
    resolvedPhases: schema.resolvedPhases,
    rules: schema.selectedPreset?.metadata ?? {},
    profiles: schema.catalogs.flatMap((catalog) => catalog.presets.map((preset) => `${catalog.name}/${preset.name}`)),
    routerSchemaContract: schema,
    compatibilityNotes: schema.compatibilityNotes,
    laneRoles: schema.laneRoles,
  };

  Object.defineProperties(state, {
    installed: {
      value: true,
      enumerable: false,
    },
    activationState: {
      value: schema.activationState,
      enumerable: false,
    },
    effectiveController: {
      value: schema.activationState === 'active' ? 'gsr' : controllerLabel,
      enumerable: false,
    },
  });

  return state;
}

export function listProfiles(config) {
  // v4 assembled configs have version: 3 after assembly, so the v3 path below handles them.
  if (config.version === 3) {
    const schema = normalizeRouterSchemaV3(config);

    return schema.catalogs.flatMap((catalog) => catalog.presets.map((preset) => ({
      name: `${catalog.name}/${preset.name}`,
      active: catalog.name === schema.activeCatalogName && preset.name === schema.activePresetName,
      phases: preset.phases.map((phase) => phase.name),
    })));
  }

  const activeProfileName = config.active_profile;

  return Object.entries(config.profiles).map(([profileName, profile]) => ({
    name: profileName,
    active: profileName === activeProfileName,
    phases: Object.keys(profile.phases ?? {}),
  }));
}

export function validateRouterConfig(config) {
  if (!isObject(config)) {
    throw new Error('router.yaml must contain a valid root object.');
  }

  // v4 assembled configs have version: 3 (assembled via assembleV4Config).
  // A raw v4 core config (version: 4, no catalogs) must be assembled first.
  if (config.version === 4 || config.version === 5) {
    throw new Error(
      `A raw v${config.version} config cannot be validated directly. ` +
      'Call assembleV4Config() first to produce a v3-shaped assembled config, then validate.'
    );
  }

  if (config.version === 3) {
    validateRouterSchemaV3(config);
    return true;
  }

  if (config.version !== 1) {
    throw new Error('router.yaml requires version: 1 or 3.');
  }

  if (typeof config.active_profile !== 'string' || !config.active_profile.trim()) {
    throw new Error('router.yaml requires active_profile as a non-empty string.');
  }

  if (!isObject(config.profiles) || Object.keys(config.profiles).length === 0) {
    throw new Error('router.yaml requires at least one profile in profiles.');
  }

  if (config.metadata !== undefined && !isObject(config.metadata)) {
    throw new Error('router.yaml requires metadata to be an object when present.');
  }

  const activeProfile = config.profiles[config.active_profile];
  if (!activeProfile) {
    throw new Error(`The active_profile "${config.active_profile}" does not exist in profiles.`);
  }

  readConfiguredActivationState(config);

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    if (!isObject(profile)) {
      throw new Error(`Profile "${profileName}" must be an object.`);
    }

    if (!isObject(profile.phases)) {
      throw new Error(`Profile "${profileName}" requires phases as an object.`);
    }

    for (const [phaseName, chain] of Object.entries(profile.phases)) {
      validateRouteChain(profileName, phaseName, chain);
    }

    if (profile.rules !== undefined && !isObject(profile.rules)) {
      throw new Error(`Profile "${profileName}" requires rules to be an object when present.`);
    }
  }

  return true;
}

function validateRouteChain(profileName, phaseName, chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`Profile "${profileName}" has an empty chain in phase "${phaseName}".`);
  }

  for (const candidate of chain) {
    validateRouteCandidate(profileName, phaseName, candidate);
  }
}

function validateRouteCandidate(profileName, phaseName, candidate) {
  if (typeof candidate === 'string') {
    if (!candidate.trim()) {
      throw new Error(`Profile "${profileName}" has an invalid candidate in phase "${phaseName}".`);
    }

    return;
  }

  if (!isObject(candidate)) {
    throw new Error(`Profile "${profileName}" has an invalid candidate in phase "${phaseName}".`);
  }

  if (typeof candidate.kind !== 'string' || !candidate.kind.trim()) {
    throw new Error(`Profile "${profileName}" has a route object without a valid kind in phase "${phaseName}".`);
  }

  if (candidate.kind === 'runner') {
    if (typeof candidate.target !== 'string' || !candidate.target.trim()) {
      throw new Error(`Profile "${profileName}" has a runner route without a valid target in phase "${phaseName}".`);
    }
  } else if (candidate.target !== undefined && typeof candidate.target !== 'string') {
    throw new Error(`Profile "${profileName}" has an invalid target in phase "${phaseName}".`);
  }

  if (candidate.metadata !== undefined && !isObject(candidate.metadata)) {
    throw new Error(`Profile "${profileName}" has invalid metadata in phase "${phaseName}".`);
  }
}

function isRunnerRoute(candidate) {
  return typeof candidate === 'string' || (isObject(candidate) && candidate.kind === 'runner');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  function skipIgnored() {
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }
      break;
    }
  }

  function peekNextSignificantLine() {
    let probe = index;
    while (probe < lines.length) {
      const raw = lines[probe];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        probe += 1;
        continue;
      }
      return { indent: countIndent(raw), text: trimmed };
    }
    return null;
  }

  function parseBlock(expectedIndent) {
    skipIgnored();

    const first = peekNextSignificantLine();
    if (!first || first.indent < expectedIndent) {
      return {};
    }

    if (first.indent > expectedIndent) {
      throw new Error(`Unexpected YAML indentation on line ${index + 1}.`);
    }

    if (first.text.startsWith('- ')) {
      return parseList(expectedIndent);
    }

    const result = {};
    while (true) {
      skipIgnored();
      if (index >= lines.length) {
        return result;
      }

      const raw = lines[index];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      const indent = countIndent(raw);
      if (indent < expectedIndent) {
        return result;
      }

      if (indent !== expectedIndent) {
        throw new Error(`Unexpected YAML indentation on line ${index + 1}.`);
      }

      if (trimmed.startsWith('- ')) {
        throw new Error(`Expected a YAML key on line ${index + 1}.`);
      }

      const separator = trimmed.indexOf(':');
      if (separator < 0) {
        throw new Error(`Expected ":" on line ${index + 1}.`);
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      index += 1;

      if (value !== '') {
        result[key] = parseScalar(value);
        continue;
      }

      const next = peekNextSignificantLine();
      if (!next || next.indent <= expectedIndent) {
        result[key] = {};
        continue;
      }

      result[key] = parseBlock(next.indent);
    }
  }

  function parseList(expectedIndent) {
    const items = [];

    while (true) {
      skipIgnored();
      if (index >= lines.length) {
        return items;
      }

      const raw = lines[index];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      const indent = countIndent(raw);
      if (indent < expectedIndent) {
        return items;
      }

      if (indent !== expectedIndent || !trimmed.startsWith('- ')) {
        throw new Error(`Expected a list item on line ${index + 1}.`);
      }

      const itemText = trimmed.slice(2).trim();
      index += 1;
      items.push(parseListItem(itemText, indent));
    }
  }

  function parseListItem(itemText, itemIndent) {
    if (itemText === '') {
      const next = peekNextSignificantLine();
      if (!next || next.indent <= itemIndent) {
        return null;
      }

      return parseBlock(next.indent);
    }

    if (!looksLikeRouteObjectLine(itemText)) {
      return parseScalar(itemText);
    }

    const mapping = parseInlineMapping(itemText, itemIndent);
    const next = peekNextSignificantLine();

    if (!next || next.indent <= itemIndent) {
      return mapping;
    }

    const nested = parseBlock(next.indent);
    if (isObject(nested)) {
      return { ...mapping, ...nested };
    }

    throw new Error(`Expected a YAML object on line ${index + 1}.`);
  }

  function looksLikeRouteObjectLine(text) {
    // Detect list items that are YAML objects (key: value pairs).
    // Original: kind|target|metadata for routing lanes.
    // Extended: artifact|format|field for invoke input_context/output_expected objects.
    return /^(kind|target|metadata|artifact|format|field):(?:\s+.*)?$/.test(text);
  }

  function parseInlineMapping(text, itemIndent) {
    const separator = text.indexOf(':');
    if (separator < 0) {
      throw new Error(`Expected ":" on line ${index + 1}.`);
    }

    const key = text.slice(0, separator).trim();
    const value = text.slice(separator + 1).trim();

    if (value === '') {
      const next = peekNextSignificantLine();
      if (!next || next.indent <= itemIndent) {
        return { [key]: {} };
      }

      return { [key]: parseBlock(next.indent) };
    }

    return { [key]: parseScalar(value) };
  }

  const document = parseBlock(0);
  skipIgnored();

  if (index < lines.length) {
    const remaining = lines.slice(index).find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    if (remaining !== undefined) {
      throw new Error('router.yaml contains extra content or malformed indentation.');
    }
  }

  return document;
}

export function resolveActivationState(config, controllerLabel = 'Gentleman') {
  const activationState = readConfiguredActivationState(config);

  return {
    state: activationState,
    effectiveController: activationState === 'active' ? 'gsr' : controllerLabel,
  };
}

export function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isObject(item) || Array.isArray(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}- ${nested.replace(/^\s+/, '')}`;
        }

        return `${pad}- ${formatScalar(item)}`;
      })
      .join('\n');
  }

  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        if (Array.isArray(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}${key}:\n${nested}`;
        }

        if (isObject(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}${key}:\n${nested}`;
        }

        return `${pad}${key}: ${formatScalar(item)}`;
      })
      .join('\n');
  }

  return `${pad}${formatScalar(value)}`;
}

function normalizeInstallIntentString(text) {
  const directives = [];
  const parts = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      throw new Error(`Unsupported install intent fragment: ${part}`);
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 'profile' || key === 'active_profile') {
      directives.push({ type: 'active_profile', profileName: value });
      continue;
    }

    if (key === 'activation' || key === 'activation_state') {
      directives.push({ type: 'activation_state', activationState: normalizeActivationState(value, key) });
      continue;
    }

    if (key.startsWith('phase.')) {
      const phaseName = key.slice('phase.'.length).trim();
      directives.push({
        type: 'phase_chain',
        profileName: undefined,
        phaseName,
        chain: normalizeRouteChain(value),
      });
      continue;
    }

    if (key.startsWith('profile.')) {
      const remainder = key.slice('profile.'.length);
      const [profileName, kind, subject] = remainder.split('.');

      if (!profileName || !kind) {
        throw new Error(`Unsupported install intent fragment: ${part}`);
      }

      if (kind === 'phase') {
        directives.push({
          type: 'phase_chain',
          profileName,
          phaseName: subject,
          chain: normalizeRouteChain(value),
        });
        continue;
      }

      if (kind === 'rule') {
        directives.push({
          type: 'profile_rules',
          profileName,
          rules: makeSingletonObject(subject, parseScalar(value)),
        });
        continue;
      }
    }

    if (key.startsWith('rule.')) {
      const ruleName = key.slice('rule.'.length).trim();
      directives.push({
        type: 'profile_rules',
        profileName: undefined,
        rules: makeSingletonObject(ruleName, parseScalar(value)),
      });
      continue;
    }

    if (key.startsWith('metadata.')) {
      directives.push({
        type: 'metadata_patch',
        path: key.slice('metadata.'.length).split('.').filter(Boolean),
        value: parseScalar(value),
      });
      continue;
    }

    throw new Error(`Unsupported install intent fragment: ${part}`);
  }

  return directives;
}

function normalizeInstallIntentObject(intent) {
  const directives = [];

  if (typeof intent.profile === 'string') {
    directives.push({ type: 'active_profile', profileName: intent.profile });
  }

  if (typeof intent.active_profile === 'string') {
    directives.push({ type: 'active_profile', profileName: intent.active_profile });
  }

  if (intent.activation !== undefined || intent.activation_state !== undefined) {
    directives.push({
      type: 'activation_state',
      activationState: normalizeActivationState(intent.activation ?? intent.activation_state, 'activation'),
    });
  }

  if (isObject(intent.phases)) {
    for (const [phaseName, chain] of Object.entries(intent.phases)) {
      directives.push({
        type: 'phase_chain',
        profileName: intent.profileName,
        phaseName,
        chain: normalizeRouteChain(chain),
      });
    }
  }

  if (isObject(intent.rules)) {
    directives.push({
      type: 'profile_rules',
      profileName: intent.profileName,
      rules: intent.rules,
    });
  }

  if (isObject(intent.metadata)) {
    for (const [key, value] of Object.entries(intent.metadata)) {
      directives.push({
        type: 'metadata_patch',
        path: [key],
        value,
      });
    }
  }

  if (directives.length === 0) {
    throw new Error('Install intent did not contain any recognized updates.');
  }

  return directives;
}

function normalizeRouteChain(chain) {
  if (typeof chain === 'string') {
    const normalized = chain
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (normalized.length === 0) {
      throw new Error('Install intent requires at least one route candidate.');
    }

    return normalized;
  }

  if (!Array.isArray(chain)) {
    throw new Error('Install intent requires a route chain as a string or array.');
  }

  const normalized = chain.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error('Install intent contains an invalid route candidate.');
    }

    return item.trim();
  });

  if (normalized.length === 0) {
    throw new Error('Install intent requires at least one route candidate.');
  }

  return normalized;
}

function parseInlineObject(text) {
  const source = text.includes('=') ? text : `value=${text}`;
  const separator = source.indexOf('=');
  const key = source.slice(0, separator).trim();
  const value = parseScalar(source.slice(separator + 1).trim());
  return makeSingletonObject(key, value);
}

function makeSingletonObject(key, value) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Install intent requires a valid key.');
  }

  return { [key.trim()]: value };
}

function setPhaseRouteChain(config, profileName, phaseName, chain) {
  const targetProfileName = profileName ?? config.active_profile;
  const profile = config.profiles?.[targetProfileName];

  if (!profile) {
    throw new Error(`Profile "${targetProfileName}" does not exist.`);
  }

  if (typeof phaseName !== 'string' || !phaseName.trim()) {
    throw new Error('Install intent requires a valid phase name.');
  }

  return {
    ...config,
    profiles: {
      ...config.profiles,
      [targetProfileName]: {
        ...profile,
        phases: {
          ...profile.phases,
          [phaseName]: chain,
        },
      },
    },
  };
}

function setProfileRules(config, profileName, rules) {
  const targetProfileName = profileName ?? config.active_profile;
  const profile = config.profiles?.[targetProfileName];

  if (!profile) {
    throw new Error(`Profile "${targetProfileName}" does not exist.`);
  }

  if (!isObject(rules)) {
    throw new Error(`Profile "${targetProfileName}" rules must be an object.`);
  }

  return {
    ...config,
    profiles: {
      ...config.profiles,
      [targetProfileName]: {
        ...profile,
        rules: {
          ...(profile.rules ?? {}),
          ...rules,
        },
      },
    },
  };
}

function setMetadataPatch(config, pathParts, value) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) {
    throw new Error('Install intent requires a metadata path.');
  }

  const metadata = isObject(config.metadata) ? config.metadata : {};
  const nextMetadata = cloneWithPath(metadata, pathParts, value);

  return {
    ...config,
    metadata: nextMetadata,
  };
}

function cloneWithPath(target, pathParts, value) {
  const [head, ...rest] = pathParts;

  if (!head) {
    return value;
  }

  if (rest.length === 0) {
    return {
      ...target,
      [head]: value,
    };
  }

  const current = isObject(target[head]) ? target[head] : {};

  return {
    ...target,
    [head]: cloneWithPath(current, rest, value),
  };
}

function parseScalar(raw) {
  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  if (raw === 'null') {
    return null;
  }

  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

function readConfiguredActivationState(config) {
  const normalizedStates = [];

  if (Object.hasOwn(config, 'activation_state')) {
    normalizedStates.push(normalizeActivationState(config.activation_state, 'activation_state'));
  }

  if (Object.hasOwn(config, 'active')) {
    normalizedStates.push(normalizeActivationState(config.active, 'active'));
  }

  if (Object.hasOwn(config, 'enabled')) {
    normalizedStates.push(normalizeActivationState(config.enabled, 'enabled'));
  }

  if (normalizedStates.length === 0) {
    return 'active';
  }

  const uniqueStates = [...new Set(normalizedStates)];
  if (uniqueStates.length > 1) {
    throw new Error('router.yaml contains conflicting activation fields.');
  }

  return uniqueStates[0];
}

function normalizeActivationState(value, fieldName) {
  if (value === 'active' || value === 'inactive') {
    return value;
  }

  if (value === true) {
    return 'active';
  }

  if (value === false) {
    return 'inactive';
  }

  throw new Error(`router.yaml requires ${fieldName} as active/inactive or a boolean.`);
}

function formatScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }

  if (value === null || value === undefined) {
    return 'null';
  }

  const text = String(value);
  if (text === '' || /[:#\n\r\t]/.test(text) || text.startsWith(' ') || text.endsWith(' ')) {
    return JSON.stringify(text);
  }

  return text;
}

function countIndent(line) {
  return line.length - line.trimStart().length;
}

export {
  CANONICAL_PHASES,
  normalizeRouterSchemaV3,
  validateRouterSchemaV3,
};
