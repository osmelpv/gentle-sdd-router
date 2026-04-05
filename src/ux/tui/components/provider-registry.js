import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../../core/router.js';
import { getProvidersForPlatforms } from '../platform-detector.js';
import { fetchConnectedProviders } from '../model-fetcher.js';

/**
 * Hardcoded known providers — used as fallback when no active profile
 * can be located or parsed.
 */
export const KNOWN_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'opencode',
  'opencode-go',
  'ollama',
  'groq',
  'cohere',
];

/**
 * Extract the provider prefix from a model target string.
 * e.g. "anthropic/claude-sonnet-4-6" → "anthropic"
 * Returns null if the target does not contain a slash.
 *
 * @param {string} target
 * @returns {string|null}
 */
function extractProvider(target) {
  if (!target || typeof target !== 'string') return null;
  const slashIdx = target.indexOf('/');
  if (slashIdx < 1) return null;
  return target.slice(0, slashIdx).trim() || null;
}

/**
 * Collect all provider names referenced in a profile's phases.
 * Scans both `target` fields and `fallbacks` strings on every lane.
 *
 * @param {object} profile  Parsed profile YAML object
 * @returns {string[]}      Unique sorted provider names
 */
function collectProvidersFromProfile(profile) {
  const providers = new Set();

  const phases = profile?.phases;
  if (!phases || typeof phases !== 'object') return [];

  for (const [, lanes] of Object.entries(phases)) {
    if (!Array.isArray(lanes)) continue;
    for (const lane of lanes) {
      // Direct target
      const t = extractProvider(lane?.target);
      if (t) providers.add(t);

      // Fallbacks — may be a CSV string or an array
      const fb = lane?.fallbacks;
      if (fb) {
        const models = typeof fb === 'string'
          ? fb.split(',').map(s => s.trim())
          : Array.isArray(fb)
            ? fb.map(item => (typeof item === 'string' ? item : item?.model || '')).filter(Boolean)
            : [];
        for (const model of models) {
          const p = extractProvider(model);
          if (p) providers.add(p);
        }
      }
    }
  }

  return [...providers].sort();
}

/**
 * Derive "connected providers" from the active preset profile in router.yaml.
 * Returns profile-derived providers (phases + platforms) or empty array.
 *
 * @param {string} [configPath]  Absolute path to router.yaml.
 * @returns {Promise<string[]>}  Unique sorted provider names, or [] if unresolvable.
 */
async function deriveProvidersFromProfile(configPath) {
  try {
    // Resolve the router.yaml path
    const routerYamlPath = configPath
      ? path.resolve(configPath)
      : path.join(process.cwd(), 'router', 'router.yaml');

    if (!fs.existsSync(routerYamlPath)) {
      return [];
    }

    const routerText = fs.readFileSync(routerYamlPath, 'utf8');
    const routerConfig = parseYaml(routerText);

    // ── Platform-derived providers (from settings.platforms) ──────────────────
    let platformProviders = [];
    const savedPlatforms = routerConfig?.settings?.platforms;
    if (Array.isArray(savedPlatforms) && savedPlatforms.length > 0) {
      platformProviders = getProvidersForPlatforms(savedPlatforms);
    }

    // ── Profile-derived providers (from active preset phases) ─────────────────
    const activePreset = routerConfig?.active_preset;
    if (!activePreset || typeof activePreset !== 'string') {
      return platformProviders;
    }

    // Look for the profile file: <routerDir>/profiles/<active_preset>.router.yaml
    const routerDir = path.dirname(routerYamlPath);
    const profilePath = path.join(routerDir, 'profiles', `${activePreset}.router.yaml`);

    if (!fs.existsSync(profilePath)) {
      return platformProviders;
    }

    const profileText = fs.readFileSync(profilePath, 'utf8');
    const profile = parseYaml(profileText);

    const profileProviders = collectProvidersFromProfile(profile);

    // Merge profile providers + platform providers, deduplicate and sort
    const merged = new Set([...profileProviders, ...platformProviders]);
    return [...merged].sort();
  } catch {
    return [];
  }
}

/**
 * Get connected providers using a 3-tier priority:
 *
 *   Tier 1 — OpenCode SDK (most accurate: knows what has API keys configured).
 *             Called via fetchConnectedProviders(); falls back gracefully if
 *             the SDK or server is unavailable.
 *
 *   Tier 2 — Profile-derived: providers extracted from the active preset's
 *             lane targets + fallbacks + settings.platforms in router.yaml.
 *
 *   Tier 3 — KNOWN_PROVIDERS constant: static fallback when both tiers above
 *             return nothing.
 *
 * Tiers 1 and 2 are merged (union, deduplicated) to maximise coverage.
 *
 * @param {string} [configPath]  Absolute path to router.yaml.
 *                               Defaults to <cwd>/router/router.yaml.
 * @returns {Promise<string[]>}  Unique sorted provider name strings.
 */
export async function getConnectedProviders(configPath) {
  // Tier 1: OpenCode SDK (most accurate — knows what has API keys)
  const sdkProviders = await fetchConnectedProviders();

  // Tier 2: Profile-derived (what's actually in use)
  const profileProviders = await deriveProvidersFromProfile(configPath);

  // Merge: union of both, deduplicated
  const merged = [...new Set([...sdkProviders, ...profileProviders])];

  // Tier 3: fallback to KNOWN_PROVIDERS if both are empty
  return merged.length > 0 ? merged.sort() : [...KNOWN_PROVIDERS];
}
