import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
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
    const targetPath = join(targetDir, file);
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
    files.push(file);
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
