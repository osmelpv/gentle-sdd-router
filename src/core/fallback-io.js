/**
 * fallback-io.js — Fallback chain I/O utilities for gsr fallback CLI commands.
 *
 * Provides read/write helpers to manage per-agent fallback chains stored in
 * *.router.yaml profile files (v4 multi-file format).
 *
 * Design decisions:
 * - Fallbacks are stored per-lane in the profile file as a CSV string or array.
 * - We keep the serialization simple: we always write back as CSV string for
 *   readability in the profile YAML. Structured objects (with `on:` field) are
 *   preserved when they already exist.
 * - All reads go through normalizeFallbacks() so the array form is canonical.
 * - Writes trigger unifiedSync by returning the configPath for the caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, stringifyYaml } from './router.js';
import { normalizeFallbacks } from './router-v4-io.js';

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const __pluginRoot = path.resolve(__moduleDir, '..', '..');
const __globalProfilesDir = path.join(__pluginRoot, 'router', 'profiles');

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Find the profile file for a given preset name in router/profiles/.
 * Scans all *.router.yaml files at root and one level of subdirectories.
 *
 * @param {string} routerDir - path to the router/ directory
 * @param {string} presetName - preset name to search for
 * @returns {{ filePath: string, content: object } | null}
 */
function findProfileFile(routerDir, presetName) {
  // Search project profiles first, then plugin global profiles.
  // This mirrors the lookup order in preset-io.js findProfilePath().
  const searchDirs = [path.join(routerDir, 'profiles')];

  // Add global profiles dir if different from project (avoids double-scan)
  if (__globalProfilesDir !== searchDirs[0] && fs.existsSync(__globalProfilesDir)) {
    searchDirs.push(__globalProfilesDir);
  }

  for (const profilesDir of searchDirs) {
    if (!fs.existsSync(profilesDir)) continue;

    const entries = fs.readdirSync(profilesDir);
    for (const entry of entries) {
      const entryPath = path.join(profilesDir, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        const subEntries = fs.readdirSync(entryPath);
        for (const sub of subEntries) {
          if (!sub.endsWith('.router.yaml')) continue;
          const filePath = path.join(entryPath, sub);
          const raw = fs.readFileSync(filePath, 'utf8');
          const content = parseYaml(raw);
          if (content.name === presetName) return { filePath, content };
        }
      } else if (entry.endsWith('.router.yaml')) {
        const filePath = entryPath;
        const raw = fs.readFileSync(filePath, 'utf8');
        const content = parseYaml(raw);
        if (content.name === presetName) return { filePath, content };
      }
    }
  }

  return null;
}

/**
 * Write a profile content object back to its file.
 * Uses a write-to-temp-then-rename strategy for safety.
 *
 * @param {string} filePath - full path to *.router.yaml
 * @param {object} content - profile content to serialize
 */
function writeProfileFile(filePath, content) {
  const yaml = stringifyYaml(content);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, yaml, 'utf8');
  fs.renameSync(tempPath, filePath);
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

/**
 * Detect phase schema format and return a normalized { primary, fallbacks } view.
 *
 * Supports both schemas:
 *   - Simplified (v5+): { model: string, fallbacks?: string[] }
 *   - Legacy lane array (v3/v4): [{ target, kind, role, fallbacks, ... }]
 *
 * @param {object|Array} phaseEntry - raw value from content.phases[phaseName]
 * @param {number} [laneIndex=0] - only used for lane array format
 * @returns {{ primary: string, fallbacks: string[], isSimplified: boolean } | null}
 */
function resolvePhaseEntry(phaseEntry, laneIndex = 0) {
  if (!phaseEntry) return null;

  // New simplified format: { model, fallbacks?: [] }
  if (!Array.isArray(phaseEntry) && typeof phaseEntry === 'object' && 'model' in phaseEntry) {
    const rawFallbacks = phaseEntry.fallbacks ?? [];
    // Normalize: handle string, array-of-strings, or array-with-CSV-items (from migration 001)
    let fallbacks;
    if (typeof rawFallbacks === 'string') {
      fallbacks = rawFallbacks.trim() ? rawFallbacks.split(',').map((f) => f.trim()).filter(Boolean) : [];
    } else if (Array.isArray(rawFallbacks)) {
      // Each item may itself be a CSV string (artifact of migration 001)
      fallbacks = rawFallbacks.flatMap((item) =>
        typeof item === 'string' && item.includes(',')
          ? item.split(',').map((f) => f.trim()).filter(Boolean)
          : [item].filter(Boolean)
      );
    } else {
      fallbacks = [];
    }
    return { primary: phaseEntry.model ?? '', fallbacks, isSimplified: true };
  }

  // Legacy lane array format: [{target, kind, role, fallbacks}]
  if (Array.isArray(phaseEntry)) {
    const lane = phaseEntry[laneIndex] ?? phaseEntry[0];
    if (!lane) return null;
    const normalized = normalizeFallbacks(lane.fallbacks ?? []);
    return {
      primary: lane.target ?? '',
      fallbacks: normalized.map((item) => item.model),
      isSimplified: false,
    };
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the normalized fallback chain for a specific lane.
 *
 * @param {string} configPath - path to router/router.yaml
 * @param {string} presetName - name of the preset (e.g. "premium")
 * @param {string} phaseName - phase name (e.g. "orchestrator")
 * @param {number} [laneIndex=0] - 0-based lane index
 * @returns {Array<string>} - ordered array of model IDs
 */
export function readLanePrimary(configPath, presetName, phaseName, laneIndex = 0) {
  const routerDir = path.dirname(configPath);
  const result = findProfileFile(routerDir, presetName);
  if (!result) return '';
  const phaseEntry = result.content.phases?.[phaseName];
  const resolved = resolvePhaseEntry(phaseEntry, laneIndex);
  return resolved?.primary ?? '';
}

export function readFallbackChain(configPath, presetName, phaseName, laneIndex = 0) {
  const routerDir = path.dirname(configPath);
  const result = findProfileFile(routerDir, presetName);
  if (!result) {
    throw new Error(`Preset '${presetName}' not found in ${path.join(routerDir, 'profiles')}.`);
  }

  const { content } = result;
  const phaseEntry = content.phases?.[phaseName];
  if (!phaseEntry) {
    throw new Error(`Phase '${phaseName}' not found in preset '${presetName}'.`);
  }

  const resolved = resolvePhaseEntry(phaseEntry, laneIndex);
  if (!resolved) {
    throw new Error(`Phase '${phaseName}' in preset '${presetName}' has unrecognized format.`);
  }
  return resolved.fallbacks;
}

/**
 * Write a new fallback chain for a specific lane, then trigger unifiedSync.
 *
 * @param {string} configPath - path to router/router.yaml
 * @param {string} presetName - preset name
 * @param {string} phaseName - phase name
 * @param {number} laneIndex - 0-based lane index
 * @param {string[]} newChain - ordered array of model IDs
 * @returns {Promise<void>}
 */
export async function writeFallbackChain(configPath, presetName, phaseName, laneIndex, newChain) {
  const routerDir = path.dirname(configPath);
  const result = findProfileFile(routerDir, presetName);
  if (!result) {
    throw new Error(`Preset '${presetName}' not found in ${path.join(routerDir, 'profiles')}.`);
  }

  const { filePath, content } = result;
  const phaseEntry = content.phases?.[phaseName];
  if (!phaseEntry) {
    throw new Error(`Phase '${phaseName}' not found in preset '${presetName}'.`);
  }

  const resolved = resolvePhaseEntry(phaseEntry, laneIndex);
  if (!resolved) {
    throw new Error(`Phase '${phaseName}' in preset '${presetName}' has unrecognized format.`);
  }

  let newPhaseEntry;
  if (resolved.isSimplified) {
    // Simplified format: update {model, fallbacks}
    newPhaseEntry = {
      ...phaseEntry,
      fallbacks: newChain.length > 0 ? newChain : [],
    };
  } else {
    // Legacy lane array: update the specific lane
    const lanes = phaseEntry;
    resolveLane(lanes, laneIndex, phaseName); // validate index
    newPhaseEntry = lanes.map((lane, idx) => {
      if (idx !== laneIndex) return lane;
      const updated = { ...lane };
      if (newChain.length === 0) {
        delete updated.fallbacks;
      } else {
        updated.fallbacks = newChain.join(', ');
      }
      return updated;
    });
  }

  const newContent = { ...content, phases: { ...content.phases, [phaseName]: newPhaseEntry } };
  writeProfileFile(filePath, newContent);

  // Trigger unifiedSync (non-blocking: warn but don't fail)
  try {
    const { unifiedSync } = await import('./unified-sync.js');
    await unifiedSync({ configPath });
  } catch (err) {
    process.stdout.write(`Note: sync after fallback change failed: ${err.message}\n`);
  }
}

/**
 * Resolve a lane object by index, throwing a clear error if out of bounds.
 *
 * @param {Array} lanes - array of lane objects
 * @param {number} laneIndex - 0-based index
 * @param {string} [phaseName] - phase name for error messages
 * @returns {object} lane object
 */
export function resolveLane(lanes, laneIndex, phaseName = 'unknown') {
  if (!Array.isArray(lanes) || lanes.length === 0) {
    throw new Error(`Phase '${phaseName}' has no lanes.`);
  }
  if (laneIndex < 0 || laneIndex >= lanes.length) {
    throw new Error(
      `Lane index ${laneIndex} is out of bounds for phase '${phaseName}' (${lanes.length} lane(s) available, 0-based).`
    );
  }
  return lanes[laneIndex];
}

/**
 * Format a fallback chain as a numbered list string for console output.
 *
 * @param {string[]} chain - ordered array of model IDs
 * @returns {string}
 */
export function formatFallbackList(chain) {
  if (chain.length === 0) return '  (none)';
  return chain.map((model, idx) => `  ${idx + 1}. ${model}`).join('\n');
}

/**
 * Validate a model ID format: must be "provider/model".
 * Returns an error string if invalid, null if valid.
 *
 * @param {string} modelId
 * @returns {string|null}
 */
export function validateModelId(modelId) {
  if (!modelId || typeof modelId !== 'string' || !modelId.includes('/')) {
    return `Model ID "${modelId}" must be in "provider/model" format (e.g. "openai/gpt-5").`;
  }
  return null;
}

/**
 * Get all phase names defined in a preset.
 *
 * @param {string} configPath
 * @param {string} presetName
 * @returns {string[]}
 */
export function getPresetPhases(configPath, presetName) {
  const routerDir = path.dirname(configPath);
  const result = findProfileFile(routerDir, presetName);
  if (!result) {
    throw new Error(`Preset '${presetName}' not found.`);
  }
  return Object.keys(result.content.phases || {});
}

/**
 * Promotes fallback at fallbackIndex (1-based) to primary model.
 * Old primary moves to position 0 of fallback chain.
 * Chain order: [oldPrimary, ...others] where others = original chain minus promoted.
 *
 * Example:
 *   Before: target=A, fallbacks=[B, C, D]
 *   promote(2) → target=C, fallbacks=[A, B, D]
 *
 * @param {string} configPath - path to router/router.yaml
 * @param {string} presetName - name of the preset (e.g. "local-hybrid")
 * @param {string} phaseName - phase name (e.g. "orchestrator")
 * @param {number} laneIndex - 0-based lane index
 * @param {number} fallbackIndex - 1-based index of fallback to promote
 * @returns {Promise<{ promoted: string, demoted: string, newFallbacks: string[] }>}
 */
export async function promoteFallback(configPath, presetName, phaseName, laneIndex, fallbackIndex) {
  // 1. Read profile file for the preset
  const routerDir = path.dirname(configPath);
  const result = findProfileFile(routerDir, presetName);
  if (!result) {
    throw new Error(`Preset '${presetName}' not found in ${path.join(routerDir, 'profiles')}.`);
  }

  const { filePath, content } = result;

  // 2. Find the phase entry (supports both simplified and lane array format)
  const phaseEntry = content.phases?.[phaseName];
  if (!phaseEntry) {
    throw new Error(`Phase '${phaseName}' not found in preset '${presetName}'.`);
  }

  const resolved = resolvePhaseEntry(phaseEntry, laneIndex);
  if (!resolved) {
    throw new Error(`Phase '${phaseName}' in preset '${presetName}' has unrecognized format.`);
  }

  // 3. Get current primary + fallbacks array (model strings)
  const currentTarget = resolved.primary;
  if (!currentTarget) {
    throw new Error(`Phase '${phaseName}' has no primary model defined.`);
  }

  const fallbacks = resolved.fallbacks;

  // 4. Validate fallbackIndex is in range (1-based)
  if (fallbacks.length === 0) {
    throw new Error(`Phase '${phaseName}' (lane ${laneIndex}) has no fallbacks to promote.`);
  }
  if (!Number.isFinite(fallbackIndex) || fallbackIndex < 1 || fallbackIndex > fallbacks.length) {
    throw new Error(
      `Fallback index ${fallbackIndex} is out of range for phase '${phaseName}' ` +
      `(${fallbacks.length} fallback(s) available, 1-based).`
    );
  }

  // 5. selectedModel = fallbacks[fallbackIndex - 1]
  const selectedModel = fallbacks[fallbackIndex - 1];

  // 6. newFallbacks = [currentTarget, ...fallbacks.filter((_, i) => i !== fallbackIndex - 1)]
  const newFallbacks = [currentTarget, ...fallbacks.filter((_, i) => i !== fallbackIndex - 1)];

  // 7. Write back
  let newPhaseEntry;
  if (resolved.isSimplified) {
    // Simplified format: update model + fallbacks
    newPhaseEntry = { ...phaseEntry, model: selectedModel, fallbacks: newFallbacks };
  } else {
    // Legacy lane array: update the specific lane
    const lanes = phaseEntry;
    newPhaseEntry = lanes.map((l, idx) => {
      if (idx !== laneIndex) return l;
      const updated = { ...l };
      updated.target = selectedModel;
      updated.fallbacks = newFallbacks.join(', ');
      return updated;
    });
  }

  const newContent = { ...content, phases: { ...content.phases, [phaseName]: newPhaseEntry } };

  // 8. Save profile file
  writeProfileFile(filePath, newContent);

  // 9. Call unifiedSync({ configPath })
  try {
    const { unifiedSync } = await import('./unified-sync.js');
    await unifiedSync({ configPath });
  } catch (err) {
    process.stdout.write(`Note: sync after fallback promote failed: ${err.message}\n`);
  }

  // 10. Return { promoted: selectedModel, demoted: currentTarget, newFallbacks }
  return { promoted: selectedModel, demoted: currentTarget, newFallbacks };
}
