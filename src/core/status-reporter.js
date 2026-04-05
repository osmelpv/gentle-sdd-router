/**
 * Status Reporter
 *
 * Builds human-friendly status output strings for `gsr status` and
 * `gsr status --verbose`.
 *
 * Two modes:
 *   - Simple (default):  clean aligned text, no box drawing, preset/SDD/debug summary
 *   - Verbose:           full sections — CONFIGURATION, PRESET, ROUTES, SDDS, PRESETS, SDD CONNECTIONS
 *
 * All output is string-based: no React/Ink, no internal terms leaked.
 *
 * @module status-reporter
 */

// ── STATUS_LEVELS (kept for TUI compat) ───────────────────────────────────────

/**
 * Status level definitions used by the TUI home screen indicator.
 * @type {Record<string, { emoji: string, message: string }>}
 */
export const STATUS_LEVELS = {
  error: { emoji: '❌', message: 'Something went wrong. Check your configuration and try again.' },
  configured: { emoji: '✅', message: 'Configured. Run `gsr sync` to activate.' },
  synchronized: { emoji: '🔄', message: 'Synchronized. Your routing is active.' },
  visible: { emoji: '👁️', message: 'Visible in host. Agents are available.' },
  ready: { emoji: '✅', message: 'Ready to use.' },
  requires_reopen: { emoji: '⚠️', message: 'Synchronized. Reopen your editor to activate the new agents.' },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Get the active preset config object from the assembled config.
 * Supports both v3/v4 (catalogs-based) and legacy v1/v2 (profiles-based) configs.
 * @param {object} config
 * @returns {object|null} preset config or null
 */
function getActivePreset(config) {
  // v3/v4: catalogs-based
  if (config?.catalogs) {
    const catalogName = config.active_catalog ?? 'default';
    const presetName = config.active_preset ?? config.active_profile;
    if (!presetName) return null;
    const catalog = config.catalogs[catalogName];
    if (!catalog) return null;
    return catalog.presets?.[presetName] ?? null;
  }

  // Legacy v1/v2: profiles-based
  if (config?.profiles) {
    const profileName = config.active_profile ?? config.active_preset;
    if (!profileName) return null;
    return config.profiles[profileName] ?? null;
  }

  return null;
}

/**
 * Get sorted list of phase names from a preset config.
 * @param {object|null} preset
 * @returns {string[]}
 */
function getPresetPhaseNames(preset) {
  if (!preset?.phases) return [];
  return Object.keys(preset.phases);
}

/**
 * Count enabled catalogs.
 * @param {object} config
 * @returns {{ count: number, names: string[] }}
 */
function getVisibleSdds(config) {
  const presets = getPublicPresetMetadata(config);
  const visibleSdds = new Set(presets.filter((p) => p.visibility === 'visible').map((p) => p.sdd));
  return { count: visibleSdds.size, names: [...visibleSdds] };
}

/**
 * Format an identity label from config.
 * @param {object|null} preset
 * @param {object|null} config
 * @returns {string|null}
 */
function resolveIdentityLabel(preset, config) {
  // Try from preset identity section
  const identity = preset?.identity ?? config?.identity ?? null;
  if (!identity) return null;

  const persona = identity.persona;
  if (persona && persona !== 'auto') return persona;

  const inheritsMd = identity.inherit_agents_md !== false;
  if (inheritsMd) {
    // If persona is auto but AGENTS.md inheritance is on, label accordingly
    return persona && persona !== 'auto' ? persona : null;
  }
  return null;
}

/**
 * Pad a label to a fixed width for aligned output.
 * @param {string} label
 * @param {number} width
 * @returns {string}
 */
function padLabel(label, width) {
  return label.padEnd(width, ' ');
}

/**
 * Format the primary target model from a lane array.
 * @param {Array} lanes
 * @returns {string}
 */
function formatLaneTarget(lanes) {
  if (!Array.isArray(lanes) || lanes.length === 0) return '—';
  const lane = lanes[0];
  return lane?.target ?? '—';
}

/**
 * Format pricing from a lane.
 * @param {Array} lanes
 * @returns {string|null}
 */
function formatLanePricing(lanes) {
  if (!Array.isArray(lanes) || lanes.length === 0) return null;
  const lane = lanes[0];
  const isNumeric = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
  const input = lane?.inputPerMillion;
  const output = lane?.outputPerMillion;
  if (!isNumeric(input) && !isNumeric(output)) return null;

  const fmt = (n) => {
    if (n === null || n === undefined) return '?';
    const num = Number(n);
    if (!Number.isFinite(num)) return '?';
    if (num === 0) return '$0';
    if (num < 1) return `$${num}`;
    return `$${num.toFixed(2).replace(/\.00$/, '')}`;
  };
  return `${fmt(input)}/${fmt(output)}`;
}

/**
 * Format context window from a lane.
 * @param {Array} lanes
 * @returns {string|null}
 */
function formatLaneCtx(lanes) {
  if (!Array.isArray(lanes) || lanes.length === 0) return null;
  const lane = lanes[0];
  const contextWindow = lane?.contextWindow;
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return null;
  if (contextWindow >= 1_000_000) {
    const m = contextWindow / 1_000_000;
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (contextWindow >= 1_000) {
    const k = contextWindow / 1_000;
    return k === Math.floor(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(contextWindow);
}

// ── buildConnectionGraph ──────────────────────────────────────────────────────

/**
 * Build ASCII SDD connections graph lines.
 *
 * For the default SDD-Orchestrator: shows canonical phases + debug_invoke arrow on the
 * phase that triggers debug (defaults to 'verify' if not specified).
 *
 * For custom SDDs with invoke declarations, shows their phases + invoke arrows.
 *
 * @param {string[]} presetPhaseNames - Phase names from active preset
 * @param {object|null} debugInvoke - debug_invoke config from active preset
 * @param {Array|null} customSdds - Custom SDD definitions (from loadCustomSdds)
 * @returns {string[]} Array of lines (ASCII graph)
 */
export function buildConnectionGraph(presetPhaseNames, debugInvoke, customSdds) {
  const phases = Array.isArray(presetPhaseNames) ? presetPhaseNames : [];
  const sdds = Array.isArray(customSdds) ? customSdds : [];
  const lines = [];

  // ── Default SDD-Orchestrator block ─────────────────────────────────────────
  lines.push('  SDD-Orchestrator (default)');

  // The phase that has the debug_invoke arrow (default: verify)
  const debugPhase = debugInvoke?.phase ?? 'verify';
  const hasDebug = debugInvoke != null && debugInvoke.preset;

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;
    const connector = isLast ? '└──' : '├──';

    if (hasDebug && phase === debugPhase) {
      const arrowTarget = debugInvoke.preset;
      const trigger = debugInvoke.trigger ? ` (${debugInvoke.trigger})` : '';
      // Show the invoke arrow on this phase
      lines.push(`  ${connector} ${phase} ──invoke──→ ${arrowTarget}${trigger}`);
    } else {
      lines.push(`  ${connector} ${phase}`);
    }
  }

  // ── Custom SDD blocks ──────────────────────────────────────────────────────
  for (const sdd of sdds) {
    const sddPhases = sdd.phases ? Object.keys(sdd.phases) : [];
    if (sddPhases.length === 0) continue;

    lines.push('');
    lines.push(`  ${sdd.name} (${sddPhases.length} phases)`);

    for (let i = 0; i < sddPhases.length; i++) {
      const phase = sddPhases[i];
      const isLast = i === sddPhases.length - 1;
      const connector = isLast ? '└──' : '├──';

      // Check if this phase has an invoke declaration
      const phaseConfig = sdd.phases[phase];
      const invoke = phaseConfig?.invoke;

      // Build delegation tag
      const delegation = phaseConfig?.delegation;
      const delegTag = delegation ? `  [${delegation}]` : '';

      if (invoke?.target) {
        const onFailure = invoke.on_failure ? `, on_failure: ${invoke.on_failure}` : '';
        const timing = invoke.timing ? `${invoke.timing}, ` : '';
        lines.push(`  ${connector} ${phase}${delegTag} ──invoke──→ ${invoke.target} (${timing}${onFailure || invoke.trigger || ''})`);
      } else {
        lines.push(`  ${connector} ${phase}${delegTag}`);
      }

      // Sub-lines for checkpoint and loop_target
      const indent = isLast ? '    ' : '│   ';

      if (phaseConfig?.checkpoint?.before_next) {
        lines.push(`  ${indent}└── 🛑 checkpoint → user approval`);
      }

      if (phaseConfig?.loop_target) {
        lines.push(`  ${indent}└── 🔄 loop → ${phaseConfig.loop_target}`);
      }
    }
  }

  return lines;
}

// ── getSimpleStatus ───────────────────────────────────────────────────────────

/**
 * Build the simple (default) status output string.
 *
 * Header logic:
 *   - No config → "❌ Not installed"
 *   - Config but not active → "⚠️  Inactive"
 *   - Config active but no manifest → "⚠️  Needs sync — config changed"
 *   - Otherwise → "✅ Ready — Synchronized"
 *
 * @param {object|null} config - Loaded router config (or null if not installed)
 * @param {object} options
 * @param {boolean} [options.manifestExists] - Whether the sync manifest exists
 * @param {string} [options.configPath] - Display path for config
 * @returns {string} Formatted status output
 */
export function getSimpleStatus(config, options = {}) {
  const { manifestExists = false } = options;
  const LABEL_WIDTH = 12;

  // ── Not installed ──────────────────────────────────────────────────────────
  if (!config) {
    return [
      '❌ Not installed',
      '',
      '  → Run `gsr setup install` to initialize',
    ].join('\n');
  }

  // ── Derive state ───────────────────────────────────────────────────────────
  const preset = getActivePreset(config);
  const publicPreset = getActivePublicPresetMetadata(config);
  const presetName = publicPreset?.name ?? config.active_preset ?? config.active_profile ?? '—';
  const phaseNames = getPresetPhaseNames(preset);
  const phaseCount = phaseNames.length;
  const sddLabel = publicPreset?.sdd ?? 'agent-orchestrator';
  const { count: visibleSddCount, names: visibleSddNames } = getVisibleSdds(config);
  const debugInvoke = preset?.debug_invoke ?? null;
  const identityLabel = resolveIdentityLabel(preset, config);
  const isActive = config.activation_state === 'active';

  // ── Header line ────────────────────────────────────────────────────────────
  let header;
  if (!isActive) {
    header = '⚠️  Inactive';
  } else if (!manifestExists) {
    header = '⚠️  Needs sync — config changed';
  } else {
    header = '✅ Ready — Synchronized';
  }

  const lines = [header, ''];

  // ── Fields ─────────────────────────────────────────────────────────────────
  lines.push(`${padLabel('Preset', LABEL_WIDTH)}${presetName} (${phaseCount} phases)`);
  lines.push(`${padLabel('SDD', LABEL_WIDTH)}${sddLabel}`);
  if (publicPreset?.scope) {
    lines.push(`${padLabel('Scope', LABEL_WIDTH)}${publicPreset.scope}`);
  }
  if (publicPreset?.visibility) {
    lines.push(`${padLabel('Visible', LABEL_WIDTH)}${publicPreset.visibility}`);
  }

  if (identityLabel) {
    lines.push(`${padLabel('Identity', LABEL_WIDTH)}${identityLabel} (AGENTS.md inherited)`);
  } else if (preset?.identity?.inherit_agents_md !== false) {
    lines.push(`${padLabel('Identity', LABEL_WIDTH)}AGENTS.md inherited`);
  }

  if (debugInvoke?.preset) {
    const trigger = debugInvoke.trigger ? ` → ${debugInvoke.trigger}` : '';
    lines.push(`${padLabel('Debug', LABEL_WIDTH)}${debugInvoke.preset}${trigger}`);
  }

  if (visibleSddCount > 0) {
    const sddList = visibleSddNames.join(', ');
    lines.push(`${padLabel('SDDs', LABEL_WIDTH)}${visibleSddCount} visible: ${sddList}`);
  }

  // SDD connections summary (one-line: most important invoke)
  if (debugInvoke?.preset) {
    const debugPhase = debugInvoke.phase ?? 'verify';
    const triggerSuffix = debugInvoke.trigger ? ` (${debugInvoke.trigger})` : '';
    lines.push(`${padLabel('Connections', LABEL_WIDTH)}${sddLabel}/${debugPhase} → ${debugInvoke.preset}${triggerSuffix}`);
  }

  lines.push('');

  // ── Hints ──────────────────────────────────────────────────────────────────
  lines.push('  gsr status --verbose   full routes, pricing & SDD graph');
  lines.push('  gsr route use <name>   switch preset');

  if (!manifestExists) {
    lines.push('');
    lines.push('  → Run `gsr sync` to apply pending changes');
  } else {
    lines.push('  gsr sync               re-sync everything');
  }

  return lines.join('\n');
}

// ── getVerboseStatus ──────────────────────────────────────────────────────────

/**
 * Build the verbose status output string.
 *
 * Sections: CONFIGURATION, PRESET, ROUTES, SDDS, PRESETS, SDD CONNECTIONS
 *
 * @param {object|null} config - Loaded router config (or null if not installed)
 * @param {object} options
 * @param {boolean} [options.manifestExists] - Whether the sync manifest exists
 * @param {string} [options.configPath] - Config file path for display
 * @param {string} [options.routerDir] - Router directory path
 * @param {Array} [options.customSdds] - Custom SDD definitions
 * @returns {string} Formatted verbose output
 */
export function getVerboseStatus(config, options = {}) {
  const { manifestExists = false, configPath, customSdds = [] } = options;

  // ── Not installed ──────────────────────────────────────────────────────────
  if (!config) {
    return [
      '❌ Not installed',
      '',
      '  → Run `gsr setup install` to initialize',
    ].join('\n');
  }

  const LABEL_WIDTH = 14;

  // ── Derive state ───────────────────────────────────────────────────────────
  const isV4 = Object.getOwnPropertyDescriptor(config, '_v4Source') !== undefined;
  const schemaVersion = isV4 ? 4 : (config.version ?? 3);
  const preset = getActivePreset(config);
  const publicPreset = getActivePublicPresetMetadata(config);
  const presetName = publicPreset?.name ?? config.active_preset ?? '—';
  const sddLabel = publicPreset?.sdd ?? 'agent-orchestrator';
  const phaseNames = getPresetPhaseNames(preset);
  const phaseCount = phaseNames.length;
  const isActive = config.activation_state === 'active';
  const debugInvoke = preset?.debug_invoke ?? null;
  const identityLabel = resolveIdentityLabel(preset, config);

  // ── Header line ────────────────────────────────────────────────────────────
  let header;
  if (!isActive) {
    header = '⚠️  Inactive';
  } else if (!manifestExists) {
    header = '⚠️  Needs sync — config changed';
  } else {
    header = '✅ Ready — Synchronized';
  }

  const lines = [header, ''];

  // ── CONFIGURATION section ──────────────────────────────────────────────────
  lines.push('CONFIGURATION');
  lines.push(`  ${padLabel('Schema', LABEL_WIDTH)}v${schemaVersion} (${isV4 ? 'multi-file' : 'single-file'})`);
  if (configPath) {
    lines.push(`  ${padLabel('Config', LABEL_WIDTH)}${configPath}`);
  }
  lines.push(`  ${padLabel('Controller', LABEL_WIDTH)}gsr (toggle: gsr deactivate)`);
  lines.push(`  ${padLabel('Activation', LABEL_WIDTH)}${config.activation_state ?? 'unknown'}`);

  const manifestState = manifestExists ? `v3 (.sync-manifest.json)` : 'not synced';
  lines.push(`  ${padLabel('Manifest', LABEL_WIDTH)}${manifestState}`);
  lines.push('');

  // ── PRESET section ─────────────────────────────────────────────────────────
  lines.push('PRESET');
  lines.push(`  ${padLabel('Active', LABEL_WIDTH)}${presetName} (${phaseCount} phases, SDD: ${sddLabel})`);
  if (publicPreset?.scope) lines.push(`  ${padLabel('Scope', LABEL_WIDTH)}${publicPreset.scope}`);
  if (publicPreset?.visibility) lines.push(`  ${padLabel('Visible', LABEL_WIDTH)}${publicPreset.visibility}`);

  if (identityLabel) {
    lines.push(`  ${padLabel('Identity', LABEL_WIDTH)}${identityLabel} (AGENTS.md inherited)`);
  } else if (preset?.identity?.inherit_agents_md !== false) {
    lines.push(`  ${padLabel('Identity', LABEL_WIDTH)}AGENTS.md inherited`);
  }

  if (debugInvoke?.preset) {
    const trigger = debugInvoke.trigger ? ` (trigger: ${debugInvoke.trigger})` : '';
    lines.push(`  ${padLabel('Debug', LABEL_WIDTH)}${debugInvoke.preset}${trigger}`);
    if (Array.isArray(debugInvoke.required_fields) && debugInvoke.required_fields.length > 0) {
      lines.push(`  ${padLabel('', LABEL_WIDTH)}required: ${debugInvoke.required_fields.join(', ')}`);
    }
  }
  lines.push('');

  // ── ROUTES section ─────────────────────────────────────────────────────────
  lines.push('ROUTES');
  if (preset?.phases && Object.keys(preset.phases).length > 0) {
    const routeLabelWidth = Math.max(...Object.keys(preset.phases).map(n => n.length)) + 2;
    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      const target = formatLaneTarget(lanes);
      const pricing = formatLanePricing(lanes);
      const ctx = formatLaneCtx(lanes);
      const pricingStr = pricing ? `   ${pricing}` : '';
      const ctxStr = ctx ? `   ${ctx} ctx` : '';
      lines.push(`  ${phaseName.padEnd(routeLabelWidth)}${target}${pricingStr}${ctxStr}`);
    }
  } else {
    lines.push('  (no phases defined)');
  }
  lines.push('');

  // ── SDDS section ───────────────────────────────────────────────────────────
  const publicPresets = getPublicPresetMetadata(config);
  const sddMap = new Map();
  for (const row of publicPresets) {
    if (!sddMap.has(row.sdd)) sddMap.set(row.sdd, { visible: 0, hidden: 0, presets: 0 });
    const entry = sddMap.get(row.sdd);
    entry.presets += 1;
    entry[row.visibility === 'hidden' ? 'hidden' : 'visible'] += 1;
  }
  if (sddMap.size > 0) {
    lines.push('SDDS');
    for (const [sddName, meta] of sddMap.entries()) {
      lines.push(`  ● ${sddName.padEnd(18)} ${String(meta.presets).padEnd(3)} presets   ${meta.visible} visible, ${meta.hidden} hidden`);
    }
    lines.push('');
  }

  // ── PRESETS section ────────────────────────────────────────────────────────
  const allPresets = publicPresets.map((p) => ({ ...p, meta: p.preset ?? p.meta ?? null }));
  const activePresetName = config?.active_preset ?? config?.active_profile ?? null;

  if (allPresets.length > 0) {
    lines.push('PRESETS');
    if (activePresetName) {
      lines.push(`  ${padLabel('Active preset', LABEL_WIDTH)}${activePresetName}`);
    }
    for (const p of allPresets) {
      const pPhaseCount = p.phases ?? Object.keys(p.meta?.phases ?? {}).length;
      const debugLabel = p.preset?.debug_invoke?.preset || p.meta?.debug_invoke?.preset
        ? `debug: ${(p.preset?.debug_invoke?.preset ?? p.meta?.debug_invoke?.preset)}`
        : 'debug: none';
      lines.push(`    ${p.name.padEnd(16)}${String(pPhaseCount).padEnd(2)} phases   ${p.sdd.padEnd(18)} ${p.scope}/${p.visibility}   ${debugLabel}`);
    }
    lines.push('');
  }

  // ── SDD CONNECTIONS section ────────────────────────────────────────────────
  const hasDebug = debugInvoke?.preset != null;
  const hasCustomSddInvokes = customSdds.some(
    (sdd) => sdd.phases && Object.values(sdd.phases).some(p => p?.invoke?.target)
  );

  if (hasDebug || hasCustomSddInvokes) {
    lines.push('SDD CONNECTIONS');
    const graphLines = buildConnectionGraph(phaseNames, debugInvoke, customSdds);
    lines.push(...graphLines);
    lines.push('');
  }

  // ── Footer hints ───────────────────────────────────────────────────────────
  lines.push('  gsr route use <name>     switch preset');
  lines.push('  gsr sync                 re-sync everything');
  lines.push('  gsr sdd validate <name>  validate custom SDD');

  return lines.join('\n');
}
import os from 'node:os';
import { getPublicPresetMetadata, getActivePublicPresetMetadata } from './public-preset-metadata.js';

// ── detectEnvironment ─────────────────────────────────────────────────────────

/**
 * Detect the current execution environment from env vars.
 * @returns {'opencode' | 'cursor' | 'terminal'}
 */
export function detectEnvironment() {
  if (process.env.OPENCODE_SESSION_ID) return 'opencode';
  if (process.env.CURSOR_SESSION_ID || process.env.TERM_PROGRAM === 'cursor') return 'cursor';
  return 'terminal';
}

// ── getUnifiedStatus ──────────────────────────────────────────────────────────

/**
 * Build the unified status output string.
 *
 * Replaces getSimpleStatus() + getVerboseStatus() with a single function.
 * Includes: preset count, custom SDD count, active preset name, OS info,
 * environment detection, full routes, pricing, and SDD connections graph.
 *
 * @param {object|null} config - Loaded router config (or null if not installed)
 * @param {object} options
 * @param {boolean} [options.manifestExists] - Whether the sync manifest exists
 * @param {string} [options.configPath] - Config file path for display
 * @param {string} [options.routerDir] - Router directory path
 * @param {Array} [options.customSdds] - Custom SDD definitions
 * @returns {string} Formatted status output
 */
export function getUnifiedStatus(config, options = {}) {
  const { manifestExists = false, configPath, customSdds = [] } = options;

  // ── Not installed ──────────────────────────────────────────────────────────
  if (!config) {
    return [
      '❌ Not installed',
      '',
      '  → Run `gsr setup install` to initialize',
    ].join('\n');
  }

  const LABEL_WIDTH = 14;

  // ── Derive state ───────────────────────────────────────────────────────────
  const isV4 = Object.getOwnPropertyDescriptor(config, '_v4Source') !== undefined;
  const schemaVersion = isV4 ? 4 : (config.version ?? 3);
  const preset = getActivePreset(config);
  const publicPreset = getActivePublicPresetMetadata(config);
  const presetName = publicPreset?.name ?? config.active_preset ?? '—';
  const sddLabel = publicPreset?.sdd ?? 'agent-orchestrator';
  const phaseNames = getPresetPhaseNames(preset);
  const phaseCount = phaseNames.length;
  const isActive = config.activation_state === 'active';
  const debugInvoke = preset?.debug_invoke ?? null;
  const identityLabel = resolveIdentityLabel(preset, config);
  const environment = detectEnvironment();

  // Count presets
  let totalPresets = 0;
  for (const catalog of Object.values(config?.catalogs ?? {})) {
    totalPresets += Object.keys(catalog?.presets ?? {}).length;
  }

  // Count custom SDDs (from customSdds option if provided, else 0)
  const customSddCount = customSdds.length;

  // ── Header line ────────────────────────────────────────────────────────────
  let header;
  if (!isActive) {
    header = '⚠️  Inactive';
  } else if (!manifestExists) {
    header = '⚠️  Needs sync — config changed';
  } else {
    header = '✅ Ready — Synchronized';
  }

  const lines = [header, ''];

  // ── CONFIGURATION section ──────────────────────────────────────────────────
  lines.push('CONFIGURATION');
  lines.push(`  ${padLabel('Schema', LABEL_WIDTH)}v${schemaVersion} (${isV4 ? 'multi-file' : 'single-file'})`);
  if (configPath) {
    lines.push(`  ${padLabel('Config', LABEL_WIDTH)}${configPath}`);
  }
  lines.push(`  ${padLabel('Controller', LABEL_WIDTH)}gsr (toggle: gsr deactivate)`);
  lines.push(`  ${padLabel('Activation', LABEL_WIDTH)}${config.activation_state ?? 'unknown'}`);
  lines.push(`  ${padLabel('Environment', LABEL_WIDTH)}${environment}`);
  lines.push(`  ${padLabel('OS', LABEL_WIDTH)}${os.platform()} ${os.release()}`);

  const manifestState = manifestExists ? `v3 (.sync-manifest.json)` : 'not synced';
  lines.push(`  ${padLabel('Manifest', LABEL_WIDTH)}${manifestState}`);
  lines.push('');

  // ── PRESET section ─────────────────────────────────────────────────────────
  lines.push('PRESET');
  lines.push(`  ${padLabel('Active', LABEL_WIDTH)}${presetName} (${phaseCount} phases, SDD: ${sddLabel})`);
  lines.push(`  ${padLabel('Total presets', LABEL_WIDTH)}${totalPresets}`);
  lines.push(`  ${padLabel('Custom SDDs', LABEL_WIDTH)}${customSddCount}`);
  if (publicPreset?.scope) lines.push(`  ${padLabel('Scope', LABEL_WIDTH)}${publicPreset.scope}`);
  if (publicPreset?.visibility) lines.push(`  ${padLabel('Visible', LABEL_WIDTH)}${publicPreset.visibility}`);

  if (identityLabel) {
    lines.push(`  ${padLabel('Identity', LABEL_WIDTH)}${identityLabel} (AGENTS.md inherited)`);
  } else if (preset?.identity?.inherit_agents_md !== false) {
    lines.push(`  ${padLabel('Identity', LABEL_WIDTH)}AGENTS.md inherited`);
  }

  if (debugInvoke?.preset) {
    const trigger = debugInvoke.trigger ? ` (trigger: ${debugInvoke.trigger})` : '';
    lines.push(`  ${padLabel('Debug', LABEL_WIDTH)}${debugInvoke.preset}${trigger}`);
    if (Array.isArray(debugInvoke.required_fields) && debugInvoke.required_fields.length > 0) {
      lines.push(`  ${padLabel('', LABEL_WIDTH)}required: ${debugInvoke.required_fields.join(', ')}`);
    }
  }
  lines.push('');

  // ── ROUTES section ─────────────────────────────────────────────────────────
  lines.push('ROUTES');
  if (preset?.phases && Object.keys(preset.phases).length > 0) {
    const routeLabelWidth = Math.max(...Object.keys(preset.phases).map(n => n.length)) + 2;
    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      const target = formatLaneTarget(lanes);
      const pricing = formatLanePricing(lanes);
      const ctx = formatLaneCtx(lanes);
      const pricingStr = pricing ? `   ${pricing}` : '';
      const ctxStr = ctx ? `   ${ctx} ctx` : '';
      lines.push(`  ${phaseName.padEnd(routeLabelWidth)}${target}${pricingStr}${ctxStr}`);
    }
  } else {
    lines.push('  (no phases defined)');
  }
  lines.push('');

  // ── SDDS section ───────────────────────────────────────────────────────────
  const publicPresets = getPublicPresetMetadata(config);
  const sddMap = new Map();
  for (const row of publicPresets) {
    if (!sddMap.has(row.sdd)) sddMap.set(row.sdd, { visible: 0, hidden: 0, presets: 0 });
    const entry = sddMap.get(row.sdd);
    entry.presets += 1;
    entry[row.visibility === 'hidden' ? 'hidden' : 'visible'] += 1;
  }
  if (sddMap.size > 0) {
    lines.push('SDDS');
    for (const [sddName, meta] of sddMap.entries()) {
      lines.push(`  ● ${sddName.padEnd(18)} ${String(meta.presets).padEnd(3)} presets   ${meta.visible} visible, ${meta.hidden} hidden`);
    }
    lines.push('');
  }

  // ── PRESETS section ────────────────────────────────────────────────────────
  const allPresets = publicPresets.map((p) => ({ ...p, meta: p.preset ?? p.meta ?? null }));
  const activePresetName2 = config?.active_preset ?? config?.active_profile ?? null;

  if (allPresets.length > 0) {
    lines.push('PRESETS');
    if (activePresetName2) {
      lines.push(`  ${padLabel('Active preset', LABEL_WIDTH)}${activePresetName2}`);
    }
    for (const p of allPresets) {
      const pPhaseCount = p.phases ?? Object.keys(p.meta?.phases ?? {}).length;
      const debugLabel = p.preset?.debug_invoke?.preset || p.meta?.debug_invoke?.preset
        ? `debug: ${(p.preset?.debug_invoke?.preset ?? p.meta?.debug_invoke?.preset)}`
        : 'debug: none';
      lines.push(`    ${p.name.padEnd(16)}${String(pPhaseCount).padEnd(2)} phases   ${p.sdd.padEnd(18)} ${p.scope}/${p.visibility}   ${debugLabel}`);
    }
    lines.push('');
  }

  // ── SDD CONNECTIONS section ────────────────────────────────────────────────
  const hasDebug = debugInvoke?.preset != null;
  const hasCustomSddInvokes = customSdds.some(
    (sdd) => sdd.phases && Object.values(sdd.phases).some(p => p?.invoke?.target)
  );

  if (hasDebug || hasCustomSddInvokes) {
    lines.push('SDD CONNECTIONS');
    const graphLines = buildConnectionGraph(phaseNames, debugInvoke, customSdds);
    lines.push(...graphLines);
    lines.push('');
  }

  // ── Footer hints ───────────────────────────────────────────────────────────
  lines.push('  gsr route use <name>     switch preset');
  lines.push('  gsr sync                 re-sync everything');
  lines.push('  gsr sdd validate <name>  validate custom SDD');

  return lines.join('\n');
}
