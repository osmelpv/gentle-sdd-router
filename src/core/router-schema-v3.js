const DEFAULT_CATALOG_NAME = 'legacy';
const DEFAULT_PRESET_NAME = 'default';
const ALLOWED_LANE_ROLES = new Set(['primary', 'secondary', 'tertiary', 'judge', 'radar']);
const EXECUTION_HINT_FIELDS = new Set([
  'execute',
  'execution',
  'executor',
  'command',
  'commands',
  'script',
  'workflow',
  'orchestrate',
  'orchestration',
  'instructions',
  'steps',
]);

export function validateRouterSchemaV3(config) {
  if (!isObject(config)) {
    throw new Error('router.yaml must contain a valid root object for version 3.');
  }

  if (config.version !== 3) {
    throw new Error('router.yaml requires version: 3 for the v3 schema.');
  }

  if (!isObject(config.catalogs) || Object.keys(config.catalogs).length === 0) {
    throw new Error('router.yaml version 3 requires at least one catalog in catalogs.');
  }

  if (config.active_catalog !== undefined && !isNonEmptyString(config.active_catalog)) {
    throw new Error('router.yaml version 3 requires active_catalog to be a non-empty string when present.');
  }

  if (config.active_preset !== undefined && !isNonEmptyString(config.active_preset)) {
    throw new Error('router.yaml version 3 requires active_preset to be a non-empty string when present.');
  }

  if (config.active_profile !== undefined && !isNonEmptyString(config.active_profile)) {
    throw new Error('router.yaml version 3 requires active_profile to be a non-empty string when present.');
  }

  if (config.activation_state !== undefined && !isActivationState(config.activation_state)) {
    throw new Error('router.yaml version 3 requires activation_state to be active/inactive or a boolean when present.');
  }

  if (config.metadata !== undefined && !isObject(config.metadata)) {
    throw new Error('router.yaml version 3 requires metadata to be an object when present.');
  }

  for (const [catalogName, catalog] of Object.entries(config.catalogs)) {
    validateCatalog(catalogName, catalog);
  }

  return true;
}

export function normalizeRouterSchemaV3(config) {
  if (!isObject(config)) {
    throw new Error('router.yaml must contain a valid root object.');
  }

  if (config.version === 3) {
    validateRouterSchemaV3(config);
    return normalizeDeclaredRouterSchemaV3(config);
  }

  return normalizeLegacyRouterSchemaV3(config);
}

function normalizeDeclaredRouterSchemaV3(config) {
  const catalogs = normalizeCatalogs(config.catalogs);
  const activeCatalogSelector = firstNonEmptyString(
    config.active_catalog,
    config.active_profile,
    catalogs[0]?.name,
    DEFAULT_CATALOG_NAME,
  );
  const selectedCatalogResolution = resolveCatalogSelection(catalogs, activeCatalogSelector);
  const selectedCatalog = selectedCatalogResolution.catalog;
  const activePresetSelector = firstNonEmptyString(
    config.active_preset,
    config.active_profile,
    selectedCatalog?.defaultPreset ?? selectedCatalog?.presets[0]?.name,
    DEFAULT_PRESET_NAME,
  );
  const selectedPresetResolution = resolvePresetSelection(selectedCatalog?.presets ?? [], activePresetSelector);
  const selectedPreset = selectedPresetResolution.preset;
  const activePresetName = selectedPreset?.name ?? activePresetSelector;
  const resolvedPhases = buildResolvedPhases(selectedPreset?.phases ?? []);
  const laneRoles = collectLaneRoles(resolvedPhases);
  const complexityGuidance = resolveComplexityGuidance(
    selectedPreset?.complexity ?? selectedCatalog?.complexity ?? config.complexity,
    selectedPreset,
    selectedCatalog,
  );
  const compatibilityNotes = [];

  if (selectedCatalogResolution.resolvedVia !== 'exact') {
    compatibilityNotes.push(`Catalog selector "${activeCatalogSelector}" resolved to "${selectedCatalog?.name ?? activeCatalogSelector}".`);
  }

  if (selectedPresetResolution.resolvedVia !== 'exact') {
    compatibilityNotes.push(`Preset selector "${activePresetSelector}" resolved to "${activePresetName}".`);
  }

  if (selectedCatalogResolution.fellBack) {
    compatibilityNotes.push('Unavailable catalog entries were skipped in declaration order.');
  }

  if (selectedPresetResolution.fellBack) {
    compatibilityNotes.push('Unavailable preset entries were skipped in declaration order and fallbacks were honored.');
  }

  if (config.activation_state === undefined) {
    compatibilityNotes.push('Activation state was not provided and remains advisory metadata only.');
  }

  return {
    kind: 'router-schema-v3-view',
    version: 3,
    sourceVersion: 3,
    activeCatalogName: selectedCatalog?.name ?? activeCatalogSelector,
    activePresetName,
    activeProfileName: activePresetName,
    selectedCatalog,
    selectedPreset,
    catalogs,
    resolvedPhases,
    laneRoles,
    complexityGuidance,
    compatibilityNotes,
    activationState: normalizeActivationState(config.activation_state ?? 'active'),
    metadata: cloneValue(config.metadata ?? {}),
    raw: {
      active_catalog: config.active_catalog ?? null,
      active_preset: config.active_preset ?? null,
      active_profile: config.active_profile ?? null,
    },
  };
}

function normalizeLegacyRouterSchemaV3(config) {
  if (!isObject(config.profiles) || Object.keys(config.profiles).length === 0) {
    throw new Error('router.yaml version 1 requires at least one profile in profiles.');
  }

  const catalogs = [normalizeLegacyCatalog(config.profiles)];
  const activeCatalog = catalogs[0];
  const activePresetName = firstNonEmptyString(config.active_profile, activeCatalog?.presets[0]?.name, DEFAULT_PRESET_NAME);
  const selectedPresetResolution = resolvePresetSelection(activeCatalog?.presets ?? [], activePresetName);
  const selectedPreset = selectedPresetResolution.preset;
  const resolvedPhases = buildResolvedPhases(selectedPreset?.phases ?? []);

  return {
    kind: 'router-schema-v3-view',
    version: 3,
    sourceVersion: 1,
    activeCatalogName: activeCatalog?.name ?? DEFAULT_CATALOG_NAME,
    activePresetName,
    activeProfileName: activePresetName,
    selectedCatalog: activeCatalog,
    selectedPreset,
    catalogs,
    resolvedPhases,
    laneRoles: collectLaneRoles(resolvedPhases),
    complexityGuidance: resolveComplexityGuidance(selectedPreset?.complexity ?? activeCatalog?.complexity, selectedPreset, activeCatalog),
    compatibilityNotes: [
      'Mapped v1 profiles into a legacy catalog/preset view.',
      'Phase chains were normalized into metadata-only lanes.',
    ],
    activationState: normalizeActivationState(config.activation_state ?? 'active'),
    metadata: cloneValue(config.metadata ?? {}),
    raw: {
      active_profile: config.active_profile ?? null,
    },
  };
}

function normalizeCatalogs(catalogs) {
  return Object.entries(catalogs).map(([name, catalog], index) => normalizeCatalog(name, catalog, index));
}

function normalizeCatalog(name, catalog, index) {
  const normalized = {
    name,
    availability: normalizeAvailability(catalog?.availability),
    complexity: cloneValue(catalog?.complexity ?? null),
    aliases: normalizeStringList(catalog?.aliases),
    fallbacks: normalizeStringList(catalog?.fallbacks),
    defaultPreset: firstNonEmptyString(catalog?.default_preset, catalog?.defaultPreset, null),
    order: index,
    presets: normalizePresets(catalog?.presets ?? {}),
    guidance: normalizeGuidance(catalog?.guidance),
    metadata: cloneValue(catalog?.metadata ?? {}),
  };

  return normalized;
}

function normalizeLegacyCatalog(profiles) {
  return {
    name: DEFAULT_CATALOG_NAME,
    availability: 'stable',
    complexity: null,
    aliases: ['latest'],
    fallbacks: [],
    defaultPreset: firstNonEmptyString(Object.keys(profiles)[0], DEFAULT_PRESET_NAME),
    order: 0,
    presets: Object.entries(profiles).map(([name, profile], index) => normalizeLegacyPreset(name, profile, index)),
    guidance: {
      default: {
        laneCount: 1,
        ordering: ['primary', 'secondary', 'judge', 'radar'],
      },
      byComplexity: {
        high: {
          laneCount: 3,
          ordering: ['primary', 'secondary', 'judge', 'radar'],
        },
        medium: {
          laneCount: 2,
          ordering: ['primary', 'secondary', 'judge', 'radar'],
        },
      },
    },
    metadata: {
      sourceVersion: 1,
    },
  };
}

function normalizeLegacyPreset(name, profile, index) {
  const phases = Object.entries(profile?.phases ?? {}).map(([phaseName, chain], phaseIndex) => ({
    name: phaseName,
    lanes: [normalizeLegacyLane(phaseName, chain, phaseIndex)],
  }));

  return {
    name,
    availability: 'stable',
    aliases: index === 0 ? ['latest'] : [],
    fallbacks: [],
    complexity: profile?.complexity ?? null,
    guidance: normalizeGuidance(profile?.rules?.guidance),
    phases,
    metadata: cloneValue(profile?.rules ?? {}),
  };
}

function normalizeLegacyLane(phaseName, chain, laneIndex) {
  const entries = Array.isArray(chain) ? chain.map((candidate, index) => normalizeLegacyPathEntry(candidate, phaseName, index)) : [];
  const primary = entries[0] ?? null;

  return {
    phase: phaseName,
    role: deriveLegacyRole(primary, laneIndex),
    target: primary?.target ?? null,
    fallbacks: entries.slice(1).map((entry) => entry.target).filter(Boolean),
    path: entries,
    availability: 'stable',
    complexity: null,
    metadata: {
      source: 'v1-chain',
      candidateCount: entries.length,
    },
  };
}

function normalizeLegacyPathEntry(candidate, phaseName, index) {
  if (typeof candidate === 'string') {
    return {
      phase: phaseName,
      role: deriveLegacyRole(null, index),
      kind: index === 0 ? 'runner' : 'fallback',
      target: candidate,
      fallbacks: [],
      availability: 'stable',
      metadata: {},
    };
  }

  if (!isObject(candidate)) {
    return {
      phase: phaseName,
      role: deriveLegacyRole(null, index),
      kind: 'fallback',
      target: null,
      fallbacks: [],
      availability: 'stable',
      metadata: {},
    };
  }

  return {
    phase: phaseName,
    role: normalizeLegacyRole(candidate.kind, index),
    kind: normalizeText(candidate.kind, index === 0 ? 'runner' : 'fallback'),
    target: normalizeText(candidate.target, null),
    fallbacks: normalizeStringList(candidate.fallbacks),
    availability: normalizeAvailability(candidate.availability),
    metadata: cloneValue(candidate.metadata ?? {}),
  };
}

function normalizeLegacyRole(kind, index) {
  if (kind === 'judge' || kind === 'radar') {
    return kind;
  }

  if (kind === 'secondary' || kind === 'tertiary') {
    return kind;
  }

  return deriveRoleFromIndex(index);
}

function deriveLegacyRole(candidate, index) {
  if (candidate?.role && ALLOWED_LANE_ROLES.has(candidate.role)) {
    return candidate.role;
  }

  if (candidate?.kind === 'judge' || candidate?.kind === 'radar') {
    return candidate.kind;
  }

  return deriveRoleFromIndex(index);
}

function deriveRoleFromIndex(index) {
  if (index === 0) {
    return 'primary';
  }

  if (index === 1) {
    return 'secondary';
  }

  if (index === 2) {
    return 'tertiary';
  }

  return 'secondary';
}

function normalizePresets(presets) {
  return Object.entries(presets).map(([name, preset], index) => normalizePreset(name, preset, index));
}

function normalizePreset(name, preset, index = 0) {
  return {
    name,
    availability: normalizeAvailability(preset?.availability),
    aliases: normalizeStringList(preset?.aliases),
    fallbacks: normalizeStringList(preset?.fallbacks),
    version: normalizeText(preset?.version, null),
    complexity: cloneValue(preset?.complexity ?? null),
    guidance: normalizeGuidance(preset?.guidance),
    phases: normalizePhases(preset?.phases ?? {}),
    metadata: cloneValue(preset?.metadata ?? {}),
    order: index,
  };
}

function normalizePhases(phases) {
  return Object.entries(phases).map(([phaseName, lanes]) => ({
    name: phaseName,
    lanes: normalizeLanes(phaseName, lanes),
  }));
}

function normalizeLanes(phaseName, lanes) {
  const source = Array.isArray(lanes) ? lanes : lanes?.lanes;
  const normalized = Array.isArray(source) ? source.map((lane, index) => normalizeLane(phaseName, lane, index)) : [];
  return normalized;
}

function normalizeLane(phaseName, lane, index) {
  if (!isObject(lane)) {
    return {
      phase: phaseName,
      role: deriveRoleFromIndex(index),
      target: normalizeText(lane, null),
      fallbacks: [],
      path: [],
      availability: 'stable',
      complexity: null,
      metadata: {},
      order: index,
    };
  }

  const role = normalizeLaneRole(lane.role ?? lane.kind ?? lane.type, index);
  const target = normalizeText(lane.target, null);
  const fallbacks = normalizeStringList(lane.fallbacks);
  const path = Array.isArray(lane.path)
    ? lane.path.map((entry) => (isObject(entry) ? cloneValue(entry) : normalizeText(entry, null))).filter(Boolean)
    : target
      ? [target, ...fallbacks]
      : fallbacks;

  return {
    phase: normalizeText(lane.phase, phaseName),
    role,
    target,
    fallbacks,
    path,
    availability: normalizeAvailability(lane.availability),
    complexity: cloneValue(lane.complexity ?? null),
    metadata: cloneValue(lane.metadata ?? {}),
    order: index,
  };
}

function normalizeLaneRole(role, index) {
  const normalized = normalizeText(role, null);

  if (normalized && ALLOWED_LANE_ROLES.has(normalized)) {
    return normalized;
  }

  return deriveRoleFromIndex(index);
}

function validateCatalog(catalogName, catalog) {
  if (!isObject(catalog)) {
    throw new Error(`Catalog "${catalogName}" must be an object.`);
  }

  validateExecutionHints(catalog, `Catalog "${catalogName}"`);

  if (catalog.aliases !== undefined) {
    validateStringList(catalog.aliases, `Catalog "${catalogName}" aliases`);
  }

  if (catalog.fallbacks !== undefined) {
    validateStringList(catalog.fallbacks, `Catalog "${catalogName}" fallbacks`);
  }

  if (catalog.complexity !== undefined) {
    validateComplexityDescriptor(catalog.complexity, `Catalog "${catalogName}" complexity`);
  }

  if (catalog.guidance !== undefined) {
    validateGuidance(catalog.guidance, `Catalog "${catalogName}" guidance`);
  }

  if (!isObject(catalog.presets) || Object.keys(catalog.presets).length === 0) {
    throw new Error(`Catalog "${catalogName}" requires presets as a non-empty object.`);
  }

  for (const [presetName, preset] of Object.entries(catalog.presets)) {
    validatePreset(catalogName, presetName, preset);
  }
}

function validatePreset(catalogName, presetName, preset) {
  if (!isObject(preset)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" must be an object.`);
  }

  validateExecutionHints(preset, `Catalog "${catalogName}" preset "${presetName}"`);

  if (preset.aliases !== undefined) {
    validateStringList(preset.aliases, `Catalog "${catalogName}" preset "${presetName}" aliases`);
  }

  if (preset.fallbacks !== undefined) {
    validateStringList(preset.fallbacks, `Catalog "${catalogName}" preset "${presetName}" fallbacks`);
  }

  if (preset.complexity !== undefined) {
    validateComplexityDescriptor(preset.complexity, `Catalog "${catalogName}" preset "${presetName}" complexity`);
  }

  if (preset.guidance !== undefined) {
    validateGuidance(preset.guidance, `Catalog "${catalogName}" preset "${presetName}" guidance`);
  }

  if (!isObject(preset.phases) || Object.keys(preset.phases).length === 0) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" requires phases as a non-empty object.`);
  }

  for (const [phaseName, lanes] of Object.entries(preset.phases)) {
    validatePhaseLanes(catalogName, presetName, phaseName, lanes);
  }
}

function validatePhaseLanes(catalogName, presetName, phaseName, lanes) {
  const laneList = Array.isArray(lanes) ? lanes : lanes?.lanes;

  if (!Array.isArray(laneList) || laneList.length === 0) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" requires at least one lane.`);
  }

  laneList.forEach((lane, index) => validateLane(catalogName, presetName, phaseName, lane, index));
}

function validateLane(catalogName, presetName, phaseName, lane, index) {
  if (!isObject(lane)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" has an invalid lane at index ${index}.`);
  }

  validateExecutionHints(lane, `Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index}`);

  if (!isNonEmptyString(lane.phase)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} requires phase.`);
  }

  if (lane.phase !== phaseName) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} must keep the same phase name.`);
  }

  if (!isNonEmptyString(lane.role) || !ALLOWED_LANE_ROLES.has(lane.role)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} requires a valid role.`);
  }

  if (lane.fallbacks !== undefined) {
    validateStringList(lane.fallbacks, `Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} fallbacks`);
  }

  if (lane.path !== undefined && !Array.isArray(lane.path)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} requires path to be an array when present.`);
  }

  if (lane.metadata !== undefined && !isObject(lane.metadata)) {
    throw new Error(`Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} requires metadata to be an object when present.`);
  }

  if (lane.complexity !== undefined) {
    validateComplexityDescriptor(lane.complexity, `Catalog "${catalogName}" preset "${presetName}" phase "${phaseName}" lane ${index} complexity`);
  }
}

function validateGuidance(guidance, context) {
  if (!isObject(guidance)) {
    throw new Error(`${context} must be an object.`);
  }

  if (guidance.default !== undefined) {
    validateGuidanceEntry(guidance.default, `${context}.default`);
  }

  if (guidance.byComplexity !== undefined) {
    if (!isObject(guidance.byComplexity)) {
      throw new Error(`${context}.byComplexity must be an object.`);
    }

    for (const [key, entry] of Object.entries(guidance.byComplexity)) {
      validateGuidanceEntry(entry, `${context}.byComplexity.${key}`);
    }
  }
}

function validateGuidanceEntry(entry, context) {
  if (!isObject(entry)) {
    throw new Error(`${context} must be an object.`);
  }

  if (entry.laneCount !== undefined && (!Number.isInteger(entry.laneCount) || entry.laneCount < 0)) {
    throw new Error(`${context}.laneCount must be a non-negative integer.`);
  }

  if (entry.ordering !== undefined) {
    validateStringList(entry.ordering, `${context}.ordering`);
  }
}

function validateComplexityDescriptor(value, context) {
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error(`${context} cannot be empty.`);
    }

    return;
  }

  if (!isObject(value)) {
    throw new Error(`${context} must be a string or range object.`);
  }

  const hasMin = Object.hasOwn(value, 'min');
  const hasMax = Object.hasOwn(value, 'max');
  const hasLabel = Object.hasOwn(value, 'label');

  if (!hasMin && !hasMax && !hasLabel) {
    throw new Error(`${context} requires label, min, or max.`);
  }

  if (hasLabel && !isNonEmptyString(value.label)) {
    throw new Error(`${context}.label must be a non-empty string when present.`);
  }

  if (hasMin && !Number.isFinite(value.min)) {
    throw new Error(`${context}.min must be numeric when present.`);
  }

  if (hasMax && !Number.isFinite(value.max)) {
    throw new Error(`${context}.max must be numeric when present.`);
  }
}

function validateExecutionHints(value, context) {
  for (const key of Object.keys(value)) {
    if (EXECUTION_HINT_FIELDS.has(key)) {
      throw new Error(`${context} must not include execution-oriented field "${key}".`);
    }
  }
}

function resolveCatalogSelection(catalogs, selector) {
  const normalizedSelector = normalizeText(selector, null);
  const ordered = [...catalogs];
  const exactMatches = findMatchingEntries(ordered, normalizedSelector, 'catalog');
  const candidates = chooseCandidates(ordered, normalizedSelector, exactMatches);

  for (const candidate of candidates) {
    if (isAvailable(candidate.entry)) {
      return {
        catalog: candidate.entry,
        resolvedVia: candidate.matchedBy,
        fellBack: candidate.matchedBy !== 'exact',
      };
    }

    const fallback = resolveFallbackList(ordered, candidate.entry.fallbacks, 'catalog');
    if (fallback) {
      return {
        catalog: fallback.catalog,
        resolvedVia: fallback.resolvedVia,
        fellBack: true,
      };
    }
  }

  const firstAvailable = ordered.find((entry) => isAvailable(entry));
  if (firstAvailable) {
    return {
      catalog: firstAvailable,
      resolvedVia: 'declaration-order',
      fellBack: true,
    };
  }

  throw new Error(`No available catalog could be resolved for selector "${selector}".`);
}

function resolvePresetSelection(presets, selector) {
  const normalizedSelector = normalizeText(selector, null);
  const ordered = [...presets];
  const exactMatches = findMatchingEntries(ordered, normalizedSelector, 'preset');
  const candidates = chooseCandidates(ordered, normalizedSelector, exactMatches);

  for (const candidate of candidates) {
    if (isAvailable(candidate.entry)) {
      return {
        preset: candidate.entry,
        resolvedVia: candidate.matchedBy,
        fellBack: candidate.matchedBy !== 'exact',
      };
    }

    const fallback = resolveFallbackList(ordered, candidate.entry.fallbacks, 'preset');
    if (fallback) {
      return {
        preset: fallback.preset,
        resolvedVia: fallback.resolvedVia,
        fellBack: true,
      };
    }
  }

  const latestCandidates = normalizedSelector === 'latest'
    ? ordered.filter((entry) => isAvailable(entry))
    : [];

  if (latestCandidates.length > 0) {
    return {
      preset: latestCandidates[0],
      resolvedVia: 'declaration-order',
      fellBack: true,
    };
  }

  const firstAvailable = ordered.find((entry) => isAvailable(entry));
  if (firstAvailable) {
    return {
      preset: firstAvailable,
      resolvedVia: 'declaration-order',
      fellBack: true,
    };
  }

  throw new Error(`No available preset could be resolved for selector "${selector}".`);
}

function resolveFallbackList(entries, fallbacks, kind) {
  for (const fallbackSelector of fallbacks ?? []) {
    const resolved = kind === 'catalog'
      ? resolveCatalogSelection(entries, fallbackSelector)
      : resolvePresetSelection(entries, fallbackSelector);

    if (resolved?.[kind] && isAvailable(resolved[kind])) {
      return resolved;
    }
  }

  return null;
}

function findMatchingEntries(entries, selector, kind) {
  if (!selector) {
    return [];
  }

  return entries.filter((entry) => {
    const aliases = normalizeStringList(entry.aliases);
    const version = normalizeText(entry.version, null);
    const name = normalizeText(entry.name, null);

    if (name === selector || version === selector || aliases.includes(selector)) {
      return true;
    }

    if (selector === 'latest') {
      return name === 'latest' || aliases.includes('latest') || version === 'latest';
    }

    if (kind === 'catalog') {
      return aliases.includes(selector);
    }

    return false;
  }).map((entry) => ({ entry, matchedBy: entry.name === selector || entry.version === selector ? 'exact' : 'alias' }));
}

function chooseCandidates(entries, selector, exactMatches) {
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  if (selector === 'latest') {
    return entries
      .filter((entry) => normalizeStringList(entry.aliases).includes('latest') || normalizeText(entry.version, null) === 'latest' || normalizeText(entry.name, null) === 'latest')
      .map((entry) => ({ entry, matchedBy: 'latest' }));
  }

  if (selector) {
    return entries
      .filter((entry) => normalizeStringList(entry.aliases).includes(selector))
      .map((entry) => ({ entry, matchedBy: 'alias' }));
  }

  return entries.map((entry) => ({ entry, matchedBy: 'declaration-order' }));
}

function resolveComplexityGuidance(complexity, preset, catalog) {
  const normalized = normalizeComplexityDescriptor(complexity);
  const guidanceSource = preset?.guidance ?? catalog?.guidance ?? defaultGuidance();
  const defaultEntry = guidanceSource.default ?? defaultGuidance().default;
  const byComplexity = guidanceSource.byComplexity ?? {};

  if (normalized?.kind === 'label' && normalized.label && byComplexity[normalized.label]) {
    return {
      complexity: normalized,
      recommendation: cloneValue(byComplexity[normalized.label]),
      default: cloneValue(defaultEntry),
    };
  }

  if (normalized?.kind === 'range') {
    const matchingEntry = findRangeGuidanceEntry(byComplexity, normalized);
    if (matchingEntry) {
      return {
        complexity: normalized,
        recommendation: cloneValue(matchingEntry),
        default: cloneValue(defaultEntry),
      };
    }
  }

  return {
    complexity: normalized,
    recommendation: cloneValue(defaultEntry),
    default: cloneValue(defaultEntry),
  };
}

function findRangeGuidanceEntry(byComplexity, range) {
  for (const [label, entry] of Object.entries(byComplexity)) {
    if (label === range.label) {
      return entry;
    }

    if (typeof label === 'string' && range.label && label.includes(range.label)) {
      return entry;
    }
  }

  return null;
}

function defaultGuidance() {
  return {
    default: {
      laneCount: 1,
      ordering: ['primary', 'judge', 'radar'],
    },
    byComplexity: {},
  };
}

function normalizeGuidance(guidance) {
  if (!isObject(guidance)) {
    return undefined;
  }

  return {
    default: guidance.default !== undefined ? cloneValue(guidance.default) : undefined,
    byComplexity: guidance.byComplexity !== undefined ? cloneValue(guidance.byComplexity) : undefined,
  };
}

function buildResolvedPhases(phases) {
  const resolved = {};

  for (const phase of phases) {
    const lanes = phase.lanes.map((lane) => cloneValue(lane));
    const activeLane = pickActiveLane(lanes);

    resolved[phase.name] = {
      active: activeLane,
      candidates: lanes,
      roles: collectRolesFromLanes(lanes),
    };
  }

  return resolved;
}

function pickActiveLane(lanes) {
  const available = lanes.filter((lane) => isAvailable(lane));

  return available.find((lane) => lane.active === true)
    ?? available.find((lane) => lane.role === 'primary')
    ?? available.find((lane) => lane.role === 'secondary')
    ?? available[0]
    ?? lanes[0]
    ?? null;
}

function collectLaneRoles(resolvedPhases) {
  return [...new Set(Object.values(resolvedPhases).flatMap((phase) => phase.roles))];
}

function collectRolesFromLanes(lanes) {
  return [...new Set(lanes.map((lane) => lane.role).filter(Boolean))];
}

function normalizeActivationState(value) {
  if (value === undefined || value === null) {
    return 'active';
  }

  if (value === true) {
    return 'active';
  }

  if (value === false) {
    return 'inactive';
  }

  if (value === 'active' || value === 'inactive') {
    return value;
  }

  throw new Error('router.yaml version 3 requires activation_state as active/inactive or a boolean.');
}

function normalizeAvailability(value) {
  if (value === undefined || value === null) {
    return 'stable';
  }

  if (value === true) {
    return 'available';
  }

  if (value === false) {
    return 'unavailable';
  }

  return normalizeText(value, 'stable');
}

function isAvailable(entry) {
  const availability = normalizeAvailability(entry?.availability);

  if (entry?.available === false) {
    return false;
  }

  return !['unavailable', 'disabled', 'blocked'].includes(availability);
}

function normalizeComplexityDescriptor(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const label = value.trim();
    if (!label) {
      return null;
    }

    return { kind: 'label', label };
  }

  if (!isObject(value)) {
    return null;
  }

  const descriptor = { kind: 'range' };

  if (isNonEmptyString(value.label)) {
    descriptor.label = value.label.trim();
  }

  if (Number.isFinite(value.min)) {
    descriptor.min = value.min;
  }

  if (Number.isFinite(value.max)) {
    descriptor.max = value.max;
  }

  return descriptor;
}

function validateStringList(value, context) {
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error(`${context} must not be empty.`);
    }

    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array of strings.`);
  }

  for (const item of value) {
    if (!isNonEmptyString(item)) {
      throw new Error(`${context} must contain only non-empty strings.`);
    }
  }
}

function normalizeStringList(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item, null)).filter(Boolean);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim();
    }
  }

  return null;
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isActivationState(value) {
  return value === 'active' || value === 'inactive' || value === true || value === false;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  return value;
}
