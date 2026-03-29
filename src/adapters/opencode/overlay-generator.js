import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { resolvePersona } from '../../core/controller.js';

const OPENCODE_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');
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
 * @param {object} config - Loaded/assembled router config (v3-shaped, from loadRouterConfig)
 * @returns {{ agent: Record<string, object>, warnings: string[] }}
 */
export function generateOpenCodeOverlay(config) {
  const agents = {};
  const warnings = [];
  const catalogs = config.catalogs ?? {};
  const persona = resolvePersona(config);

  for (const [, catalog] of Object.entries(catalogs)) {
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

      const entry = {
        mode: 'primary',
        description: `gsr: ${presetName} — ${availability} [${persona}]`,
        model: orchestratorTarget,
        tools: mapPermissions(preset.permissions),
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
 * Merge overlay into existing opencode.json, only touching gsr-* keys.
 * Non-gsr agent keys are preserved as-is.
 *
 * @param {object} existing - Current opencode.json content (parsed JSON object)
 * @param {{ agent: Record<string, object> }} overlay - Output from generateOpenCodeOverlay
 * @returns {object} - Merged config
 */
export function mergeOverlayWithExisting(overlay, existing = {}) {
  const result = JSON.parse(JSON.stringify(existing));

  if (!result.agent) result.agent = {};

  // Remove old gsr-* entries (stale cleanup).
  for (const key of Object.keys(result.agent)) {
    if (key.startsWith(GSR_AGENT_PREFIX)) {
      delete result.agent[key];
    }
  }

  // Add new gsr-* entries.
  Object.assign(result.agent, overlay.agent);

  return result;
}

/**
 * Read existing opencode.json and merge overlay into it.
 * Falls back to an empty config if the file is absent or unparseable.
 *
 * @param {{ agent: Record<string, object> }} overlay
 * @param {string} [configPath] - Override the default opencode.json path (for testing)
 * @returns {object} - Merged config ready to write
 */
export function mergeOverlayWithFile(overlay, configPath = OPENCODE_CONFIG_PATH) {
  let existing = {};

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  return mergeOverlayWithExisting(overlay, existing);
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

export { OPENCODE_CONFIG_PATH, GSR_AGENT_PREFIX };
