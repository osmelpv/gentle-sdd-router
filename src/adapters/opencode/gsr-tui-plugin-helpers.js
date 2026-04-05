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
  const phases = [];
  let currentPhase = null;
  let inFallbacks = false;

  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();

    // "Phase: <name>" or "phase: <name>"
    const phaseMatch = line.match(/^\s*[Pp]hase\s*:\s*(.+)$/);
    if (phaseMatch) {
      if (currentPhase && currentPhase.fallbacks.length > 0) {
        phases.push(currentPhase);
      }
      currentPhase = { name: phaseMatch[1].trim(), primary: '', fallbacks: [] };
      inFallbacks = false;
      continue;
    }

    if (!currentPhase) continue;

    // "primary: <model>" or "1. primary: <model>"
    const primaryMatch = line.match(/primary\s*:\s*(.+)$/i);
    if (primaryMatch) {
      currentPhase.primary = primaryMatch[1].trim();
      inFallbacks = false;
      continue;
    }

    // "Fallbacks:" section header
    if (/fallbacks\s*:/i.test(line)) {
      inFallbacks = true;
      continue;
    }

    // Numbered fallback: "  1. <model>" or "    1. <model>"
    if (inFallbacks) {
      const fallbackMatch = line.match(/^\s+(\d+)\.\s+(.+)$/);
      if (fallbackMatch) {
        currentPhase.fallbacks.push(fallbackMatch[2].trim());
      }
    }
  }

  // Flush last phase
  if (currentPhase && currentPhase.fallbacks.length > 0) {
    phases.push(currentPhase);
  }

  return { phases };
}

/**
 * Read fallback data via `gsr fallback list`. Exported for testing.
 *
 * @param {string} [presetName] - optional preset (legacy compat — gsr uses active preset)
 * @returns {Promise<{ phases: Array<{ name: string, primary: string, fallbacks: string[] }> }>}
 */
export async function readGsrFallbackData(presetName) {
  const { execSync } = _require('child_process');
  const cmd = presetName
    ? `gsr fallback list ${presetName} 2>/dev/null`
    : 'gsr fallback list 2>/dev/null';
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
