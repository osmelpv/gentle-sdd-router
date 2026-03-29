import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
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
