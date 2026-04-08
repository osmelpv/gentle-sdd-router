/**
 * gsr-tui-plugin-helpers.js
 * Pure helper functions for gsr-tui-plugin — no JSX, testable in Node.js.
 *
 * @module adapters/opencode/gsr-tui-plugin-helpers
 */

import { createRequire } from 'node:module';

// createRequire allows require() in ESM for test environments (Node.js).
// In Bun/OpenCode, require() is also always available globally.
const _require = (typeof require !== 'undefined') ? require : createRequire(import.meta.url);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the text output of `gsr fallback list` into structured data.
 *
 * Expected output format (per gsr CLI):
 *   Phase: orchestrator
 *     1. primary: anthropic/claude-opus-4-5
 *     Fallbacks:
 *       1. openai/gpt-4o
 *       2. google/gemini-2.0-flash
 *
 *   Phase: apply
 *     ...
 *
 * @param {string} output - raw text output from `gsr fallback list`
 * @returns {{ phases: Array<{ name: string, primary: string, fallbacks: string[] }> }}
 */
export function parseGsrFallbackList(output) {
  // Actual gsr fallback list format:
  //   orchestrator (lane 0):
  //     Primary: anthropic/claude-sonnet-4-6
  //     1. mistral/mistral-large-3
  //     2. opencode/qwen3.6-plus-free
  const phases = [];
  let currentPhase = null;

  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();

    // Phase header: "orchestrator (lane 0):" — no leading spaces
    const phaseMatch = line.match(/^(\S[^:]+)\s*\(lane\s*\d+\)\s*:$/);
    if (phaseMatch) {
      if (currentPhase && currentPhase.fallbacks.length > 0) phases.push(currentPhase);
      currentPhase = { name: phaseMatch[1].trim(), primary: '', fallbacks: [] };
      continue;
    }

    if (!currentPhase) continue;

    // Primary: "  Primary: <model>"
    const primaryMatch = line.match(/^\s+Primary\s*:\s*(.+)$/i);
    if (primaryMatch) { currentPhase.primary = primaryMatch[1].trim(); continue; }

    // Numbered fallback: "  1. <model>"
    const fallbackMatch = line.match(/^\s+(\d+)\.\s+(.+)$/);
    if (fallbackMatch) currentPhase.fallbacks.push(fallbackMatch[2].trim());
  }

  if (currentPhase && currentPhase.fallbacks.length > 0) phases.push(currentPhase);
  return { phases };
}

/**
 * Parse the active preset name from `gsr status` output.
 *
 * Supports two output formats:
 *   - getUnifiedStatus: "PRESET\n  Active          local-hybrid (9 phases, ...)"
 *   - getSimpleStatus:  "Preset      local-hybrid (9 phases)"
 *
 * @param {string} raw - output string from `gsr status`
 * @returns {string} preset name, or 'default' if not found
 */
export function getActivePreset(raw) {
  // getUnifiedStatus format: "  Active          local-hybrid (9 phases, ...)"
  const unifiedMatch = raw.match(/^\s+Active\s+(\S+)/m);
  if (unifiedMatch) return unifiedMatch[1];

  // getSimpleStatus fallback format: "Preset      local-hybrid (9 phases)"
  // Case-sensitive: the real format starts with capital "Preset" at line start.
  const simpleMatch = raw.match(/^Preset\s+(\S+)/m);
  if (simpleMatch) return simpleMatch[1];

  return 'default';
}

/**
 * Read fallback data via `gsr fallback list`. Exported for testing.
 *
 * Gets the active preset first via `gsr status`, then calls
 * `gsr fallback list <preset>` — the CLI requires a preset name.
 *
 * @param {string} [presetName] - explicit preset name (optional; auto-detected if omitted)
 * @returns {Promise<{ phases: Array<{ name: string, primary: string, fallbacks: string[] }> }>}
 */
export async function readGsrFallbackData(presetName) {
  const { execSync } = _require('child_process');

  let preset = presetName;
  if (!preset) {
    const statusRaw = execSync('gsr status 2>/dev/null', { encoding: 'utf8' });
    preset = getActivePreset(statusRaw);
  }

  const cmd = `gsr fallback list ${preset} 2>/dev/null`;
  const raw = execSync(cmd, { encoding: 'utf8' });
  return parseGsrFallbackList(raw);
}

// ── Auto-fallback helpers (exported for testing) ──────────────────────────────

/**
 * Read the auto-fallback setting from OpenCode KV store.
 *
 * @param {{ kv: { get: (key: string, defaultValue: any) => any } }} api
 * @returns {boolean}
 */
export function getAutoFallbackSetting(api) {
  return api.kv.get('gsr.autoFallback', false);
}

/**
 * Write the auto-fallback setting to OpenCode KV store.
 *
 * @param {{ kv: { set: (key: string, value: any) => void } }} api
 * @param {boolean} value
 */
export function setAutoFallbackSetting(api, value) {
  api.kv.set('gsr.autoFallback', value);
}
