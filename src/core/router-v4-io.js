import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './router.js';

/** Resolve the plugin's own router/ directory (where built-in presets live). */
const __pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN_PROFILES_DIR = path.join(__pluginDir, 'router', 'profiles');
const PLUGIN_CATALOGS_DIR = path.join(__pluginDir, 'router', 'catalogs');

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

const ALLOWED_IDENTITY_KEYS = new Set(['context', 'prompt', 'inherit_agents_md', 'persona']);

const VALID_DEBUG_INVOKE_TRIGGERS = new Set(['on_issues', 'always', 'never', 'manual']);

const ALLOWED_PERMISSION_KEYS = new Set(['read', 'write', 'edit', 'bash', 'delegate']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkExecutionHints(value, context) {
  for (const key of Object.keys(value)) {
    if (EXECUTION_HINT_FIELDS.has(key)) {
      throw new Error(`${context} must not include execution-oriented field "${key}".`);
    }
  }
}

function validateIdentity(identity, filePath) {
  if (!isObject(identity)) {
    throw new Error(`Profile file "${filePath}" has "identity" but it must be an object.`);
  }

  for (const [key, value] of Object.entries(identity)) {
    if (!ALLOWED_IDENTITY_KEYS.has(key)) {
      throw new Error(
        `Profile file "${filePath}" has unknown identity field "${key}". ` +
        `Allowed identity fields: ${[...ALLOWED_IDENTITY_KEYS].join(', ')}.`
      );
    }

    if (key === 'inherit_agents_md' && typeof value !== 'boolean') {
      throw new Error(
        `Profile file "${filePath}" has identity.inherit_agents_md but it must be a boolean.`
      );
    }

    if (key === 'context' && value !== null && typeof value !== 'string') {
      throw new Error(
        `Profile file "${filePath}" has identity.context but it must be a string or null.`
      );
    }

    if (key === 'prompt' && value !== null && typeof value !== 'string') {
      throw new Error(
        `Profile file "${filePath}" has identity.prompt but it must be a string or null.`
      );
    }
  }
}

function validateDebugInvoke(debugInvoke, filePath) {
  if (!isObject(debugInvoke)) {
    throw new Error(`Profile file "${filePath}" has "debug_invoke" but it must be an object.`);
  }

  // preset is required and must be a non-empty string
  if (typeof debugInvoke.preset !== 'string' || !debugInvoke.preset.trim()) {
    throw new Error(
      `Profile file "${filePath}" debug_invoke.preset must be a non-empty string.`
    );
  }

  // trigger is required and must be one of the valid values
  if (debugInvoke.trigger !== undefined) {
    if (!VALID_DEBUG_INVOKE_TRIGGERS.has(debugInvoke.trigger)) {
      throw new Error(
        `Profile file "${filePath}" debug_invoke.trigger "${debugInvoke.trigger}" is invalid. ` +
        `Must be one of: on_issues, always, never, manual.`
      );
    }
  }

  // input_from must be a string if present
  if (debugInvoke.input_from !== undefined && typeof debugInvoke.input_from !== 'string') {
    throw new Error(
      `Profile file "${filePath}" debug_invoke.input_from must be a string.`
    );
  }

  // required_fields must be an array of strings if present
  if (debugInvoke.required_fields !== undefined) {
    if (!Array.isArray(debugInvoke.required_fields)) {
      throw new Error(
        `Profile file "${filePath}" debug_invoke.required_fields must be an array of strings.`
      );
    }
    for (const field of debugInvoke.required_fields) {
      if (typeof field !== 'string') {
        throw new Error(
          `Profile file "${filePath}" debug_invoke.required_fields must contain only strings.`
        );
      }
    }
  }
}

function validatePermissions(permissions, filePath) {
  if (!isObject(permissions)) {
    throw new Error(`Profile file "${filePath}" has "permissions" but it must be an object.`);
  }

  for (const [key, value] of Object.entries(permissions)) {
    if (!ALLOWED_PERMISSION_KEYS.has(key)) {
      throw new Error(
        `Profile file "${filePath}" has unknown permission key "${key}". ` +
        `Allowed keys: ${[...ALLOWED_PERMISSION_KEYS].join(', ')}.`
      );
    }

    if (typeof value !== 'boolean') {
      throw new Error(
        `Profile file "${filePath}" has non-boolean value for permission "${key}". ` +
        `All permission values must be true or false.`
      );
    }
  }
}

export function validateProfileFile(profile, filePath) {
  if (!isObject(profile)) {
    throw new Error(`Profile file "${filePath}" must contain a valid root object.`);
  }

  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new Error(`Profile file "${filePath}" requires a non-empty "name" field.`);
  }

  if (!isObject(profile.phases) || Object.keys(profile.phases).length === 0) {
    throw new Error(`Profile file "${filePath}" requires "phases" as a non-empty object.`);
  }

  checkExecutionHints(profile, `Profile file "${filePath}"`);

  if (profile.permissions !== undefined) {
    validatePermissions(profile.permissions, filePath);
  }

  if (profile.hidden !== undefined && typeof profile.hidden !== 'boolean') {
    throw new Error(`Profile file "${filePath}" has "hidden" but it must be a boolean.`);
  }

  if (profile.identity !== undefined) {
    validateIdentity(profile.identity, filePath);
  }

  if (profile.debug_invoke !== undefined) {
    validateDebugInvoke(profile.debug_invoke, filePath);
  }

  // Validate contextWindow on each lane if present
  if (isObject(profile.phases)) {
    for (const [phaseName, lanes] of Object.entries(profile.phases)) {
      if (!Array.isArray(lanes)) continue;
      for (const lane of lanes) {
        if (!isObject(lane)) continue;
        if (lane.contextWindow !== undefined) {
          if (!Number.isInteger(lane.contextWindow) || lane.contextWindow <= 0) {
            throw new Error(
              `Profile file "${filePath}" phase "${phaseName}" has invalid "contextWindow". ` +
              `Must be a positive integer.`
            );
          }
        }
      }
    }
  }

  // Validate phase-level metadata (new optional fields for object-shaped entries)
  if (isObject(profile.phases)) {
    for (const [phaseName, phaseEntry] of Object.entries(profile.phases)) {
      const phaseConfig = Array.isArray(phaseEntry) ? null : isObject(phaseEntry) ? phaseEntry : null;
      if (!phaseConfig) continue; // Array format — no phase-level metadata

      if (phaseConfig.execution !== undefined) {
        if (!['parallel', 'sequential'].includes(phaseConfig.execution)) {
          throw new Error(
            `Profile file "${filePath}" phase "${phaseName}" has invalid "execution". ` +
            `Must be "parallel" or "sequential".`
          );
        }
      }
      if (phaseConfig.trigger !== undefined) {
        if (!['always', 'on-failure', 'manual'].includes(phaseConfig.trigger)) {
          throw new Error(
            `Profile file "${filePath}" phase "${phaseName}" has invalid "trigger". ` +
            `Must be "always", "on-failure", or "manual".`
          );
        }
      }
      if (phaseConfig.depends_on !== undefined) {
        if (typeof phaseConfig.depends_on !== 'string') {
          throw new Error(
            `Profile file "${filePath}" phase "${phaseName}" has invalid "depends_on". ` +
            `Must be a string.`
          );
        }
      }
    }
  }

  return profile;
}

/**
 * Load v4 profile files from project profiles/ directory AND plugin global profiles.
 * Project profiles win over global ones if they share a name.
 *
 * @param {string} routerDir - Project router/ directory
 * @param {{ includeGlobal?: boolean }} [options] - Set includeGlobal: false to skip plugin profiles (for testing)
 */
export function loadV4Profiles(routerDir, options = {}) {
  const includeGlobal = options.includeGlobal !== false && process.env.GSR_TEST_NO_GLOBAL !== '1';
  const projectProfilesDir = path.join(routerDir, 'profiles');

  if (!fs.existsSync(projectProfilesDir)) {
    throw new Error(`No profiles directory found at "${projectProfilesDir}". A v4 router requires at least one profile file.`);
  }

  const results = [];

  // 1. Load project-local profiles FIRST (they win over global)
  //    Do NOT deduplicate here — assembleV4Config detects intra-project duplicates.
  _loadProfilesFromDir(projectProfilesDir, results, null);

  // 2. Load plugin global profiles (only those NOT already loaded from project)
  if (includeGlobal) {
    const globalProfilesDir = PLUGIN_PROFILES_DIR;
    if (fs.existsSync(globalProfilesDir) && globalProfilesDir !== projectProfilesDir) {
      // Build the skip set from already-loaded project profiles
      const projectNames = new Set(results.map(r => r.content.name ?? r.fileName.replace('.router.yaml', '')));
      _loadProfilesFromDir(globalProfilesDir, results, projectNames);
    }
  }

  if (results.length === 0) {
    throw new Error(`No profile files found under "${projectProfilesDir}". A v4 router requires at least one *.router.yaml file.`);
  }

  return results;
}

/**
 * Scan a profiles directory for *.router.yaml files and subdirectories.
 * @param {string} profilesDir
 * @param {Array} results - accumulator array
 * @param {Set|null} skipNames - names to skip (used for global vs project deduplication). Pass null to skip no names.
 */
function _loadProfilesFromDir(profilesDir, results, skipNames) {
  const topEntries = fs.readdirSync(profilesDir);

  for (const entry of topEntries) {
    const entryPath = path.join(profilesDir, entry);
    const stat = fs.statSync(entryPath);

    if (stat.isDirectory()) {
      const catalogName = entry;
      const subEntries = fs.readdirSync(entryPath);

      for (const subEntry of subEntries) {
        if (!subEntry.endsWith('.router.yaml')) {
          continue;
        }

        const filePath = path.join(entryPath, subEntry);
        const fileName = subEntry;
        const raw = fs.readFileSync(filePath, 'utf8');
        const content = parseYaml(raw);

        // Project profiles win over global — skip if name already loaded from project
        const presetName = content.name ?? fileName.replace('.router.yaml', '');
        if (skipNames && skipNames.has(presetName)) continue;

        validateProfileFile(content, filePath);
        results.push({ filePath, fileName, catalogName, content });
      }
    } else if (entry.endsWith('.router.yaml')) {
      const filePath = entryPath;
      const fileName = entry;
      const catalogName = 'default';
      const raw = fs.readFileSync(filePath, 'utf8');
      const content = parseYaml(raw);

      const presetName = content.name ?? fileName.replace('.router.yaml', '');
      if (skipNames && skipNames.has(presetName)) continue;

      validateProfileFile(content, filePath);
      results.push({ filePath, fileName, catalogName, content });
    }
  }
}

export function assembleV4Config(coreConfig, profiles) {
  const seenPresets = new Map();

  for (const { content, filePath, catalogName } of profiles) {
    const presetName = content.name;

    if (seenPresets.has(presetName)) {
      const existing = seenPresets.get(presetName);
      throw new Error(
        `Duplicate preset name "${presetName}" found in "${filePath}" and "${existing.filePath}".`
      );
    }

    seenPresets.set(presetName, { filePath, catalogName });
  }

  const catalogsMap = {};

  for (const { content, filePath, catalogName } of profiles) {
    const presetName = content.name;

    if (!catalogsMap[catalogName]) {
      const coreCatalogMeta = isObject(coreConfig.catalogs) ? coreConfig.catalogs[catalogName] : undefined;

      catalogsMap[catalogName] = {
        availability: coreCatalogMeta?.availability ?? 'stable',
        ...(coreCatalogMeta?.complexity != null ? { complexity: coreCatalogMeta.complexity } : {}),
        ...(coreCatalogMeta?.guidance != null ? { guidance: coreCatalogMeta.guidance } : {}),
        ...(coreCatalogMeta?.enabled != null ? { enabled: coreCatalogMeta.enabled } : { enabled: catalogName === 'default' }),
        ...(coreCatalogMeta?.displayName != null ? { displayName: coreCatalogMeta.displayName } : {}),
        ...(coreCatalogMeta?.active_preset != null ? { active_preset: coreCatalogMeta.active_preset } : {}),
        presets: {},
      };
    }

    const { name: _name, ...presetContent } = content;
    catalogsMap[catalogName].presets[presetName] = presetContent;
  }

  const assembled = {
    version: 3,
    active_catalog: coreConfig.active_catalog ?? 'default',
    active_preset: coreConfig.active_preset,
    active_profile: coreConfig.active_preset,
    activation_state: coreConfig.activation_state,
    metadata: coreConfig.metadata,
    catalogs: catalogsMap,
    ...(coreConfig.persona !== undefined ? { persona: coreConfig.persona } : {}),
    ...(coreConfig.identity !== undefined ? { identity: coreConfig.identity } : {}),
  };

  const profileMap = new Map(
    profiles.map(({ filePath, catalogName, content }) => [content.name, { filePath, catalogName }])
  );

  Object.defineProperty(assembled, '_v4Source', {
    value: {
      coreConfig,
      profileMap,
      routerDir: null,
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return assembled;
}

export function disassembleV4Config(config) {
  const v4Source = config._v4Source;

  if (!v4Source) {
    throw new Error('Config does not have _v4Source metadata. Only assembled v4 configs can be disassembled.');
  }

  const coreFields = {
    version: 4,
    active_catalog: config.active_catalog,
    active_preset: config.active_preset,
    activation_state: config.activation_state,
    metadata: config.metadata,
  };

  const profilesOut = [];

  for (const [catalogName, catalog] of Object.entries(config.catalogs ?? {})) {
    for (const [presetName, preset] of Object.entries(catalog.presets ?? {})) {
      const sourceInfo = v4Source.profileMap?.get(presetName);

      profilesOut.push({
        name: presetName,
        catalog: catalogName,
        filePath: sourceInfo?.filePath ?? null,
        content: {
          name: presetName,
          ...preset,
        },
      });
    }
  }

  return {
    coreFields,
    profiles: profilesOut,
  };
}

function serializableConfig(config) {
  const result = {};

  for (const [key, value] of Object.entries(config)) {
    result[key] = value;
  }

  return result;
}

export function buildV4WritePlan(oldConfig, newConfig) {
  // oldConfig may be null for fresh installs — treat everything as new in that case.
  const oldSource = oldConfig?._v4Source;
  const newSource = newConfig._v4Source;

  const oldCore = oldConfig ? (oldSource?.coreConfig ?? serializableConfig(oldConfig)) : null;
  const newCore = newSource?.coreConfig ?? serializableConfig(newConfig);

  const coreFields = ['active_catalog', 'active_preset', 'active_profile', 'activation_state', 'metadata'];
  const coreChanged = !oldCore || coreFields.some(
    (field) => JSON.stringify(oldCore[field]) !== JSON.stringify(newCore[field])
  );

  const coreContent = {
    version: 4,
    active_catalog: newCore.active_catalog ?? newConfig.active_catalog,
    active_preset: newCore.active_preset ?? newConfig.active_preset,
    activation_state: newCore.activation_state ?? newConfig.activation_state,
    metadata: newCore.metadata ?? newConfig.metadata,
  };

  const profileWrites = [];
  const profileDeletes = [];

  const oldCatalogs = oldConfig?.catalogs ?? {};
  const newCatalogs = newConfig.catalogs ?? {};

  const oldPresetMap = new Map();
  for (const [catalogName, catalog] of Object.entries(oldCatalogs)) {
    for (const [presetName, preset] of Object.entries(catalog.presets ?? {})) {
      oldPresetMap.set(presetName, { catalogName, preset });
    }
  }

  const newPresetMap = new Map();
  for (const [catalogName, catalog] of Object.entries(newCatalogs)) {
    for (const [presetName, preset] of Object.entries(catalog.presets ?? {})) {
      newPresetMap.set(presetName, { catalogName, preset });
    }
  }

  for (const [presetName, { catalogName, preset }] of newPresetMap) {
    const oldEntry = oldPresetMap.get(presetName);
    const sourceInfo = newSource?.profileMap?.get(presetName);

    const filePath = sourceInfo?.filePath ?? null;

    if (!oldEntry || JSON.stringify(oldEntry.preset) !== JSON.stringify(preset)) {
      profileWrites.push({
        filePath,
        presetName,
        catalogName,
        content: { name: presetName, ...preset },
      });
    }
  }

  for (const [presetName] of oldPresetMap) {
    if (!newPresetMap.has(presetName)) {
      const sourceInfo = oldSource?.profileMap?.get(presetName);
      const filePath = sourceInfo?.filePath ?? null;

      profileDeletes.push({ filePath, presetName });
    }
  }

  return {
    coreChanged,
    coreContent,
    profileWrites,
    profileDeletes,
    writeOrder: 'profiles-first-core-last',
  };
}
