// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * gsr-tui-plugin.js
 * OpenCode TUI Plugin — native fallback dialogs for gsr
 *
 * peerDeps: @opencode-ai/plugin/tui, @opentui/solid, solid-js
 *
 * Deployed to ~/.config/opencode/plugins/gsr-plugin.tsx
 * OpenCode / Bun handles JSX natively.
 *
 * Pure helper functions live in gsr-tui-plugin-helpers.js (importable in Node.js tests).
 *
 * @module adapters/opencode/gsr-tui-plugin
 */

// Re-export pure helpers so external consumers (tests, deployer) can import them
// from this module. The helpers file has no JSX and is Node.js-safe.
export {
  parseGsrFallbackList,
  readGsrFallbackData,
  getAutoFallbackSetting,
  setAutoFallbackSetting,
} from './gsr-tui-plugin-helpers.js';

import { parseGsrFallbackList } from './gsr-tui-plugin-helpers.js';

// ── Main TUI Plugin ───────────────────────────────────────────────────────────

/**
 * tui — OpenCode TUI Plugin for gsr fallback management.
 *
 * OpenCode detects TUI plugins via `export default { id, tui }`.
 *
 * @param {object} api - OpenCode TUI Plugin API
 * @param {object} options - Plugin options
 */
const tui = async (api, options) => {

  // Read fallback config via CLI (uses require inside callback — Bun-safe)
  const readFallbackData = async () => {
    const { execSync } = require('child_process');
    try {
      const raw = execSync('gsr fallback list 2>/dev/null', { encoding: 'utf8' });
      return parseGsrFallbackList(raw);
    } catch {
      return { phases: [] };
    }
  };

  const getActivePreset = () => {
    const { execSync } = require('child_process');
    try {
      const raw = execSync('gsr status 2>/dev/null', { encoding: 'utf8' });
      // Format: "Preset      local-hybrid (9 phases)"
      const match = raw.match(/Preset\s+(\S+)/i);
      return match?.[1] || 'default';
    } catch {
      return 'default';
    }
  };

  const executePromote = async (phase, index) => {
    const { execSync } = require('child_process');
    const preset = getActivePreset();
    try {
      execSync(`gsr fallback promote ${preset} ${phase.name} ${index} 2>&1`, { encoding: 'utf8' });
      execSync('gsr sync 2>&1', { encoding: 'utf8' });
      api.ui.toast({
        title: 'Fallback promoted',
        message: `${phase.fallbacks[index - 1]} is now primary for ${phase.name}`,
        variant: 'success',
      });
    } catch (e) {
      api.ui.toast({
        title: 'Error',
        message: 'Could not promote fallback. Check gsr is in PATH.',
        variant: 'error',
      });
    }
  };

  const showFallbackSelector = (phase) => {
    // Step 2 — fallback selector, replaces step 1
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Promote fallback (${phase.name})`}
        options={phase.fallbacks.map((fb, i) => ({
          title: fb,
          value: i + 1,
          description: `→ becomes primary · ${phase.primary} → fallback #1`,
        }))}
        onSelect={async (opt) => {
          api.ui.dialog.clear();
          await executePromote(phase, opt.value);
        }}
        onCancel={() => showFallbackFlow()}
      />
    ));
  };

  const showFallbackFlow = async () => {
    const data = await readFallbackData();
    const phases = data.phases.filter(p => p.fallbacks.length > 0);

    if (phases.length === 0) {
      api.ui.toast({
        message: 'No fallbacks configured. Use: gsr fallback add <preset> <phase> <model>',
        variant: 'info',
      });
      return;
    }

    // Step 1 — phase selector
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Select phase to change"
        options={phases.map(p => ({
          title: p.name,
          value: p,
          description: `Primary: ${p.primary} · ${p.fallbacks.length} fallback(s)`,
        }))}
        onSelect={(opt) => showFallbackSelector(opt.value)}
        onCancel={() => api.ui.dialog.clear()}
      />
    ));
  };

  // 1. Register GSR — Manage fallbacks as a native TUI command
  api.command.register(() => [
    {
      title: 'GSR — Manage fallbacks',
      value: 'gsr-fallback',
      description: 'Promote a fallback model to primary via native dialog',
      category: 'GSR',
      slash: { name: 'gsr-fallback' },
      onSelect: () => showFallbackFlow(),
    },
  ]);

  // 2. Auto-detect model failure via events
  api.event.on('session.error', async (event) => {
    const autoFallback = api.kv.get('gsr.autoFallback', false);
    if (autoFallback) {
      // Silent promote: promote index 1 of first phase that has fallbacks
      const data = await readFallbackData();
      const phase = data.phases.find(p => p.fallbacks.length > 0);
      if (phase) await executePromote(phase, 1);
    } else {
      api.ui.toast({
        title: 'GSR: Model failed',
        message: 'Open GSR — Manage fallbacks to switch model',
        variant: 'warning',
      });
      showFallbackFlow();
    }
  });
};

/**
 * GsrPlugin — backward-compatible alias for the `tui` function.
 * Kept so existing tests that reference GsrPlugin still work.
 */
export const GsrPlugin = tui;

const plugin = { id: 'gentle-sdd-router', tui };
export default plugin;
