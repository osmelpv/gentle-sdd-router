/**
 * gsr-tui-plugin.js
 * OpenCode TUI Plugin — native fallback dialogs for gsr
 *
 * peerDeps: @opencode-ai/plugin, @opentui/core, @opentui/solid, solid-js
 *
 * Deployed as-is to ~/.config/opencode/plugins/gsr-plugin.js
 * OpenCode / Bun handles JSX natively.
 *
 * @module adapters/opencode/gsr-tui-plugin
 */

import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the active preset name from `gsr status` or router.yaml.
 * Tries `gsr status` first; falls back to reading router.yaml directly.
 *
 * @returns {Promise<string|null>}
 */
async function getActivePreset() {
  try {
    const { stdout } = await execAsync('gsr status', { timeout: 5000 });
    // Look for: "active_preset: <name>" or "preset: <name>"
    const match = stdout.match(/active[_\s]preset[:\s]+([^\s\n]+)/i);
    if (match) return match[1].trim();
  } catch {
    // gsr not in PATH or failed — fall through to file read
  }

  // Try to read router.yaml directly (CWD-relative)
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const yaml = readFileSync(join(process.cwd(), 'router', 'router.yaml'), 'utf8');
    const match = yaml.match(/active_preset\s*:\s*([^\s\n]+)/);
    if (match) return match[1].trim();
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Parse the text output of `gsr fallback list <preset>` into structured data.
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
 * @param {string} presetName
 * @returns {Promise<{ phases: Array<{ name: string, primary: string, fallbacks: Array<{ index: number, model: string }> }> }>}
 */
export async function readGsrFallbackData(presetName) {
  let output;
  try {
    const { stdout } = await execAsync(`gsr fallback list ${presetName}`, { timeout: 8000 });
    output = stdout;
  } catch (err) {
    throw new Error(`gsr fallback list failed: ${err.message}`);
  }

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
        currentPhase.fallbacks.push({
          index: parseInt(fallbackMatch[1], 10),
          model: fallbackMatch[2].trim(),
        });
      }
    }
  }

  // Flush last phase
  if (currentPhase && currentPhase.fallbacks.length > 0) {
    phases.push(currentPhase);
  }

  return { phases };
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

// ── UI Flows ─────────────────────────────────────────────────────────────────

/**
 * Two-step fallback management flow.
 *
 * Step 1 → Select a phase
 * Step 2 → Select a fallback to promote
 *
 * @param {object} api - OpenCode TUI plugin API
 * @param {string} [forcedPhase] - Skip step 1 and show this phase directly
 */
async function showFallbackFlow(api, forcedPhase) {
  let presetName;

  try {
    presetName = await getActivePreset();
    if (!presetName) {
      api.ui.toast({ message: '⚠ Could not detect active gsr preset. Is gsr installed?', variant: 'warning' });
      return;
    }
  } catch (err) {
    api.ui.toast({ message: `✗ gsr preset error: ${err.message}`, variant: 'error' });
    return;
  }

  // If a specific phase was forced (from auto-fallback detection), go straight to step 2
  if (forcedPhase) {
    await showFallbackStep2(api, presetName, forcedPhase);
    return;
  }

  // ── Step 1: Select phase ──────────────────────────────────────────────────
  let fallbackData;
  try {
    fallbackData = await readGsrFallbackData(presetName);
  } catch (err) {
    api.ui.toast({ message: `✗ ${err.message}`, variant: 'error' });
    return;
  }

  if (fallbackData.phases.length === 0) {
    api.ui.toast({ message: 'ℹ No phases with fallbacks found for this preset.', variant: 'info' });
    return;
  }

  const phaseOptions = fallbackData.phases.map(p => ({
    title: p.name,
    value: p.name,
    description: `Primary: ${p.primary} — ${p.fallbacks.length} fallback(s) available`,
    category: 'GSR',
  }));

  api.ui.DialogSelect({
    title: `GSR: Select phase to manage (${presetName})`,
    placeholder: 'Type to filter phases…',
    options: phaseOptions,
    onSelect: async (option) => {
      api.ui.dialog.replace(
        () => null, // Replaced below; SolidJS root is managed by OpenCode
        undefined
      );
      await showFallbackStep2(api, presetName, option.value);
    },
  });
}

/**
 * Step 2: Select which fallback to promote for a given phase.
 *
 * @param {object} api
 * @param {string} presetName
 * @param {string} phaseName
 */
async function showFallbackStep2(api, presetName, phaseName) {
  let fallbackData;
  try {
    fallbackData = await readGsrFallbackData(presetName);
  } catch (err) {
    api.ui.toast({ message: `✗ ${err.message}`, variant: 'error' });
    return;
  }

  const phase = fallbackData.phases.find(p => p.name === phaseName);
  if (!phase) {
    api.ui.toast({ message: `ℹ Phase "${phaseName}" has no fallbacks.`, variant: 'info' });
    return;
  }

  const fallbackOptions = phase.fallbacks.map(fb => ({
    title: fb.model,
    value: fb.index,
    description: `Promote → new primary. Current primary (${phase.primary}) moves to fallback chain.`,
    category: 'Fallbacks',
  }));

  api.ui.dialog.replace(
    () => null, // OpenCode handles the SolidJS root
    undefined
  );

  api.ui.DialogSelect({
    title: `Promote fallback for "${phaseName}"`,
    placeholder: 'Select fallback to promote to primary…',
    options: fallbackOptions,
    current: null,
    onSelect: async (option) => {
      try {
        await execAsync(
          `gsr fallback promote ${presetName} ${phaseName} ${option.value}`,
          { timeout: 10000 }
        );
        api.ui.toast({ message: `✓ Promoted ${option.title} to primary for ${phaseName}!`, variant: 'success' });
        api.ui.dialog.clear();
      } catch (err) {
        api.ui.toast({ message: `✗ Promote failed: ${err.message}`, variant: 'error' });
        api.ui.dialog.clear();
      }
    },
  });
}

// ── GSR_FALLBACK_REQUEST detection ────────────────────────────────────────────

/**
 * Check if a message.updated event contains a GSR_FALLBACK_REQUEST block.
 * Returns the phase name if found, null otherwise.
 *
 * Expected format in message content:
 *   GSR_FALLBACK_REQUEST: phase=<phaseName>
 *
 * @param {object} event - message.updated event
 * @returns {string|null} phaseName or null
 */
function detectFallbackRequest(event) {
  const content = event?.message?.content ?? event?.content ?? '';
  if (typeof content !== 'string') return null;

  const match = content.match(/GSR_FALLBACK_REQUEST\s*:\s*phase=([^\s\n]+)/i);
  if (match) return match[1].trim();
  return null;
}

/**
 * Check if a session.error event represents a model quota/timeout failure.
 * Returns the phase name (if parseable) or a generic placeholder.
 *
 * @param {object} event
 * @returns {{ isModelError: boolean, phase: string|null }}
 */
function parseModelError(event) {
  const message = event?.error?.message ?? event?.message ?? '';
  const msgStr = typeof message === 'string' ? message : JSON.stringify(message);

  const isModelError = /quota|rate.?limit|timeout|429|model.*unavailable|overloaded/i.test(msgStr);

  // Try to extract phase from event metadata
  const phase = event?.agent?.id ?? event?.phase ?? event?.metadata?.phase ?? null;

  return { isModelError, phase };
}

// ── Main Plugin ───────────────────────────────────────────────────────────────

/**
 * GsrPlugin — OpenCode TUI Plugin for gsr fallback management.
 *
 * @param {object} api - OpenCode TUI Plugin API
 * @param {object} options - Plugin options
 * @param {object} meta - Plugin metadata
 */
export const GsrPlugin = async (api, options, meta) => {
  // 1. Register /gsr-fallback as a native TUI command
  api.command.register(() => [
    {
      title: 'GSR: Manage fallbacks',
      value: 'gsr-fallback',
      description: 'Promote a fallback model to primary for any phase',
      category: 'GSR',
      slash: { name: 'gsr-fallback' },
      onSelect: () => showFallbackFlow(api),
    },
  ]);

  // 2. Listen to session.error for model failures
  api.event.on('session.error', async (event) => {
    const { isModelError, phase } = parseModelError(event);
    if (!isModelError) return;

    const autoFallback = getAutoFallbackSetting(api);

    if (autoFallback) {
      // Silent auto-promote: use fallback index 1 for the detected phase
      const presetName = await getActivePreset();
      if (!presetName) {
        api.ui.toast({ message: '⚠ GSR auto-fallback: could not detect preset.', variant: 'warning' });
        return;
      }

      if (phase) {
        try {
          await execAsync(
            `gsr fallback promote ${presetName} ${phase} 1`,
            { timeout: 10000 }
          );
          api.ui.toast({
            message: `✓ GSR auto-promoted fallback for ${phase}.`,
            variant: 'success',
          });
        } catch (err) {
          api.ui.toast({
            message: `✗ GSR auto-fallback failed: ${err.message}`,
            variant: 'error',
          });
        }
      } else {
        api.ui.toast({
          message: '⚠ GSR: model error detected but phase unknown. Use /gsr-fallback to manage manually.',
          variant: 'warning',
        });
      }
    } else {
      // Show dialog for the detected phase (or full flow if phase unknown)
      await showFallbackFlow(api, phase ?? undefined);
    }
  });

  // 3. Listen to message.updated for GSR_FALLBACK_REQUEST blocks
  api.event.on('message.updated', async (event) => {
    const phase = detectFallbackRequest(event);
    if (!phase) return;

    const autoFallback = getAutoFallbackSetting(api);
    const presetName = await getActivePreset();

    if (!presetName) {
      api.ui.toast({ message: '⚠ GSR fallback request detected but no preset found.', variant: 'warning' });
      return;
    }

    if (autoFallback) {
      try {
        await execAsync(
          `gsr fallback promote ${presetName} ${phase} 1`,
          { timeout: 10000 }
        );
        api.ui.toast({
          message: `✓ GSR auto-promoted fallback for ${phase} (request detected).`,
          variant: 'success',
        });
      } catch (err) {
        api.ui.toast({
          message: `✗ GSR auto-fallback failed: ${err.message}`,
          variant: 'error',
        });
      }
    } else {
      await showFallbackFlow(api, phase);
    }
  });
};
