import { existsSync } from 'node:fs';

let cachedDetection = null;

/**
 * Detect if gentle-ai is installed by scanning PATH directories.
 * No process execution — reads filesystem only.
 * Caches result — only checks once per process.
 */
export function detectGentleAi() {
  if (cachedDetection !== null) return cachedDetection;
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
  cachedDetection = pathDirs.some((dir) => existsSync(`${dir}/gentle-ai`));
  return cachedDetection;
}

/**
 * Resolve the controller display label.
 * Priority: 1) config.controller override, 2) gentle-ai detection, 3) "host"
 */
export function resolveControllerLabel(config = null) {
  if (config?.controller) return config.controller;
  return detectGentleAi() ? 'Gentleman' : 'host';
}

/**
 * Resolve execution owners for provider-execution-contract.
 * Returns array like ['gentle-ai', 'agent-teams-lite'] or ['host'].
 */
export function resolveExecutionOwners(config = null) {
  if (detectGentleAi()) return ['gentle-ai', 'agent-teams-lite'];
  return ['host'];
}

/**
 * Resolve the persona for agent prompts.
 * Priority: 1) config.persona override (unless 'auto'), 2) gentle-ai detected, 3) "neutral"
 *
 * @param {object|null} config - Router config object (may have .persona field)
 * @returns {string} - 'gentleman' | 'neutral' | 'custom' or any explicit override
 */
export function resolvePersona(config = null) {
  if (config?.persona && config.persona !== 'auto') return config.persona;
  if (detectGentleAi()) return 'gentleman';
  return 'neutral';
}

/**
 * Reset the cached detection (for testing).
 */
export function resetControllerCache() {
  cachedDetection = null;
}
