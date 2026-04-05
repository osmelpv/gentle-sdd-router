import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolvePersona } from '../../core/controller.js';
import { resolveIdentity } from '../../core/agent-identity.js';
import { normalizeFallbacks } from '../../core/router-v4-io.js';

const OPENCODE_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');

// ── Fallback Protocol ─────────────────────────────────────────────────────────

/**
 * Load the fallback protocol text from router/contracts/fallback-protocol.md.
 * Returns empty string if the file is not found (graceful degradation).
 */
function loadFallbackProtocolText() {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const contractPath = resolve(moduleDir, '..', '..', '..', 'router', 'contracts', 'fallback-protocol.md');
    if (existsSync(contractPath)) {
      return readFileSync(contractPath, 'utf8').trim();
    }
    console.warn('[gsr] fallback-protocol.md not found at expected path:', contractPath);
    return '';
  } catch (err) {
    console.warn('[gsr] Failed to load fallback-protocol.md:', err.message);
    return '';
  }
}

/** Fallback protocol text loaded once at module init. */
const FALLBACK_PROTOCOL_TEXT = loadFallbackProtocolText();
const GSR_AGENT_PREFIX = 'gsr-';

/**
 * Map a profile's permissions object to OpenCode tool flags.
 * Defaults all tools to true when permissions is absent.
 *
 * @param {object|undefined} permissions - { read?, write?, edit?, bash?, delegate? }
 * @returns {{ read: boolean, write: boolean, edit: boolean, bash: boolean, delegate: boolean, delegation_read: boolean, delegation_list: boolean }}
 */
export function mapPermissions(permissions) {
  const defaults = {
    read: true,
    write: true,
    edit: true,
    bash: true,
    delegate: true,
    delegation_read: true,
    delegation_list: true,
  };

  if (!permissions) return defaults;

  return {
    read: permissions.read ?? true,
    write: permissions.write ?? true,
    edit: permissions.edit ?? true,
    bash: permissions.bash ?? true,
    delegate: permissions.delegate ?? true,
    delegation_read: permissions.delegate ?? true,
    delegation_list: permissions.delegate ?? true,
  };
}

/**
 * Extract the orchestrator primary lane target model from a preset.
 * Returns null if no orchestrator phase is present.
 *
 * @param {object} preset - A preset from the assembled config (catalogs[name].presets[name])
 * @returns {string|null}
 */
function getOrchestratorTarget(preset) {
  const phases = preset.phases;
  if (!phases || typeof phases !== 'object' || Array.isArray(phases)) return null;

  const orchestrator = phases.orchestrator;
  if (!orchestrator) return null;

  // Phases in assembled (non-normalized) config are arrays of lane objects.
  if (Array.isArray(orchestrator) && orchestrator.length > 0) {
    return orchestrator[0].target ?? null;
  }

  return null;
}

/**
 * Generate OpenCode overlay from a loaded (assembled) router config.
 * Each preset that has an orchestrator phase becomes a gsr-{name} agent entry.
 * Presets without an orchestrator phase are skipped with a warning.
 *
 * Each generated entry includes:
 *   - prompt: resolved identity prompt (via resolveIdentity fallback chain)
 *   - _gsr_generated: true (merge marker for safe regeneration)
 *
 * @param {object} config - Loaded/assembled router config (v3-shaped, from loadRouterConfig)
 * @param {object} [options]
 *   - cwd {string}: Directory for AGENTS.md resolution (default: process.cwd())
 * @returns {{ agent: Record<string, object>, warnings: string[] }}
 */
export function generateOpenCodeOverlay(config, options = {}) {
  const agents = {};
  const warnings = [];
  const catalogs = config.catalogs ?? {};
  const persona = resolvePersona(config);
  const cwd = options.cwd ?? process.cwd();

  // Router-level identity overrides: config.identity.overrides.<agentName>
  const routerOverrides = config?.identity?.overrides ?? {};

  for (const [catalogName, catalog] of Object.entries(catalogs)) {
    // Only include presets from enabled catalogs in the overlay
    if (catalog.enabled === false) {
      continue;
    }
    const presets = catalog.presets ?? {};

    for (const [presetName, preset] of Object.entries(presets)) {
      const orchestratorTarget = getOrchestratorTarget(preset);

      if (!orchestratorTarget) {
        warnings.push(
          `Profile "${presetName}" has no orchestrator phase with a target — skipped from overlay.`
        );
        continue;
      }

      const agentName = `${GSR_AGENT_PREFIX}${presetName}`;
      const availability = preset.availability ?? 'stable';

      // Resolve identity for this preset using the fallback chain
      const identity = resolveIdentity(preset, { cwd });

      // Apply router-level override for this agent (if present) — overrides win
      const agentOverride = routerOverrides[agentName] ?? {};
      let resolvedPrompt = agentOverride.prompt ?? identity.prompt;

      // Task 4: Build _gsr_fallbacks map keyed by phase name (preliminary pass to check if any fallbacks exist)
      // We need this BEFORE the protocol injection to gate the injection
      const preCheckPhases = preset.phases ?? {};
      const presetHasFallbacks = Object.values(preCheckPhases).some((lanes) => {
        if (!Array.isArray(lanes) || lanes.length === 0) return false;
        const primaryLane = lanes[0];
        if (!primaryLane || typeof primaryLane !== 'object') return false;
        const rawFallbacks = primaryLane.fallbacks;
        if (!rawFallbacks) return false;
        if (Array.isArray(rawFallbacks)) return rawFallbacks.length > 0;
        if (typeof rawFallbacks === 'string') return rawFallbacks.trim().length > 0;
        return false;
      });

      // Task 5: Inject fallback protocol into prompt ONLY when preset has fallbacks (design D2)
      if (FALLBACK_PROTOCOL_TEXT && presetHasFallbacks && !resolvedPrompt.includes('GSR Fallback Protocol')) {
        resolvedPrompt = resolvedPrompt + '\n\n' + FALLBACK_PROTOCOL_TEXT;
      }

      // Task 4: Build _gsr_fallbacks map keyed by phase name
      // Each entry: { [phaseName]: [model1, model2, ...] }
      const gsrFallbacks = {};
      const phases = preset.phases ?? {};
      for (const [phaseName, lanes] of Object.entries(phases)) {
        if (!Array.isArray(lanes) || lanes.length === 0) continue;
        const primaryLane = lanes[0];
        if (!primaryLane || typeof primaryLane !== 'object') continue;

        const rawFallbacks = primaryLane.fallbacks;
        if (rawFallbacks !== undefined) {
          // Already normalized by validateProfileFile, but handle both forms defensively
          const normalized = Array.isArray(rawFallbacks)
            ? rawFallbacks
            : normalizeFallbacks(rawFallbacks);
          gsrFallbacks[phaseName] = normalized.map((fb) =>
            typeof fb === 'string' ? fb : fb.model
          );
        } else {
          gsrFallbacks[phaseName] = [];
        }
      }

      const entry = {
        mode: 'primary',
        description: `gsr: ${presetName} — ${availability} [${persona}]`,
        model: orchestratorTarget,
        prompt: resolvedPrompt,
        tools: mapPermissions(preset.permissions),
        _gsr_generated: true,
        _gsr_fallbacks: gsrFallbacks,
        _gsr_orchestrator_fallbacks: gsrFallbacks.orchestrator ?? [],
      };

      if (preset.hidden === true) {
        entry.hidden = true;
      }

      agents[agentName] = entry;
    }
  }

  return { agent: agents, warnings };
}

/**
 * Merge overlay into existing opencode.json, respecting the _gsr_generated marker.
 *
 * Rules:
 *   - Non-gsr-* keys are always preserved.
 *   - gsr-* entries with _gsr_generated === true in existing → safe to overwrite.
 *   - gsr-* entries without _gsr_generated (or _gsr_generated !== true) in existing → preserved + warning
 *     (unless force=true, in which case they are overwritten with a warning).
 *   - gsr-* entries in existing that are NOT in the new overlay → removed only if _gsr_generated === true;
 *     user-created entries (no marker) are preserved (unless force=true).
 *
 * @param {{ agent: Record<string, object>, warnings?: string[] }} overlay - Output from generateOpenCodeOverlay
 * @param {object} [existing] - Current opencode.json content (parsed JSON object)
 * @param {{ force?: boolean }} [options]
 *   - force {boolean}: When true, overwrites ALL gsr-* entries including user-modified ones. Default: false.
 * @returns {{ agent: Record<string, object>, warnings: string[] }} - Merged config with warnings
 */
export function mergeOverlayWithExisting(overlay, existing = {}, options = {}) {
  const force = options?.force === true;
  const result = JSON.parse(JSON.stringify(existing));
  const mergeWarnings = Array.isArray(overlay.warnings) ? [...overlay.warnings] : [];

  if (!result.agent) result.agent = {};

  // Separate gsr-* entries in existing into:
  //   - GSR-managed (has _gsr_generated === true) → safe to remove/replace
  //   - User-owned (no marker or _gsr_generated !== true) → preserve (unless force)
  const existingGsrKeys = Object.keys(result.agent).filter(k => k.startsWith(GSR_AGENT_PREFIX));
  const userOwnedKeys = new Set();

  if (!force) {
    for (const key of existingGsrKeys) {
      const entry = result.agent[key];
      if (entry?._gsr_generated !== true) {
        // User-owned entry — preserve it
        userOwnedKeys.add(key);
      }
    }
  }

  // Remove stale GSR-managed gsr-* entries (not user-owned)
  for (const key of existingGsrKeys) {
    if (!userOwnedKeys.has(key)) {
      delete result.agent[key];
    }
  }

  // Add/replace new gsr-* entries, respecting user ownership
  for (const [key, entry] of Object.entries(overlay.agent ?? {})) {
    if (userOwnedKeys.has(key)) {
      // User-owned entry: emit warning and skip
      mergeWarnings.push(
        `${key}: user prompt detected — skipped (entry preserved as-is)`
      );
      // Keep existing user entry (already in result.agent)
      continue;
    }

    if (force && existing?.agent?.[key] && existing.agent[key]._gsr_generated !== true) {
      // Force overwrite: emit warning indicating forced overwrite
      mergeWarnings.push(
        `${key}: force overwrite — user entry replaced by generated value`
      );
    }

    result.agent[key] = entry;
  }

  // Attach warnings as non-enumerable so they travel with the return value
  // but are NEVER serialized to opencode.json (JSON.stringify ignores non-enumerable).
  Object.defineProperty(result, 'warnings', {
    value: mergeWarnings,
    enumerable: false,
    configurable: true,
  });

  return result;
}

/**
 * Read existing opencode.json and merge overlay into it.
 * Falls back to an empty config if the file is absent or unparseable.
 *
 * @param {{ agent: Record<string, object> }} overlay
 * @param {string} [configPath] - Override the default opencode.json path (for testing)
 * @param {{ force?: boolean }} [options]
 * @returns {object} - Merged config ready to write
 */
export function mergeOverlayWithFile(overlay, configPath = OPENCODE_CONFIG_PATH, options = {}) {
  let existing = {};

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  return mergeOverlayWithExisting(overlay, existing, options);
}

/**
 * Write a config object to the given path atomically (temp + rename).
 *
 * @param {object} config - Object to write as JSON
 * @param {string} [targetPath] - Override the default opencode.json path (for testing)
 * @returns {string} - The path that was written
 */
export function writeOpenCodeConfig(config, targetPath = OPENCODE_CONFIG_PATH) {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(config, null, 2) + '\n';
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(tempPath, json, 'utf8');
  renameSync(tempPath, targetPath);

  return targetPath;
}

/**
 * Remove all gsr-* agent entries from opencode.json.
 * @param {string} [configPath] - Override path for testing
 * @returns {{ removedCount: number, path: string }}
 */
export function removeOpenCodeOverlay(configPath = OPENCODE_CONFIG_PATH) {
  if (!existsSync(configPath)) {
    return { removedCount: 0, path: configPath };
  }

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { removedCount: 0, path: configPath };
  }

  if (!existing.agent || typeof existing.agent !== 'object') {
    return { removedCount: 0, path: configPath };
  }

  const gsrKeys = Object.keys(existing.agent).filter((key) => key.startsWith(GSR_AGENT_PREFIX));

  if (gsrKeys.length === 0) {
    return { removedCount: 0, path: configPath };
  }

  const result = JSON.parse(JSON.stringify(existing));
  for (const key of gsrKeys) {
    delete result.agent[key];
  }

  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(result, null, 2) + '\n';
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, json, 'utf8');
  renameSync(tempPath, configPath);

  return { removedCount: gsrKeys.length, path: configPath };
}

const OPENCODE_COMMANDS_DIR = join(homedir(), '.config', 'opencode', 'commands');

/**
 * Find the gsr commands source directory.
 * Commands are .md files shipped under router/commands/ in the package.
 */
function findCommandsSourceDir() {
  const moduleDir = dirname(new URL(import.meta.url).pathname);
  const commandsDir = join(moduleDir, '..', '..', '..', 'router', 'commands');
  if (existsSync(commandsDir)) return commandsDir;
  return null;
}

/**
 * Deploy gsr-*.md command files to the OpenCode commands directory.
 * These become /gsr-* slash commands inside the TUI.
 *
 * @param {{ commandsDir?: string }} options - Override target dir for testing
 * @returns {{ written: number, skipped: number, files: string[], targetDir: string }}
 */
export function deployGsrCommands(options = {}) {
  const sourceDir = findCommandsSourceDir();
  if (!sourceDir) {
    return { written: 0, skipped: 0, files: [], targetDir: '', error: 'Commands source directory not found.' };
  }

  const targetDir = options.commandsDir || OPENCODE_COMMANDS_DIR;
  mkdirSync(targetDir, { recursive: true });

  const sourceFiles = readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  const files = [];
  let written = 0;
  let skipped = 0;

  for (const file of sourceFiles) {
    const sourcePath = join(sourceDir, file);
    // Rename gsr-fallback.md → gsr-fallback-manual.md to avoid conflict with
    // the TUI plugin's registered /gsr-fallback command in the command palette.
    const deployedFileName = file === 'gsr-fallback.md' ? 'gsr-fallback-manual.md' : file;
    const targetPath = join(targetDir, deployedFileName);
    const sourceContent = readFileSync(sourcePath, 'utf8');

    // Skip if identical content already exists
    if (existsSync(targetPath)) {
      const existingContent = readFileSync(targetPath, 'utf8');
      if (existingContent === sourceContent) {
        skipped++;
        continue;
      }
    }

    // Atomic write
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, sourceContent, 'utf8');
    renameSync(tempPath, targetPath);
    files.push(deployedFileName);
    written++;
  }

  return { written, skipped, files, targetDir };
}

/**
 * Remove all gsr-*.md command files from the OpenCode commands directory.
 * @param {{ commandsDir?: string }} options
 * @returns {{ removed: number, files: string[] }}
 */
export function removeGsrCommands(options = {}) {
  const targetDir = options.commandsDir || OPENCODE_COMMANDS_DIR;
  if (!existsSync(targetDir)) {
    return { removed: 0, files: [] };
  }

  const gsrFiles = readdirSync(targetDir).filter(f => f.startsWith('gsr-') && f.endsWith('.md'));
  for (const file of gsrFiles) {
    unlinkSync(join(targetDir, file));
  }

  return { removed: gsrFiles.length, files: gsrFiles };
}

/**
 * Remove stale gsr-* entries from the GLOBAL opencode.json.
 * Called during apply to migrate from old behavior (global) to new (project-local).
 *
 * @returns {{ removedCount: number, path: string }}
 */
export function cleanStaleGlobalOverlay() {
  return removeOpenCodeOverlay(OPENCODE_CONFIG_PATH);
}

export { OPENCODE_CONFIG_PATH, OPENCODE_COMMANDS_DIR, GSR_AGENT_PREFIX };
