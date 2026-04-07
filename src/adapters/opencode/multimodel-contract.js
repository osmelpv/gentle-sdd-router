import { normalizeRouterSchemaV3 } from '../../core/router-schema-v3.js';

export const MULTIMODEL_CONTRACT_VERSION = '1';

export const DEFAULT_MULTIMODEL_VISIBILITY = Object.freeze({
  availability: true,
  pricing: true,
  labels: true,
  guidance: true,
});

export function createMultimodelBrowseContract(source, selector, visibilityPolicy = DEFAULT_MULTIMODEL_VISIBILITY) {
  const schema = normalizeMultimodelSchema(source);
  const selection = resolveMultimodelSelection(schema, selector);
  const projected = projectShareableMultimodelMetadata(selection.sdd, selection.preset, visibilityPolicy);

  return {
    kind: 'multimodel-browse-contract',
    contractVersion: MULTIMODEL_CONTRACT_VERSION,
    schemaVersion: schema.version ?? schema.sourceVersion ?? 3,
    selector: selection.selector,
    resolvedSelector: `${selection.sdd.name}/${selection.preset.name}`,
    ...projected,
  };
}

export function createMultimodelCompareContract(source, leftSelector, rightSelector, visibilityPolicy = DEFAULT_MULTIMODEL_VISIBILITY) {
  const schema = normalizeMultimodelSchema(source);
  const leftSelection = resolveMultimodelSelection(schema, leftSelector);
  const rightSelection = resolveMultimodelSelection(schema, rightSelector);
  const left = projectShareableMultimodelMetadata(leftSelection.sdd, leftSelection.preset, visibilityPolicy);
  const right = projectShareableMultimodelMetadata(rightSelection.sdd, rightSelection.preset, visibilityPolicy);

  return {
    kind: 'multimodel-compare-contract',
    contractVersion: MULTIMODEL_CONTRACT_VERSION,
    schemaVersion: schema.version ?? schema.sourceVersion ?? 3,
    leftSelector: leftSelection.selector,
    rightSelector: rightSelection.selector,
    leftResolvedSelector: `${leftSelection.sdd.name}/${leftSelection.preset.name}`,
    rightResolvedSelector: `${rightSelection.sdd.name}/${rightSelection.preset.name}`,
    left,
    right,
    differences: diffProjectedMetadata(left, right),
    visibility: left.visibility,
    policy: left.policy,
  };
}

export function projectShareableMultimodelMetadata(sdd, preset, visibilityPolicy = DEFAULT_MULTIMODEL_VISIBILITY) {
  const visibility = normalizeVisibilityPolicy(visibilityPolicy);
  const sddLabels = visibility.labels ? collectLabels(sdd) : [];
  const presetAliases = visibility.labels ? normalizeStringList(preset?.aliases) : [];
  const pricing = extractPricing(sdd, preset);
  const guidance = extractGuidance(sdd, preset);
  const laneSummary = visibility.guidance ? summarizeLaneSummary(preset) : [];

  return {
    visibility,
    policy: {
      nonRecommendation: true,
      nonExecution: true,
    },
    catalog: {
      name: sdd?.name ?? null,
      visibility: {
        availability: visibility.availability,
        labels: visibility.labels,
      },
      availability: visibility.availability ? normalizeAvailability(sdd?.availability) : null,
      labels: sddLabels,
    },
    preset: {
      name: preset?.name ?? null,
      visibility: {
        availability: visibility.availability,
        labels: visibility.labels,
        guidance: visibility.guidance,
      },
      aliases: presetAliases,
      availability: visibility.availability ? normalizeAvailability(preset?.availability) : null,
      complexity: cloneValue(preset?.complexity ?? null),
      laneSummary,
    },
    pricing: {
      visibility: visibility.pricing,
      band: visibility.pricing ? pricing.band : null,
      currency: visibility.pricing ? pricing.currency : null,
    },
    guidance: {
      visibility: visibility.guidance,
      summary: visibility.guidance ? guidance.summary : null,
    },
  };
}

function resolveMultimodelSelection(schema, selector) {
  const selectorInfo = normalizeSelector(selector);
  const catalogs = schema.catalogs ?? [];
  const explicitSdd = selectorInfo.catalogSelector
    ? findSddBySelector(catalogs, selectorInfo.catalogSelector)
    : findSddBySelector(catalogs, selectorInfo.presetSelector);
  const sdd = selectorInfo.catalogSelector
    ? resolveSdd(catalogs, selectorInfo.catalogSelector, schema.selectedCatalogName)
    : (explicitSdd ?? resolveSdd(catalogs, null, schema.selectedCatalogName));
  const presetSelector = selectorInfo.catalogSelector
    ? selectorInfo.presetSelector
    : (explicitSdd ? null : selectorInfo.presetSelector);
  const preset = resolvePreset(sdd, presetSelector, schema.selectedPresetName, selectorInfo.selector === null);

  return {
    selector: selectorInfo.selector ?? `${sdd.name}/${preset.name}`,
    sdd,
    preset,
  };
}

function resolveSdd(catalogs, selector, activeSddName) {
  if (!Array.isArray(catalogs) || catalogs.length === 0) {
    throw new Error('multimodel browse/compare requires at least one SDD in the normalized schema.');
  }

  const activeSdd = catalogs.find((sdd) => sdd.name === activeSddName) ?? catalogs[0];
  if (!selector) {
    return activeSdd;
  }

  const match = catalogs.find((sdd) => matchesSelector(sdd, selector));
  if (!match) {
    throw new Error(`Could not resolve multimodel SDD selector "${selector}".`);
  }

  return match;
}

function findSddBySelector(catalogs, selector) {
  if (!selector) {
    return null;
  }

  return catalogs.find((sdd) => matchesSelector(sdd, selector)) ?? null;
}

function resolvePreset(sdd, selector, activePresetName, preferActivePreset = false) {
  if (!Array.isArray(sdd?.presets) || sdd.presets.length === 0) {
    throw new Error(`SDD "${sdd?.name ?? 'unknown'}" does not contain any presets.`);
  }

  if (!selector) {
    if (preferActivePreset) {
      const activePreset = sdd.presets.find((preset) => preset.name === activePresetName);
      if (activePreset) {
        return activePreset;
      }
    }

    return sdd.presets.find((preset) => isNonEmptyString(sdd.defaultPreset) && preset.name === sdd.defaultPreset)
      ?? sdd.presets[0];
  }

  const match = sdd.presets.find((preset) => matchesSelector(preset, selector));
  if (!match) {
    throw new Error(`Could not resolve multimodel preset selector "${selector}" in SDD "${sdd.name}".`);
  }

  return match;
}

function normalizeMultimodelSchema(source) {
  if (!source) {
    throw new Error('multimodel browse/compare requires a normalized schema source.');
  }

  if (source.kind === 'router-schema-v3-view') {
    return source;
  }

  return normalizeRouterSchemaV3(source);
}

function normalizeSelector(selector) {
  if (selector === undefined || selector === null) {
    return { selector: null, catalogSelector: null, presetSelector: null };
  }

  if (isObject(selector)) {
    const catalogSelector = firstNonEmptyString(selector.catalog, selector.catalogName, selector.catalog_selector);
    const presetSelector = firstNonEmptyString(selector.preset, selector.presetName, selector.preset_selector);

    return {
      selector: firstNonEmptyString(selector.selector, selector.value, buildSelectorText(catalogSelector, presetSelector)),
      catalogSelector,
      presetSelector,
    };
  }

  const text = String(selector).trim();
  if (!text) {
    return { selector: null, catalogSelector: null, presetSelector: null };
  }

  const [catalogSelector, presetSelector] = text.includes('/')
    ? text.split('/', 2).map((part) => part.trim())
    : [null, text];

  return {
    selector: text,
    catalogSelector: catalogSelector || null,
    presetSelector: presetSelector || null,
  };
}

function buildSelectorText(catalogSelector, presetSelector) {
  if (catalogSelector && presetSelector) {
    return `${catalogSelector}/${presetSelector}`;
  }

  return catalogSelector ?? presetSelector ?? null;
}

function matchesSelector(entry, selector) {
  if (!selector) {
    return false;
  }

  const aliases = normalizeStringList(entry?.aliases);
  const name = normalizeText(entry?.name, null);

  return name === selector || aliases.includes(selector);
}

function projectFieldValue(left, right, path) {
  const leftValue = readPath(left, path);
  const rightValue = readPath(right, path);

  if (valuesEqual(leftValue, rightValue)) {
    return null;
  }

  return { path, left: cloneValue(leftValue), right: cloneValue(rightValue) };
}

function diffProjectedMetadata(left, right) {
  const paths = [
    'catalog.name',
    'catalog.availability',
    'catalog.labels',
    'preset.name',
    'preset.aliases',
    'preset.availability',
    'preset.complexity',
    'preset.laneSummary',
    'pricing.band',
    'pricing.currency',
    'guidance.summary',
    'visibility.availability',
    'visibility.pricing',
    'visibility.labels',
    'visibility.guidance',
    'policy.nonRecommendation',
    'policy.nonExecution',
  ];

  return paths.map((path) => projectFieldValue(left, right, path)).filter(Boolean);
}

function extractPricing(sdd, preset) {
  const sources = [preset?.metadata?.pricing, sdd?.metadata?.pricing, preset?.metadata?.price, sdd?.metadata?.price];

  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }

    return {
      band: firstNonEmptyString(source.band, source.priceBand, source.price_band, source.tier, source.label),
      currency: firstNonEmptyString(source.currency, source.currencyCode, source.currency_code),
    };
  }

  return { band: null, currency: null };
}

function extractGuidance(sdd, preset) {
  const source = isObject(preset?.guidance) ? preset.guidance : (isObject(sdd?.guidance) ? sdd.guidance : null);

  if (!source) {
    return {
      summary: null,
    };
  }

  const summary = {
    default: summarizeGuidanceEntry(source.default),
    byComplexity: Object.fromEntries(
      Object.entries(source.byComplexity ?? {}).map(([label, entry]) => [label, summarizeGuidanceEntry(entry)]),
    ),
  };

  return { summary };
}

function summarizeGuidanceEntry(entry) {
  if (!isObject(entry)) {
    return null;
  }

  return {
    laneCount: Number.isFinite(entry.laneCount) ? entry.laneCount : null,
    ordering: normalizeStringList(entry.ordering),
  };
}

function summarizeLaneSummary(preset) {
  const phases = Array.isArray(preset?.phases) ? preset.phases : [];

  return phases.map((phase) => ({
    phase: phase?.name ?? null,
    laneCount: Array.isArray(phase?.lanes) ? phase.lanes.length : 0,
    roles: Array.from(new Set((phase?.lanes ?? []).map((lane) => lane?.role).filter(Boolean))),
  }));
}

function normalizeVisibilityPolicy(policy = {}) {
  return {
    availability: policy.availability !== false,
    pricing: policy.pricing !== false,
    labels: policy.labels !== false,
    guidance: policy.guidance !== false,
  };
}

function collectLabels(entry) {
  const labels = [];

  if (Array.isArray(entry?.labels)) {
    labels.push(...entry.labels);
  }

  labels.push(...normalizeStringList(entry?.metadata?.labels));
  labels.push(...normalizeStringList(entry?.metadata?.tags));
  labels.push(...normalizeStringList(entry?.aliases));

  return Array.from(new Set(labels.filter(Boolean)));
}

function readPath(value, path) {
  return path.split('.').reduce((acc, key) => (isObject(acc) || Array.isArray(acc) ? acc[key] : undefined), value);
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
