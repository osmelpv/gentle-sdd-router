import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './router.js';

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

  return profile;
}

export function loadV4Profiles(routerDir) {
  const profilesDir = path.join(routerDir, 'profiles');

  if (!fs.existsSync(profilesDir)) {
    throw new Error(`No profiles directory found at "${profilesDir}". A v4 router requires at least one profile file.`);
  }

  const results = [];

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

        validateProfileFile(content, filePath);

        results.push({ filePath, fileName, catalogName, content });
      }
    } else if (entry.endsWith('.router.yaml')) {
      const filePath = entryPath;
      const fileName = entry;
      const catalogName = 'default';
      const raw = fs.readFileSync(filePath, 'utf8');
      const content = parseYaml(raw);

      validateProfileFile(content, filePath);

      results.push({ filePath, fileName, catalogName, content });
    }
  }

  if (results.length === 0) {
    throw new Error(`No profile files found under "${profilesDir}". A v4 router requires at least one *.router.yaml file.`);
  }

  return results;
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
