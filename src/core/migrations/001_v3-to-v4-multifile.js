import { normalizeRouterSchemaV3 } from '../router-schema-v3.js';

export const migration = {
  id: '001',
  name: 'v3-to-v4-multifile',
  description: 'Convert v3/v1 monolith router.yaml into v4 multi-file profile structure',
  type: 'major',
  fromVersion: [1, 3],
  toVersion: 4,
  ownedFields: ['version', 'catalogs', 'active_catalog', 'active_preset', 'active_profile', 'profiles'],

  canApply(config) {
    return config.version === 1 || config.version === 3;
  },

  apply(config, _context) {
    const sanitizedConfig = sanitizeOptionalV3Selectors(config);

    // Normalize to a v3-schema view (handles both v1 and v3 input)
    const normalized = normalizeRouterSchemaV3(sanitizedConfig);

    // Extract active preset/catalog from the original config (prefer raw values)
    const active_preset =
      sanitizedConfig.active_preset ??
      sanitizedConfig.active_profile ??
      normalized.activePresetName ??
      null;

    const activation_state = normalized.activationState ?? 'active';

    // Preserve metadata from the original config (user-owned, non-migrated keys)
    const originalMetadata = config.metadata ?? {};

    // Build coreConfig: owned migration fields only (omit undefined/empty keys so
    // stringifyYaml does not emit `metadata: null` which the v3 validator rejects)
    const coreConfig = { version: 4, active_preset, activation_state };
    if (Object.keys(originalMetadata).length > 0) {
      coreConfig.metadata = { ...originalMetadata };
    }

    // Build profiles array: one profile object per preset, across all catalogs
    const profiles = [];

    for (const catalog of normalized.catalogs) {
      for (const preset of catalog.presets) {
        // Rebuild preset content in the v3 wire format (as stored in profiles/ files)
        const content = buildPresetContent(preset);

        profiles.push({
          name: preset.name,
          catalog: catalog.name,
          content,
        });
      }
    }

    return { coreConfig, profiles };
  },
};

function sanitizeOptionalV3Selectors(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const next = JSON.parse(JSON.stringify(config));
  for (const key of ['active_catalog', 'active_preset', 'active_profile']) {
    if (!(key in next)) {
      continue;
    }

    const value = next[key];
    if (typeof value !== 'string') {
      delete next[key];
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete next[key];
      continue;
    }

    next[key] = trimmed;
  }

  normalizeV3PhaseObjects(next);

  return next;
}

function normalizeV3PhaseObjects(config) {
  if (config.version !== 3 || !config.catalogs || typeof config.catalogs !== 'object') {
    return;
  }

  for (const catalog of Object.values(config.catalogs)) {
    if (!catalog || typeof catalog !== 'object' || !catalog.presets || typeof catalog.presets !== 'object') {
      continue;
    }

    for (const preset of Object.values(catalog.presets)) {
      if (!preset || typeof preset !== 'object' || !preset.phases || typeof preset.phases !== 'object') {
        continue;
      }

      for (const [phaseName, phaseValue] of Object.entries(preset.phases)) {
        if (Array.isArray(phaseValue) || !phaseValue || typeof phaseValue !== 'object') {
          continue;
        }

        const model = typeof phaseValue.model === 'string' ? phaseValue.model.trim() : '';
        if (!model) {
          continue;
        }

        const lane = {
          target: model,
          phase: phaseName,
          role: 'primary',
        };
        const fallbacks = normalizeFallbacks(phaseValue.fallbacks);
        if (fallbacks.length > 0) {
          lane.fallbacks = fallbacks;
        }

        preset.phases[phaseName] = [lane];
      }
    }
  }
}

function normalizeFallbacks(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

/**
 * Convert a normalized preset object back into the v3 wire format
 * used for profile files (phases as objects, not normalized arrays).
 *
 * The normalized form has preset.phases as an array:
 *   [{ name: 'orchestrator', lanes: [{phase, role, target, fallbacks, ...}] }]
 *
 * The v3 wire format for profile files has phases as an object:
 *   { orchestrator: [ {phase, role, target, ...} ] }
 */
function buildPresetContent(preset) {
  const phases = {};

  for (const phase of preset.phases ?? []) {
    phases[phase.name] = phase.lanes.map((lane) => buildLaneContent(lane));
  }

  const content = {
    name: preset.name,
    phases,
  };

  // Include optional fields only when present and meaningful
  if (preset.availability && preset.availability !== 'stable') {
    content.availability = preset.availability;
  }

  if (preset.complexity !== null && preset.complexity !== undefined) {
    content.complexity = preset.complexity;
  }

  if (preset.guidance !== undefined && preset.guidance !== null) {
    content.guidance = preset.guidance;
  }

  // Omit normalizer-injected 'latest' alias (added automatically for index-0 presets in v1)
  const meaningfulAliases = (preset.aliases ?? []).filter((a) => a !== 'latest');
  if (meaningfulAliases.length > 0) {
    content.aliases = meaningfulAliases;
  }

  if (preset.fallbacks && preset.fallbacks.length > 0) {
    content.fallbacks = preset.fallbacks;
  }

  if (preset.metadata && Object.keys(preset.metadata).length > 0) {
    content.metadata = { ...preset.metadata };
  }

  return content;
}

function buildLaneContent(lane) {
  // target must be the first key so the custom YAML parser recognises this
  // list item as an object (looksLikeRouteObjectLine checks for /^target:/).
  const obj = {};

  if (lane.target !== null && lane.target !== undefined) {
    obj.target = lane.target;
  }

  obj.phase = lane.phase;
  obj.role = lane.role;

  if (lane.fallbacks && lane.fallbacks.length > 0) {
    obj.fallbacks = lane.fallbacks;
  }

  // Only include `path` when all entries are plain strings.
  // The normalizer may populate `path` with internal route-candidate objects;
  // those must NOT be serialised into profile files.
  if (lane.path && lane.path.length > 0) {
    const stringPath = lane.path.filter((e) => typeof e === 'string');
    if (stringPath.length > 0) {
      obj.path = stringPath;
    }
  }

  if (lane.availability && lane.availability !== 'stable') {
    obj.availability = lane.availability;
  }

  if (lane.complexity !== null && lane.complexity !== undefined) {
    obj.complexity = lane.complexity;
  }

  // Omit normalizer-internal lane metadata (e.g. { source: 'v1-chain', candidateCount: N }).
  // Only include lane metadata when it contains user-authored keys.
  if (lane.metadata && !isNormalizerInternalMetadata(lane.metadata) &&
      Object.keys(lane.metadata).length > 0) {
    obj.metadata = { ...lane.metadata };
  }

  return obj;
}

/**
 * Returns true when the metadata object was produced by the normalizer and
 * should not be forwarded to the migrated profile file.
 */
function isNormalizerInternalMetadata(metadata) {
  return typeof metadata.source === 'string' && typeof metadata.candidateCount === 'number';
}
