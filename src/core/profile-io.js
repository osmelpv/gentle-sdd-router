import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { get } from 'node:https';
import { parseYaml, stringifyYaml } from './router.js';
import { validateProfileFile, loadV4Profiles } from './router-v4-io.js';
import { appendTuiDebug } from '../debug/tui-debug-log.js';

const COMPACT_PREFIX = 'gsr://';
const URL_TIMEOUT_MS = 10000;
const URL_SIZE_LIMIT = 1024 * 1024; // 1MB

// === EXPORT ===

/**
 * Export a single profile as raw YAML string.
 * Reconstructs the standalone profile file content from the assembled config.
 * @param {object} config - assembled v4 config with _v4Source
 * @param {string} profileName - name of the profile to export
 * @returns {string} YAML string
 */
export function exportProfile(config, profileName) {
  const profileContent = findPresetContent(config, profileName);
  if (!profileContent) throw new Error(`Preset '${profileName}' not found`);

  return stringifyYaml(profileContent);
}

/**
 * @deprecated Use exportProfile instead.
 */
export function exportPreset(config, profileName) {
  return exportProfile(config, profileName);
}

/**
 * Export a single profile as a gsr:// compact string.
 * @param {object} config - assembled v4 config with _v4Source
 * @param {string} profileName - name of the profile to export
 * @returns {string} compact string
 */
export function exportProfileCompact(config, profileName) {
  const yaml = exportProfile(config, profileName);
  return encodeCompactString(yaml);
}

/**
 * @deprecated Use exportProfileCompact instead.
 */
export function exportPresetCompact(config, profileName) {
  return exportProfileCompact(config, profileName);
}

/**
 * Export all profiles as a Map<profileName, yamlString>.
 * @param {object} config - assembled v4 config
 * @returns {Map<string, string>}
 */
export function exportAllProfiles(config) {
  const result = new Map();
  const sdds = config.catalogs || {};

  for (const sdd of Object.values(sdds)) {
    const profiles = sdd.presets || {};
    for (const [name, profile] of Object.entries(profiles)) {
      const profileContent = { name, ...profile };
      // Remove internal fields that shouldn't be exported
      delete profileContent._normalized;
      result.set(name, stringifyYaml(profileContent));
    }
  }

  return result;
}

/**
 * @deprecated Use exportAllProfiles instead.
 */
export function exportAllPresets(config) {
  return exportAllProfiles(config);
}

// === IMPORT ===

/**
 * Import a profile from a raw YAML string.
 * @param {string} yamlString
 * @param {string} routerDir - path to the router directory (contains profiles/)
 * @param {object} options - { catalog?: string, force?: boolean }
 * @returns {{ presetName: string, path: string, catalog: string }}
 */
export function importProfileFromYaml(yamlString, routerDir, options = {}) {
  const parsed = parseYaml(yamlString);
  validateProfileFile(parsed, '<import>');

  const profileName = parsed.name;
  if (!profileName) throw new Error('Profile must have a name field');

  const catalog = options.catalog && options.catalog !== 'default'
    ? options.catalog
    : 'default';

  const profilesDir = catalog !== 'default'
    ? join(routerDir, 'profiles', catalog)
    : join(routerDir, 'profiles');

  const targetPath = join(profilesDir, `${profileName}.router.yaml`);

  if (existsSync(targetPath) && !options.force) {
    throw new Error(`Preset '${profileName}' already exists at ${targetPath}. Use --force to overwrite.`);
  }

  mkdirSync(profilesDir, { recursive: true });
  const yaml = stringifyYaml(parsed);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);

  return { presetName: profileName, path: targetPath, catalog };
}

/**
 * @deprecated Use importProfileFromYaml instead.
 */
export function importPresetFromYaml(yamlString, routerDir, options = {}) {
  return importProfileFromYaml(yamlString, routerDir, options);
}

/**
 * Import a profile from a gsr:// compact string.
 * @param {string} compactString
 * @param {string} routerDir
 * @param {object} options
 * @returns {{ presetName: string, path: string, catalog: string }}
 */
export function importProfileFromCompact(compactString, routerDir, options = {}) {
  const yaml = decodeCompactString(compactString);
  return importProfileFromYaml(yaml, routerDir, options);
}

/**
 * @deprecated Use importProfileFromCompact instead.
 */
export function importPresetFromCompact(compactString, routerDir, options = {}) {
  return importProfileFromCompact(compactString, routerDir, options);
}

/**
 * Import a profile from an HTTPS URL.
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
          const result = importProfileFromYaml(yaml, routerDir, options);
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
 * Find a profile by name in the assembled config and return its full profile content.
 * @param {object} config
 * @param {string} profileName - name of the profile to find
 * @returns {object|null} profile content with name field included
 */
function findPresetContent(config, profileName) {
  const sdds = config.catalogs || {};

  for (const sdd of Object.values(sdds)) {
    const profiles = sdd.presets || {};
    if (profiles[profileName]) {
      const profileContent = { name: profileName, ...profiles[profileName] };
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
 * Check if a profile name already exists in the profiles directory.
 * Scans all *.router.yaml files (flat and subdirectories) for any with name: {name}.
 * @param {string} name
 * @param {string} routerDir
 * @returns {boolean}
 */
export function profileNameExists(name, routerDir) {
  const profilesDir = join(routerDir, 'profiles');
  if (!existsSync(profilesDir)) return false;

  let entries;
  try {
    entries = readdirSync(profilesDir);
  } catch {
    return false;
  }

  for (const file of entries) {
    const filePath = join(profilesDir, file);
    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        // Check subdirectory
        let subEntries;
        try {
          subEntries = readdirSync(filePath);
        } catch {
          continue;
        }
        for (const subFile of subEntries) {
          if (!subFile.endsWith('.router.yaml')) continue;
          try {
            const raw = readFileSync(join(filePath, subFile), 'utf8');
            const content = parseYaml(raw);
            if (content.name === name) return true;
          } catch {
            // skip malformed files
          }
        }
      } else if (file.endsWith('.router.yaml')) {
        try {
          const raw = readFileSync(filePath, 'utf8');
          const content = parseYaml(raw);
          if (content.name === name) return true;
        } catch {
          // skip malformed files
        }
      }
    } catch {
      // skip
    }
  }

  return false;
}

/**
 * Find the file path for a profile by name.
 * If catalog is provided (and not 'default'), searches only that catalog subdirectory.
 * Otherwise, searches the project profiles directory first, then the plugin global profiles directory.
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

  // Search project profiles first
  const flat = join(profilesDir, `${name}.router.yaml`);
  if (existsSync(flat)) return flat;

  // Search project subdirectories
  if (existsSync(profilesDir)) {
    let entries;
    try {
      entries = readdirSync(profilesDir);
    } catch {
      // continue to global search
    }
    if (entries) {
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
  }

  // Search plugin global profiles (built-in presets like sdd-debug-mono)
  const __pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const globalProfilesDir = join(__pluginDir, 'router', 'profiles');
  if (globalProfilesDir !== profilesDir && existsSync(globalProfilesDir)) {
    const globalFlat = join(globalProfilesDir, `${name}.router.yaml`);
    if (existsSync(globalFlat)) return globalFlat;

    let globalEntries;
    try {
      globalEntries = readdirSync(globalProfilesDir);
    } catch {
      return null;
    }
    for (const entry of globalEntries) {
      const entryPath = join(globalProfilesDir, entry);
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
 * Create a new empty profile with a single orchestrator phase (simplified schema).
 * @param {string} name - Profile name
 * @param {string} routerDir - Path to router/ directory
 * @param {{ catalog?: string, target?: string, sdd?: string }} options
 * @returns {{ profileName: string, presetName: string, path: string }}
 */
export function createProfile(name, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required and must be a non-empty string.');
  }

  if (profileNameExists(name, routerDir)) {
    throw new Error(`Profile '${name}' already exists.`);
  }

  const targetPath = resolveProfileTargetPath(name, routerDir, options);

  if (existsSync(targetPath)) {
    throw new Error(`Profile '${name}' already exists at ${targetPath}.`);
  }

  const target = options.target ?? 'anthropic/claude-sonnet';

  const profileContent = {
    name,
    sdd: options.sdd ?? 'agent-orchestrator',
    visible: false,
    builtin: false,
    phases: {
      orchestrator: {
        model: target,
        fallbacks: [],
      },
    },
  };

  const profileDir = join(targetPath, '..');
  mkdirSync(profileDir, { recursive: true });

  const yaml = stringifyYaml(profileContent);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);

  return { profileName: name, presetName: name, path: targetPath };
}

/**
 * Duplicate a gentle-ai profile entry as a local profile.
 * Creates a new local profile with all standard phases pre-filled from the gentle-ai entry's model.
 *
 * @param {{ name: string, model: string|null, isGentleAi: true }} gentleAiEntry - Source gentle-ai profile
 * @param {string} newName - Name for the new local profile (e.g. 'gsr-my-copy')
 * @param {string} routerDir - Path to router/ directory
 * @returns {{ profileName: string, path: string }}
 */
export function duplicateFromGentleAi(gentleAiEntry, newName, routerDir) {
  if (profileNameExists(newName, routerDir)) {
    throw new Error(`Profile '${newName}' already exists.`);
  }

  const STANDARD_PHASES = ['orchestrator', 'explore', 'propose', 'spec', 'design', 'tasks', 'apply', 'verify', 'archive'];
  const defaultModel = gentleAiEntry.model ?? 'anthropic/claude-sonnet';

  const phases = {};
  for (const phase of STANDARD_PHASES) {
    phases[phase] = { model: defaultModel, fallbacks: [] };
  }

  const content = {
    name: newName,
    sdd: 'agent-orchestrator',
    visible: false,
    builtin: false,
    source: `gentle-ai:${gentleAiEntry.name}`,
    phases,
  };

  const targetPath = join(routerDir, 'profiles', `${newName}.router.yaml`);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  const yaml = stringifyYaml(content);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);

  return { profileName: newName, path: targetPath };
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

/**
 * Update profile metadata fields (hidden, identity, etc.) without changing phases.
 * @param {string} name - Profile name
 * @param {object} updates - Object with fields to update (e.g., { hidden: true })
 * @param {string} routerDir - Path to router/ directory
 * @param {{ catalog?: string }} options
 * @returns {{ presetName: string, path: string }}
 */
export function updatePresetMetadata(name, updates, routerDir, options = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Profile name is required and must be a non-empty string.');
  }
  if (!updates || typeof updates !== 'object') {
    throw new Error('Updates object is required.');
  }

  const profilePath = findProfilePath(name, routerDir, options.catalog);
  if (!profilePath) {
    appendTuiDebug('update_preset_metadata_missing', { name, updates, routerDir, options });
    throw new Error(`Preset '${name}' not found.`);
  }

  const rawYaml = readFileSync(profilePath, 'utf8');
  const existing = parseYaml(rawYaml);
  appendTuiDebug('update_preset_metadata_read', {
    name,
    routerDir,
    options,
    profilePath,
    existingHidden: existing?.hidden,
    updates,
  });

  // Apply updates, preserving name and phases
  const updated = { ...existing, ...updates };
  // Ensure name is preserved
  updated.name = existing.name;

  validateProfileFile(updated, profilePath);

  const yaml = stringifyYaml(updated);
  const tempPath = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, profilePath);

  const writtenYaml = readFileSync(profilePath, 'utf8');
  const written = parseYaml(writtenYaml);
  appendTuiDebug('update_preset_metadata_written', {
    name,
    profilePath,
    writtenHidden: written?.hidden,
  });

  return { presetName: name, path: profilePath };
}

// === SDD GROUP CRUD ===

/**
 * List all SDD groups (directories under profiles/ + 'default' for flat files).
 * @param {string} routerDir
 * @returns {{ name: string, profileCount: number }[] }
 */
export function listCatalogs(routerDir) {
  const profilesDir = join(routerDir, 'profiles');
  const result = [];

  if (!existsSync(profilesDir)) {
    return [{ name: 'default', profileCount: 0 }];
  }

  // Count flat .router.yaml files for 'default' SDD group
  let defaultCount = 0;
  let entries;
  try {
    entries = readdirSync(profilesDir);
  } catch {
    return [{ name: 'default', profileCount: 0 }];
  }

  const namedSdds = [];

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
        namedSdds.push({ name: entry, profileCount });
      } else if (entry.endsWith('.router.yaml')) {
        defaultCount += 1;
      }
    } catch {
      // skip
    }
  }

  result.push({ name: 'default', profileCount: defaultCount });
  result.push(...namedSdds);

  return result;
}

/**
 * Create a new SDD group directory.
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

  const sddPath = join(routerDir, 'profiles', name);

  if (existsSync(sddPath)) {
    throw new Error(`Catalog '${name}' already exists at ${sddPath}.`);
  }

  mkdirSync(sddPath, { recursive: true });

  // Register new SDD group as disabled in router.yaml
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
      // Non-blocking: SDD group dir is already created
    }
  }

  return { name, path: sddPath };
}

/**
 * Delete an empty SDD group directory. Throws if it contains profiles.
 * @param {string} name
 * @param {string} routerDir
 * @returns {{ name: string, path: string, deleted: true }}
 */
export function deleteSdd(name, routerDir) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Catalog name is required and must be a non-empty string.');
  }

  if (name === 'default') {
    throw new Error("Cannot delete the 'default' catalog.");
  }

  const sddPath = join(routerDir, 'profiles', name);

  if (!existsSync(sddPath)) {
    throw new Error(`Catalog '${name}' not found at ${sddPath}.`);
  }

  let entries;
  try {
    entries = readdirSync(sddPath);
  } catch {
    entries = [];
  }

  const profileFiles = entries.filter((f) => f.endsWith('.router.yaml'));
  if (profileFiles.length > 0) {
    throw new Error(`Catalog '${name}' is not empty — contains ${profileFiles.length} profile(s). Remove them first.`);
  }

  rmdirSync(sddPath);

  return { name, path: sddPath, deleted: true };
}

/**
 * @deprecated Use deleteSdd instead.
 */
export const deleteCatalog = deleteSdd;

// === SDD GROUP METADATA ===

/**
 * Get the display label for an SDD group.
 * Returns "DisplayName (default)" for the default SDD group,
 * or just the SDD name for others.
 * @param {string} sddName - SDD group name
 * @param {object|null|undefined} sddMeta
 * @returns {string}
 */
export function getSddDisplayName(sddName, sddMeta) {
  if (sddName === 'default') {
    const displayName = sddMeta?.displayName ?? 'SDD-Orchestrator';
    return `${displayName} (default)`;
  }
  return sddMeta?.displayName ?? sddName;
}

/**
 * @deprecated Use getSddDisplayName instead.
 */
export const getCatalogDisplayName = getSddDisplayName;

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
 * Enable or disable an SDD group by updating router.yaml.
 * @param {string} sddName - SDD group name
 * @param {boolean} enabled
 * @param {string} routerDir
 * @returns {{ name: string, enabled: boolean }}
 */
export function setSddEnabled(sddName, enabled, routerDir) {
  const configPath = join(routerDir, 'router.yaml');
  if (!existsSync(configPath)) {
    throw new Error('No router.yaml found.');
  }

  const raw = readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);

  if (!config.catalogs) {
    config.catalogs = {};
  }
  if (!config.catalogs[sddName]) {
    config.catalogs[sddName] = {};
  }
  config.catalogs[sddName].enabled = enabled;

  const yaml = stringifyYaml(config);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, configPath);

  return { name: sddName, enabled };
}

/**
 * @deprecated Use setSddEnabled instead.
 */
export const setCatalogEnabled = setSddEnabled;

// === PROFILE LOADER (canonical name) ===

/**
 * Load profiles — canonical name for loadV4Profiles.
 * This is the primary export for the profile-io module.
 * @type {typeof import('./router-v4-io.js').loadV4Profiles}
 */
export const loadProfiles = loadV4Profiles;

/**
 * @deprecated Use loadProfiles instead.
 * Deprecated re-export maintained for backward compatibility.
 * Will be removed in a future major version.
 */
export const loadPresets = loadProfiles;

// === GENTLE-AI PROFILE DETECTION ===

/**
 * Detect gentle-ai profiles from an opencode.json file.
 *
 * Scans the agents object for keys matching `sdd-orchestrator` or `sdd-orchestrator-*`
 * (no `gsr-` prefix). Returns an array of read-only profile descriptors.
 *
 * @param {string} [openCodeJsonPath] - Path to opencode.json. Defaults to ~/.config/opencode/opencode.json.
 * @returns {Promise<Array<{ name: string, model: string|null, isGentleAi: true }>>}
 */
export async function detectGentleAiProfiles(openCodeJsonPath) {
  const { readFileSync: readFile, existsSync: existsFile } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const { homedir } = await import('node:os');

  const resolvedPath = openCodeJsonPath
    ?? joinPath(homedir(), '.config', 'opencode', 'opencode.json');

  if (!existsFile(resolvedPath)) {
    return [];
  }

  let parsed;
  try {
    const raw = readFile(resolvedPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // Support both 'agents' (gsr overlay format) and 'agent' (opencode native format)
  const agents = parsed?.agents ?? parsed?.agent ?? {};
  if (typeof agents !== 'object' || agents === null) {
    return [];
  }

  const SDD_ORCHESTRATOR_RE = /^sdd-orchestrator(-.*)?$/;

  const results = [];
  for (const [key, agentDef] of Object.entries(agents)) {
    if (SDD_ORCHESTRATOR_RE.test(key)) {
      const model = agentDef?.model ?? null;
      results.push({ name: key, model, isGentleAi: true });
    }
  }

  return results;
}
