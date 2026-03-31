import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { get } from 'node:https';
import { parseYaml, stringifyYaml } from './router.js';
import { validateProfileFile } from './router-v4-io.js';

const COMPACT_PREFIX = 'gsr://';
const URL_TIMEOUT_MS = 10000;
const URL_SIZE_LIMIT = 1024 * 1024; // 1MB

// === EXPORT ===

/**
 * Export a single preset as raw YAML string.
 * Reconstructs the standalone profile file content from the assembled config.
 * @param {object} config - assembled v4 config with _v4Source
 * @param {string} presetName
 * @returns {string} YAML string
 */
export function exportPreset(config, presetName) {
  const profileContent = findPresetContent(config, presetName);
  if (!profileContent) throw new Error(`Preset '${presetName}' not found`);

  return stringifyYaml(profileContent);
}

/**
 * Export a single preset as a gsr:// compact string.
 * @param {object} config - assembled v4 config with _v4Source
 * @param {string} presetName
 * @returns {string} compact string
 */
export function exportPresetCompact(config, presetName) {
  const yaml = exportPreset(config, presetName);
  return encodeCompactString(yaml);
}

/**
 * Export all presets as a Map<presetName, yamlString>.
 * @param {object} config - assembled v4 config
 * @returns {Map<string, string>}
 */
export function exportAllPresets(config) {
  const result = new Map();
  const catalogs = config.catalogs || {};

  for (const catalog of Object.values(catalogs)) {
    const presets = catalog.presets || {};
    for (const [name, preset] of Object.entries(presets)) {
      const profileContent = { name, ...preset };
      // Remove internal fields that shouldn't be exported
      delete profileContent._normalized;
      result.set(name, stringifyYaml(profileContent));
    }
  }

  return result;
}

// === IMPORT ===

/**
 * Import a preset from a raw YAML string.
 * @param {string} yamlString
 * @param {string} routerDir - path to the router directory (contains profiles/)
 * @param {object} options - { catalog?: string, force?: boolean }
 * @returns {{ presetName: string, path: string, catalog: string }}
 */
export function importPresetFromYaml(yamlString, routerDir, options = {}) {
  const parsed = parseYaml(yamlString);
  validateProfileFile(parsed, '<import>');

  const presetName = parsed.name;
  if (!presetName) throw new Error('Profile must have a name field');

  const catalog = options.catalog && options.catalog !== 'default'
    ? options.catalog
    : 'default';

  const profilesDir = catalog !== 'default'
    ? join(routerDir, 'profiles', catalog)
    : join(routerDir, 'profiles');

  const targetPath = join(profilesDir, `${presetName}.router.yaml`);

  if (existsSync(targetPath) && !options.force) {
    throw new Error(`Preset '${presetName}' already exists at ${targetPath}. Use --force to overwrite.`);
  }

  mkdirSync(profilesDir, { recursive: true });
  const yaml = stringifyYaml(parsed);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);

  return { presetName, path: targetPath, catalog };
}

/**
 * Import a preset from a gsr:// compact string.
 * @param {string} compactString
 * @param {string} routerDir
 * @param {object} options
 * @returns {{ presetName: string, path: string, catalog: string }}
 */
export function importPresetFromCompact(compactString, routerDir, options = {}) {
  const yaml = decodeCompactString(compactString);
  return importPresetFromYaml(yaml, routerDir, options);
}

/**
 * Import a preset from an HTTPS URL.
 * @param {string} url - must start with https://
 * @param {string} routerDir
 * @param {object} options
 * @returns {Promise<{ presetName: string, path: string, catalog: string }>}
 */
export function importPresetFromUrl(url, routerDir, options = {}) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      reject(new Error('Only HTTPS URLs are supported'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('URL fetch timed out (10s)'));
    }, URL_TIMEOUT_MS);

    const req = get(url, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }

      const chunks = [];
      let totalSize = 0;

      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > URL_SIZE_LIMIT) {
          clearTimeout(timeout);
          req.destroy();
          reject(new Error(`URL response exceeds 1MB size limit`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const yaml = Buffer.concat(chunks).toString('utf8');
          const result = importPresetFromYaml(yaml, routerDir, options);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      res.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// === COMPACT ENCODING ===

/**
 * Encode a YAML string as a gsr:// compact string.
 * @param {string} yaml
 * @returns {string}
 */
export function encodeCompactString(yaml) {
  const compressed = gzipSync(Buffer.from(yaml, 'utf8'));
  return COMPACT_PREFIX + compressed.toString('base64');
}

/**
 * Decode a gsr:// compact string back to YAML.
 * @param {string} str
 * @returns {string}
 */
export function decodeCompactString(str) {
  if (!str.startsWith(COMPACT_PREFIX)) {
    throw new Error(`Invalid compact string: must start with '${COMPACT_PREFIX}'`);
  }
  const base64 = str.slice(COMPACT_PREFIX.length);
  const decompressed = gunzipSync(Buffer.from(base64, 'base64'));
  return decompressed.toString('utf8');
}

// === HELPERS ===

/**
 * Find a preset by name in the assembled config and return its full profile content.
 * @param {object} config
 * @param {string} presetName
 * @returns {object|null} profile content with name field included
 */
function findPresetContent(config, presetName) {
  const catalogs = config.catalogs || {};

  for (const catalog of Object.values(catalogs)) {
    const presets = catalog.presets || {};
    if (presets[presetName]) {
      const profileContent = { name: presetName, ...presets[presetName] };
      // Remove internal fields that shouldn't be exported
      delete profileContent._normalized;
      return profileContent;
    }
  }

  return null;
}

export { COMPACT_PREFIX };

// === PROFILE CRUD ===

/**
 * Find the file path for a profile by name.
 * If catalog is provided (and not 'default'), searches only that catalog subdirectory.
 * Otherwise, searches the default flat directory first, then named subdirectories.
 * @param {string} name
 * @param {string} routerDir
 * @param {string|undefined} catalog
 * @returns {string|null}
 */
function findProfilePath(name, routerDir, catalog) {
  const profilesDir = join(routerDir, 'profiles');

  if (catalog && catalog !== 'default') {
    const p = join(profilesDir, catalog, `${name}.router.yaml`);
    return existsSync(p) ? p : null;
  }

  // Search default (flat) first
  const flat = join(profilesDir, `${name}.router.yaml`);
  if (existsSync(flat)) return flat;

  // Search named subdirectories
  if (existsSync(profilesDir)) {
    let entries;
    try {
      entries = readdirSync(profilesDir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const entryPath = join(profilesDir, entry);
      try {
        if (statSync(entryPath).isDirectory()) {
          const candidate = join(entryPath, `${name}.router.yaml`);
          if (existsSync(candidate)) return candidate;
        }
      } catch {
        // skip
      }
    }
  }

  return null;
}

/**
 * Resolve the target path for a new profile given options.
 * @param {string} name
 * @param {string} routerDir
 * @param {{ catalog?: string }} options
 * @returns {string}
 */
function resolveProfileTargetPath(name, routerDir, options = {}) {
  const catalog = options.catalog && options.catalog !== 'default'
    ? options.catalog
    : null;

  const profilesDir = catalog
    ? join(routerDir, 'profiles', catalog)
    : join(routerDir, 'profiles');

  return join(profilesDir, `${name}.router.yaml`);
}

/**
 * Create a new empty profile with a single orchestrator phase.
 * @param {string} name - Profile name
 * @param {string} routerDir - Path to router/ directory
 * @param {{ catalog?: string, target?: string }} options
 * @returns {{ presetName: string, path: string, catalog: string }}
 */
export function createProfile(name, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required and must be a non-empty string.');
  }

  const targetPath = resolveProfileTargetPath(name, routerDir, options);

  if (existsSync(targetPath)) {
    throw new Error(`Profile '${name}' already exists at ${targetPath}.`);
  }

  const target = options.target ?? 'anthropic/claude-sonnet';
  const catalog = options.catalog && options.catalog !== 'default'
    ? options.catalog
    : 'default';

  const profileContent = {
    name,
    phases: {
      orchestrator: [
        {
          target,
          role: 'primary',
          phase: 'orchestrator',
        },
      ],
    },
  };

  const profileDir = join(targetPath, '..');
  mkdirSync(profileDir, { recursive: true });

  const yaml = stringifyYaml(profileContent);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);

  return { presetName: name, path: targetPath, catalog };
}

/**
 * Delete a profile file by name.
 * @param {string} name - Profile name
 * @param {string} routerDir - Path to router/ directory
 * @param {{ catalog?: string }} options
 * @returns {{ presetName: string, path: string, deleted: true }}
 */
export function deleteProfile(name, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required and must be a non-empty string.');
  }

  const profilePath = findProfilePath(name, routerDir, options.catalog);

  if (!profilePath) {
    throw new Error(`Profile '${name}' not found.`);
  }

  unlinkSync(profilePath);

  return { presetName: name, path: profilePath, deleted: true };
}

/**
 * Rename a profile (file + name field).
 * @param {string} oldName
 * @param {string} newName
 * @param {string} routerDir
 * @param {{ catalog?: string }} options
 * @returns {{ oldName: string, newName: string, path: string }}
 */
export function renameProfile(oldName, newName, routerDir, options = {}) {
  if (!oldName || typeof oldName !== 'string' || !oldName.trim()) {
    throw new Error('Old profile name is required and must be a non-empty string.');
  }
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    throw new Error('New profile name is required and must be a non-empty string.');
  }

  const oldPath = findProfilePath(oldName, routerDir, options.catalog);
  if (!oldPath) {
    throw new Error(`Profile '${oldName}' not found.`);
  }

  // Determine the catalog from the old path to place the new file in the same catalog
  const profilesDir = join(routerDir, 'profiles');
  const relativePath = oldPath.slice(profilesDir.length + 1); // e.g. "oldName.router.yaml" or "catalog/oldName.router.yaml"
  const parts = relativePath.split('/');
  const inferredCatalog = parts.length > 1 ? parts[0] : (options.catalog || null);
  const mergedOptions = inferredCatalog ? { ...options, catalog: inferredCatalog } : options;

  const newPath = resolveProfileTargetPath(newName, routerDir, mergedOptions);
  if (existsSync(newPath)) {
    throw new Error(`Profile '${newName}' already exists at ${newPath}.`);
  }

  const rawYaml = readFileSync(oldPath, 'utf8');
  const parsed = parseYaml(rawYaml);
  parsed.name = newName;

  const newDir = join(newPath, '..');
  mkdirSync(newDir, { recursive: true });

  const newYaml = stringifyYaml(parsed);
  const tempPath = `${newPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, newYaml, 'utf8');
  renameSync(tempPath, newPath);
  unlinkSync(oldPath);

  return { oldName, newName, path: newPath };
}

/**
 * Copy/clone a profile.
 * @param {string} sourceName
 * @param {string} destName
 * @param {string} routerDir
 * @param {{ catalog?: string }} options
 * @returns {{ sourceName: string, destName: string, path: string }}
 */
export function copyProfile(sourceName, destName, routerDir, options = {}) {
  if (!sourceName || typeof sourceName !== 'string' || !sourceName.trim()) {
    throw new Error('Source profile name is required and must be a non-empty string.');
  }
  if (!destName || typeof destName !== 'string' || !destName.trim()) {
    throw new Error('Destination profile name is required and must be a non-empty string.');
  }

  const sourcePath = findProfilePath(sourceName, routerDir, options.catalog);
  if (!sourcePath) {
    throw new Error(`Profile '${sourceName}' not found.`);
  }

  const destPath = resolveProfileTargetPath(destName, routerDir, options);
  if (existsSync(destPath)) {
    throw new Error(`Profile '${destName}' already exists at ${destPath}.`);
  }

  const rawYaml = readFileSync(sourcePath, 'utf8');
  const parsed = parseYaml(rawYaml);
  parsed.name = destName;

  const destDir = join(destPath, '..');
  mkdirSync(destDir, { recursive: true });

  const newYaml = stringifyYaml(parsed);
  const tempPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, newYaml, 'utf8');
  renameSync(tempPath, destPath);

  return { sourceName, destName, path: destPath };
}

/**
 * Update the phases of an existing profile.
 * Reads the existing file, replaces the phases section, preserves all other fields
 * (name, availability, complexity, permissions, hidden), validates, and writes atomically.
 *
 * @param {string} name - Profile name
 * @param {object} phases - Complete phases object to replace
 * @param {string} routerDir - Path to router/ directory
 * @param {{ catalog?: string }} options
 * @returns {{ presetName: string, path: string }}
 */
export function updateProfile(name, phases, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required and must be a non-empty string.');
  }
  if (!phases || typeof phases !== 'object') {
    throw new Error('Phases object is required.');
  }

  const profilePath = findProfilePath(name, routerDir, options.catalog);
  if (!profilePath) {
    throw new Error(`Profile '${name}' not found.`);
  }

  // Read existing profile
  const rawYaml = readFileSync(profilePath, 'utf8');
  const existing = parseYaml(rawYaml);

  // Replace phases, preserve everything else
  const updated = { ...existing, phases };

  // Validate before writing
  validateProfileFile(updated, profilePath);

  // Atomic write
  const yaml = stringifyYaml(updated);
  const tempPath = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, profilePath);

  return { presetName: name, path: profilePath };
}

// === CATALOG CRUD ===

/**
 * List all catalogs (directories under profiles/ + 'default' for flat files).
 * @param {string} routerDir
 * @returns {{ name: string, profileCount: number }[] }
 */
export function listCatalogs(routerDir) {
  const profilesDir = join(routerDir, 'profiles');
  const result = [];

  if (!existsSync(profilesDir)) {
    return [{ name: 'default', profileCount: 0 }];
  }

  // Count flat .router.yaml files for 'default' catalog
  let defaultCount = 0;
  let entries;
  try {
    entries = readdirSync(profilesDir);
  } catch {
    return [{ name: 'default', profileCount: 0 }];
  }

  const namedCatalogs = [];

  for (const entry of entries) {
    const entryPath = join(profilesDir, entry);
    try {
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        // Count profiles in this subdirectory
        let subEntries;
        try {
          subEntries = readdirSync(entryPath);
        } catch {
          subEntries = [];
        }
        const profileCount = subEntries.filter((f) => f.endsWith('.router.yaml')).length;
        namedCatalogs.push({ name: entry, profileCount });
      } else if (entry.endsWith('.router.yaml')) {
        defaultCount += 1;
      }
    } catch {
      // skip
    }
  }

  result.push({ name: 'default', profileCount: defaultCount });
  result.push(...namedCatalogs);

  return result;
}

/**
 * Create a new catalog directory.
 * @param {string} name
 * @param {string} routerDir
 * @returns {{ name: string, path: string }}
 */
export function createCatalog(name, routerDir) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Catalog name is required and must be a non-empty string.');
  }

  if (name === 'default') {
    throw new Error("Cannot create a catalog named 'default'. It is reserved for flat profiles.");
  }

  const catalogPath = join(routerDir, 'profiles', name);

  if (existsSync(catalogPath)) {
    throw new Error(`Catalog '${name}' already exists at ${catalogPath}.`);
  }

  mkdirSync(catalogPath, { recursive: true });

  // Register new catalog as disabled in router.yaml
  const configPath = join(routerDir, 'router.yaml');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8');
      const config = parseYaml(raw);
      if (!config.catalogs) config.catalogs = {};
      if (!config.catalogs[name]) {
        config.catalogs[name] = { enabled: false };
        const yaml = stringifyYaml(config);
        const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tempPath, yaml, 'utf8');
        renameSync(tempPath, configPath);
      }
    } catch {
      // Non-blocking: catalog dir is already created
    }
  }

  return { name, path: catalogPath };
}

/**
 * Delete an empty catalog directory. Throws if it contains profiles.
 * @param {string} name
 * @param {string} routerDir
 * @returns {{ name: string, path: string, deleted: true }}
 */
export function deleteCatalog(name, routerDir) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Catalog name is required and must be a non-empty string.');
  }

  if (name === 'default') {
    throw new Error("Cannot delete the 'default' catalog.");
  }

  const catalogPath = join(routerDir, 'profiles', name);

  if (!existsSync(catalogPath)) {
    throw new Error(`Catalog '${name}' not found at ${catalogPath}.`);
  }

  let entries;
  try {
    entries = readdirSync(catalogPath);
  } catch {
    entries = [];
  }

  const profileFiles = entries.filter((f) => f.endsWith('.router.yaml'));
  if (profileFiles.length > 0) {
    throw new Error(`Catalog '${name}' is not empty — contains ${profileFiles.length} profile(s). Remove them first.`);
  }

  rmdirSync(catalogPath);

  return { name, path: catalogPath, deleted: true };
}

// === CATALOG METADATA ===

/**
 * Get the display label for a catalog.
 * Returns "DisplayName (default)" for the default catalog,
 * or just the catalog name for others.
 * @param {string} catalogName
 * @param {object|null|undefined} catalogMeta
 * @returns {string}
 */
export function getCatalogDisplayName(catalogName, catalogMeta) {
  if (catalogName === 'default') {
    const displayName = catalogMeta?.displayName ?? 'SDD-Orchestrator';
    return `${displayName} (default)`;
  }
  return catalogMeta?.displayName ?? catalogName;
}

/**
 * Move a profile from one catalog to another.
 * @param {string} name - Profile name
 * @param {string} targetCatalog - Destination catalog name
 * @param {string} routerDir
 * @param {{ sourceCatalog?: string }} options
 * @returns {{ name: string, from: string, to: string, path: string }}
 */
export function moveProfile(name, targetCatalog, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required.');
  }
  if (!targetCatalog || typeof targetCatalog !== 'string' || !targetCatalog.trim()) {
    throw new Error('Target catalog name is required.');
  }

  const sourcePath = findProfilePath(name, routerDir, options.sourceCatalog);
  if (!sourcePath) {
    throw new Error(`Profile '${name}' not found.`);
  }

  // Determine source catalog from path
  const profilesDir = join(routerDir, 'profiles');
  const relativePath = sourcePath.slice(profilesDir.length + 1);
  const parts = relativePath.split('/');
  const sourceCatalog = parts.length > 1 ? parts[0] : 'default';

  if (sourceCatalog === targetCatalog) {
    throw new Error(`Profile '${name}' is already in catalog '${targetCatalog}'.`);
  }

  // Determine target path
  const destPath = targetCatalog === 'default'
    ? join(profilesDir, `${name}.router.yaml`)
    : join(profilesDir, targetCatalog, `${name}.router.yaml`);

  if (existsSync(destPath)) {
    throw new Error(`Profile '${name}' already exists in catalog '${targetCatalog}'.`);
  }

  // Ensure target directory exists
  const destDir = join(destPath, '..');
  mkdirSync(destDir, { recursive: true });

  // Move: rename if same filesystem, otherwise read+write+delete
  try {
    renameSync(sourcePath, destPath);
  } catch {
    // Cross-device move: copy then delete
    const content = readFileSync(sourcePath, 'utf8');
    const tempPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, destPath);
    unlinkSync(sourcePath);
  }

  return { name, from: sourceCatalog, to: targetCatalog, path: destPath };
}

/**
 * Enable or disable a catalog by updating router.yaml.
 * @param {string} catalogName
 * @param {boolean} enabled
 * @param {string} routerDir
 * @returns {{ name: string, enabled: boolean }}
 */
export function setCatalogEnabled(catalogName, enabled, routerDir) {
  const configPath = join(routerDir, 'router.yaml');
  if (!existsSync(configPath)) {
    throw new Error('No router.yaml found.');
  }

  const raw = readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);

  if (!config.catalogs) {
    config.catalogs = {};
  }
  if (!config.catalogs[catalogName]) {
    config.catalogs[catalogName] = {};
  }
  config.catalogs[catalogName].enabled = enabled;

  const yaml = stringifyYaml(config);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, configPath);

  return { name: catalogName, enabled };
}
