/**
 * Unified Sync Pipeline
 *
 * Orchestrates the 7-step sync pipeline:
 *   1. contracts     — generate/update .sync-manifest.json
 *   2. overlay       — generate OpenCode overlay from config
 *   3. apply         — merge overlay into opencode.json
 *   4. commands      — deploy gsr-*.md slash commands to OpenCode
 *   5. claude-code   — deploy gsr-*.md slash commands to Claude Code (~/.claude/commands/)
 *   6. validate      — readback opencode.json and verify expected agents
 *   7. tui-plugin    — register project directory in ~/.config/opencode/tui.json
 *
 * All steps return structured results; the caller decides what to print.
 * No step throws — failures are captured in the step result.
 *
 * @module unified-sync
 */

import fs, { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Lazy imports — avoids circular deps, allows test mocking
async function getSyncContracts() {
  const { syncContracts } = await import('./sync.js');
  return syncContracts;
}

async function getOverlayGenerators() {
  const mod = await import('../adapters/opencode/overlay-generator.js');
  return mod;
}

async function getProjectSddMaterializer() {
  const { materializeProjectSddAgents } = await import('../adapters/opencode/project-sdd-agent-materializer.js');
  return materializeProjectSddAgents;
}

async function getLoadRouterConfig() {
  const { loadRouterConfig } = await import('../adapters/opencode/index.js');
  return loadRouterConfig;
}

// ── Step result builders ───────────────────────────────────────────────────

/**
 * @typedef {Object} SyncStep
 * @property {string} name - 'contracts'|'overlay'|'apply'|'commands'|'validate'
 * @property {'ok'|'skipped'|'failed'} status
 * @property {object} [data] - Step-specific result data
 * @property {string} [error] - Error message if failed
 * @property {number} [duration] - Approximate ms
 */

function stepOk(name, data = {}) {
  return { name, status: 'ok', data };
}

function stepFailed(name, error) {
  return { name, status: 'failed', error: String(error) };
}

function stepSkipped(name, reason) {
  return { name, status: 'skipped', data: { reason } };
}

// ── Aggregate status ──────────────────────────────────────────────────────

function aggregateStatus(steps) {
  const hasFailed = steps.some(s => s.status === 'failed');
  const allOk = steps.every(s => s.status === 'ok' || s.status === 'skipped');

  // The contracts step is critical — its failure means total failure
  const contractsStep = steps.find(s => s.name === 'contracts');
  if (contractsStep?.status === 'failed') return 'failed';

  if (hasFailed) return 'partial';
  if (allOk) return 'ok';
  return 'partial';
}

// ── Step implementations ──────────────────────────────────────────────────

/**
 * Step 1: Generate/update .sync-manifest.json
 * @param {object} opts
 * @param {boolean} opts.dryRun
 * @param {string} [opts.configPath] - router.yaml path (used to derive contractsDir)
 */
async function runContractsStep(opts) {
  const { dryRun, configPath } = opts;

  try {
    // We need to derive contractsDir from the configPath location.
    // The syncContracts() function uses findContractsDir() which resolves relative
    // to the module — that's correct for installed usage.
    // For tests (temp dirs), we must use the configPath to find the contracts dir.
    const { generateSyncManifest, readContracts } = await import('./sync.js');

    // Derive contractsDir from configPath when available
    let contractsDir;
    if (configPath) {
      // configPath itself must exist (we need a valid router root to operate)
      if (!existsSync(configPath)) {
        return stepFailed('contracts', 'Config file not found at ' + configPath);
      }
      const routerDir = dirname(configPath);
      const candidateDir = join(routerDir, 'contracts');
      if (!existsSync(candidateDir)) {
        // Fix 1: graceful skip — contracts dir missing is not fatal.
        // Projects that only have catalogs in router/catalogs/ can still sync catalogs.
        return stepSkipped('contracts', 'Contracts directory not found at ' + candidateDir + ' — skipping global contracts');
      }
      contractsDir = candidateDir;
    } else {
      // Fall back to the module-relative discovery
      const { findContractsDir } = await import('./sync.js');
      contractsDir = findContractsDir();
      if (!contractsDir) {
        // Fix 1: graceful skip — contracts dir missing is not fatal
        return stepSkipped('contracts', 'Contracts directory not found. Expected at router/contracts/ — skipping global contracts');
      }
    }

    const contracts = readContracts(contractsDir);
    const roles = contracts.filter(c => c.type === 'role').length;
    const phases = contracts.filter(c => c.type === 'phase').length;

    if (!dryRun) {
      const catalogsDir = join(dirname(contractsDir), 'catalogs');
      const { manifestPath } = generateSyncManifest(contractsDir, catalogsDir);
      return stepOk('contracts', { roles, phases, total: contracts.length, manifestPath });
    }

    return stepOk('contracts', { roles, phases, total: contracts.length, dryRun: true });
  } catch (err) {
    return stepFailed('contracts', err.message);
  }
}

/**
 * Step 2: Generate OpenCode overlay from router config
 */
async function runOverlayStep(opts) {
  const { configPath, cwd } = opts;

  try {
    const loadRouterConfig = await getLoadRouterConfig();
    const effectiveConfigPath = configPath;

    if (!effectiveConfigPath || !existsSync(effectiveConfigPath)) {
      // Non-fatal: return empty overlay with warning
      return stepOk('overlay', { agent: {}, warnings: ['No config found — overlay is empty'] });
    }

    let config;
    try {
      config = loadRouterConfig(effectiveConfigPath);
    } catch (err) {
      return stepFailed('overlay', 'Failed to load router config: ' + err.message);
    }

    const { generateOpenCodeOverlay } = await getOverlayGenerators();
    const overlay = generateOpenCodeOverlay(config, { cwd });

    return stepOk('overlay', { agent: overlay.agent, warnings: overlay.warnings });
  } catch (err) {
    return stepFailed('overlay', err.message);
  }
}

/**
 * Step 3: Apply (merge + write) overlay to opencode.json
 */
/**
 * Compute create/update/preserve breakdown for overlay gsr-* keys against existing config.
 * @param {object} overlayAgent - The overlay's agent map
 * @param {object} existingAgent - The current opencode.json agent map (may be empty)
 * @returns {{ wouldCreate: number, wouldUpdate: number, wouldPreserve: number }}
 */
function computeApplyCounts(overlayAgent, existingAgent) {
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldPreserve = 0;

  for (const key of Object.keys(overlayAgent ?? {})) {
    if (!key.startsWith('gsr-')) continue;
    const existing = existingAgent?.[key];
    if (!existing) {
      wouldCreate++;
    } else if (existing._gsr_generated === true) {
      wouldUpdate++;
    } else {
      // User-owned entry — will be preserved (not overwritten)
      wouldPreserve++;
    }
  }

  return { wouldCreate, wouldUpdate, wouldPreserve };
}

async function runApplyStep(opts) {
  const { overlayData, dryRun, force, targetPath, configPath } = opts;

  try {
    const {
      mergeOverlayWithFile,
      mergeOverlayWithExisting,
      writeOpenCodeConfig,
    } = await getOverlayGenerators();

    const overlay = overlayData ?? { agent: {}, warnings: [] };

    // Determine targetPath: explicit > derived from configPath
    let resolvedTarget = targetPath;
    if (!resolvedTarget && configPath) {
      // configPath = /path/router/router.yaml → projectRoot = /path → /path/opencode.json
      resolvedTarget = join(dirname(dirname(configPath)), 'opencode.json');
    }

    if (dryRun) {
      // Compute what would be written but don't write
      const merged = resolvedTarget
        ? mergeOverlayWithFile(overlay, resolvedTarget, { force })
        : mergeOverlayWithExisting(overlay, {}, { force });

      // Read existing for count computation
      let existingAgent = {};
      if (resolvedTarget && existsSync(resolvedTarget)) {
        try {
          existingAgent = JSON.parse(readFileSync(resolvedTarget, 'utf8')).agent ?? {};
        } catch {
          existingAgent = {};
        }
      }

      const agentCount = Object.keys(merged.agent ?? {}).length;
      const gsrCount = Object.keys(merged.agent ?? {}).filter(k => k.startsWith('gsr-')).length;
      const { wouldCreate, wouldUpdate, wouldPreserve } = computeApplyCounts(overlay.agent, existingAgent);
      return stepOk('apply', {
        dryRun: true,
        agentCount,
        gsrCount,
        sddCount: configPath ? 1 : 0,
        wouldCreate,
        wouldUpdate,
        wouldPreserve,
        warnings: merged.warnings ?? [],
        targetPath: resolvedTarget,
      });
    }

    const merged = resolvedTarget
      ? mergeOverlayWithFile(overlay, resolvedTarget, { force })
      : mergeOverlayWithExisting(overlay, {}, { force });

    let writtenPath = writeOpenCodeConfig(merged, resolvedTarget);
    const applyWarnings = [...(merged.warnings ?? [])];
    const gsrCount = Object.keys(merged.agent ?? {}).filter(k => k.startsWith('gsr-')).length;
    let sddCount = 0;

    if (configPath) {
      try {
        const materializeProjectSddAgents = await getProjectSddMaterializer();
        const projectResult = materializeProjectSddAgents(configPath, { targetPath: writtenPath, cwd: opts.cwd ?? process.cwd() });
        writtenPath = projectResult.writtenPath;
        sddCount = projectResult.count;
        if (projectResult.warnings?.length) {
          applyWarnings.push(...projectResult.warnings);
        }
      } catch (err) {
        applyWarnings.push(`project-sdd-agents: ${err.message}`);
      }
    }

    // Count preserved user overrides from merge warnings
    const preservedCount = (merged.warnings ?? []).filter(
      w => w.includes('user prompt detected')
    ).length;

    return stepOk('apply', {
      writtenPath,
      agentCount: Object.keys(merged.agent ?? {}).length,
      gsrCount,
      sddCount,
      preservedCount,
      warnings: applyWarnings,
    });
  } catch (err) {
    return stepFailed('apply', err.message);
  }
}

/**
 * Step 4: Deploy gsr-*.md slash commands
 */
async function runCommandsStep(opts) {
  const { dryRun, commandsDir } = opts;

  if (dryRun) {
    return stepOk('commands', { dryRun: true, written: 0, skipped: 0 });
  }

  try {
    const { deployGsrCommands } = await getOverlayGenerators();
    const result = deployGsrCommands(commandsDir ? { commandsDir } : {});
    return stepOk('commands', result);
  } catch (err) {
    return stepFailed('commands', err.message);
  }
}

/**
 * Step 5: Deploy gsr-*.md slash commands to Claude Code (~/.claude/commands/)
 *
 * Gracefully skips (log at debug level) when Claude Code is not installed.
 * "Not installed" is defined as: ~/.claude/ directory does not exist after
 * the deployer attempts to create it — practically, this means the deploy
 * always attempts but NEVER fails the pipeline.
 */
async function runCommandsClaudeCodeStep(opts) {
  const { dryRun, commandsSourceDir, claudeCommandsDir } = opts;

  if (dryRun) {
    return stepOk('claude-code', { dryRun: true, deployed: 0, skipped: 0 });
  }

  try {
    const { deployGsrCommandsClaudeCode, CLAUDE_COMMANDS_DIR } = await import('../adapters/claude-code/command-deployer.js');
    const effectiveTargetDir = claudeCommandsDir ?? CLAUDE_COMMANDS_DIR;
    const result = await deployGsrCommandsClaudeCode(commandsSourceDir, effectiveTargetDir);

    if (result.errors.length > 0) {
      // Partial failure — report but don't fail the whole pipeline
      return stepOk('claude-code', {
        deployed: result.deployed,
        skipped: result.skipped,
        errors: result.errors,
        targetDir: result.targetDir,
      });
    }

    return stepOk('claude-code', {
      deployed: result.deployed,
      skipped: result.skipped,
      targetDir: result.targetDir,
    });
  } catch (err) {
    // Non-fatal: Claude Code may not be installed or accessible — skip silently
    // (captured in result, not thrown)
    return stepSkipped('claude-code', `Claude Code commands skipped: ${err.message}`);
  }
}

/**
 * Step 6: Validate — readback opencode.json and compare expected vs actual agents
 *
 * requiresReopen is true ONLY when the apply step actually changed gsr-* entries
 * (added new agents or modified existing ones). Manifest-only or non-gsr writes
 * do NOT trigger reopen.
 *
 * @param {object} opts
 * @param {object} opts.overlayData    - Overlay agent data from step 2
 * @param {string} [opts.targetPath]   - Resolved path to opencode.json
 * @param {string} [opts.configPath]   - router.yaml path (used as fallback for targetPath)
 * @param {boolean} opts.dryRun        - Whether this is a dry run
 * @param {Set<string>} [opts.preApplyGsrKeys] - gsr-* keys present BEFORE the apply step
 */
async function runValidateStep(opts) {
  const { overlayData, targetPath, configPath, dryRun, preApplyGsrKeys } = opts;

  try {
    // Determine target
    let resolvedTarget = targetPath;
    if (!resolvedTarget && configPath) {
      resolvedTarget = join(dirname(dirname(configPath)), 'opencode.json');
    }

    const expectedGsrKeys = Object.keys(overlayData?.agent ?? {}).filter(k => k.startsWith('gsr-'));

    if (dryRun) {
      return stepOk('validate', {
        dryRun: true,
        expectedAgents: expectedGsrKeys.length,
        agentsVisible: 0,
        missingAgents: expectedGsrKeys,
        requiresReopen: false,
      });
    }

    if (!resolvedTarget || !existsSync(resolvedTarget)) {
      return stepOk('validate', {
        expectedAgents: expectedGsrKeys.length,
        agentsVisible: 0,
        missingAgents: expectedGsrKeys,
        requiresReopen: false,
      });
    }

    let written = {};
    try {
      written = JSON.parse(readFileSync(resolvedTarget, 'utf8'));
    } catch {
      written = {};
    }

    const actualGsrKeys = Object.keys(written.agent ?? {}).filter(k => k.startsWith('gsr-'));
    const missingAgents = expectedGsrKeys.filter(k => !actualGsrKeys.includes(k));

    // requiresReopen only when gsr-* entries in opencode.json actually changed.
    // Compare current gsr-* key set against what was there before the apply step.
    const before = preApplyGsrKeys ?? new Set();
    const after = new Set(actualGsrKeys);
    const gsrEntriesChanged =
      actualGsrKeys.some(k => !before.has(k)) || // new key added
      [...before].some(k => !after.has(k));        // existing key removed

    return stepOk('validate', {
      expectedAgents: expectedGsrKeys.length,
      agentsVisible: actualGsrKeys.length,
      missingAgents,
      requiresReopen: gsrEntriesChanged,
    });
  } catch (err) {
    return stepFailed('validate', err.message);
  }
}

// ── Helpers: TUI Plugin registration ─────────────────────────────────────────

/**
 * Ensure the gsr plugin is registered in `<opencodeConfigDir>/tui.json`.
 *
 * Only ADDS the entry if missing — never removes or duplicates existing entries.
 * Uses an atomic write (temp-file + rename) so concurrent processes never see
 * a partial JSON.
 *
 * @param {string} opencodeConfigDir - e.g. ~/.config/opencode or test override
 * @param {string} pluginFilePath    - absolute path to gsr-plugin.tsx
 * @returns {boolean} true if tui.json was changed, false if already registered (no-op)
 */
export function ensureTuiJsonPlugin(opencodeConfigDir, pluginFilePath) {
  const tuiJsonPath = path.join(opencodeConfigDir, 'tui.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
  } catch {
    // file doesn't exist or is invalid JSON — start from scratch
  }

  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];

  // Check if already registered (by plugin file path)
  const alreadyRegistered = plugins.some(p =>
    Array.isArray(p) && p[0] === pluginFilePath
  );

  if (!alreadyRegistered) {
    plugins.push([pluginFilePath, { enabled: true }]);
    cfg.plugin = plugins;
    const tmp = tuiJsonPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
    fs.renameSync(tmp, tuiJsonPath);
    return true; // changed
  }
  return false; // no-op
}

// ── Step 7: Deploy TUI Plugin ─────────────────────────────────────────────

/**
 * Peer dependencies required by gsr-tui-plugin.js.
 * These are declared in ~/.config/opencode/package.json so OpenCode / Bun
 * can install them automatically at startup.
 */
const GSR_PLUGIN_DEPS = {
  '@opencode-ai/plugin': '*',
  '@opentui/core': '*',
  '@opentui/solid': '*',
  'solid-js': '*',
};

/**
 * Ensure the 4 plugin peer dependencies are declared in
 * `<configDir>/package.json`.  Only ADDS missing entries — never
 * downgrades or overwrites values the user has already set.
 *
 * Uses an atomic write (temp-file + rename) so a concurrent process
 * never reads a partial JSON.
 *
 * @param {string} configDir  - ~/.config/opencode or test override
 * @returns {{ changed: boolean, pkgPath: string }}
 */
export function ensurePluginDeps(configDir) {
  const pkgPath = join(configDir, 'package.json');
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    // file doesn't exist or is invalid JSON — start from scratch
  }

  // Merge deps — only add missing, never downgrade existing
  const deps = pkg.dependencies || {};
  let changed = false;
  for (const [name, version] of Object.entries(GSR_PLUGIN_DEPS)) {
    if (!deps[name]) {
      deps[name] = version;
      changed = true;
    }
  }

  if (changed) {
    pkg.dependencies = deps;
    // Atomic write: temp file + rename
    const tmp = pkgPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    renameSync(tmp, pkgPath);
  }

  return { changed, pkgPath };
}

/**
 * Step 7: Deploy src/adapters/opencode/gsr-tui-plugin.js to
 * Registers the gsr project directory in ~/.config/opencode/tui.json so OpenCode
 * loads tui.tsx at the project root as the TUI plugin entry point.
 *
 * tui.tsx is a thin wrapper that re-exports from src/adapters/opencode/gsr-tui-plugin.js.
 * This avoids copying files and broken relative imports in the plugins/ directory.
 *
 * - Idempotent: noop if already registered.
 * - Graceful skip if tui.json is not accessible.
 * - Never fails the pipeline.
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun
 * @param {string} [opts.projectDir] - override project dir (for testing)
 * @param {string} [opts.opencodeConfigDir] - override ~/.config/opencode (for testing)
 */
async function deployGsrPluginStep(opts) {
  const { dryRun, projectDir, opencodeConfigDir } = opts;

  if (dryRun) {
    return stepOk('tui-plugin', { dryRun: true, registered: false, skipped: true });
  }

  try {
    const configDir = opencodeConfigDir ?? join(homedir(), '.config', 'opencode');

    // The project directory — tui.tsx lives at its root
    const pluginDir = projectDir ?? process.cwd();

    // Register project dir in tui.json
    let registered = false;
    try {
      registered = ensureTuiJsonPlugin(configDir, pluginDir);
    } catch (tuiErr) {
      // eslint-disable-next-line no-console
      console.warn(`[gsr] Warning: could not register plugin in tui.json: ${tuiErr.message}`);
    }

    return stepOk('tui-plugin', { registered, skipped: !registered, pluginDir });
  } catch (err) {
    return stepSkipped('tui-plugin', `TUI plugin registration skipped: ${err.message}`);
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} UnifiedSyncOptions
 * @property {string} [configPath]         - router.yaml path (auto-discovered if omitted)
 * @property {boolean} [dryRun]            - Run all steps but don't write files (default: false)
 * @property {boolean} [force]             - Overwrite user entries in opencode.json (default: false)
 * @property {string} [cwd]               - Working dir for identity resolution (default: process.cwd())
 * @property {string} [targetPath]         - Explicit path for opencode.json (used in tests)
 * @property {string} [commandsDir]        - Explicit path for OpenCode commands dir (used in tests)
 * @property {string} [claudeCommandsDir]  - Explicit path for Claude Code commands dir (used in tests)
 * @property {string} [pluginsDir]          - Explicit path for OpenCode plugins dir (used in tests)
 * @property {string} [pluginSourcePath]   - Explicit path for TUI plugin source (used in tests)
 * @property {string} [opencodeConfigDir]  - Explicit path for ~/.config/opencode (used in tests)
 */

/**
 * @typedef {Object} UnifiedSyncResult
 * @property {SyncStep[]} steps
 * @property {'ok'|'partial'|'failed'} status
 * @property {string[]} warnings
 * @property {boolean} requiresReopen
 * @property {boolean} noop - true when no gsr-* entries changed (idempotent run)
 */

/**
 * Run the unified sync pipeline.
 * @param {UnifiedSyncOptions} [options]
 * @returns {Promise<UnifiedSyncResult>}
 */
export async function unifiedSync(options = {}) {
  const {
    configPath,
    dryRun = false,
    force = false,
    cwd = process.cwd(),
    targetPath,
    commandsDir,
    claudeCommandsDir,
    projectDir,
    opencodeConfigDir,
  } = options;

  const steps = [];
  const warnings = [];

  // Step 1: contracts
  const contractsStep = await runContractsStep({ dryRun, configPath });
  steps.push(contractsStep);

  // Contracts FAILURE (not skip) is fatal — skip the rest
  if (contractsStep.status === 'failed') {
    // Add placeholder steps in skipped state for clarity
    steps.push(stepSkipped('overlay', 'contracts step failed'));
    steps.push(stepSkipped('apply', 'contracts step failed'));
    steps.push(stepSkipped('commands', 'contracts step failed'));
    steps.push(stepSkipped('claude-code', 'contracts step failed'));
    steps.push(stepSkipped('validate', 'contracts step failed'));

    return {
      steps,
      status: 'failed',
      warnings,
      requiresReopen: false,
    };
  }
  // Contracts SKIPPED (dir missing) is non-fatal — pipeline continues

  // Step 2: overlay
  const overlayStep = await runOverlayStep({ configPath, cwd });
  steps.push(overlayStep);

  // Collect overlay warnings
  if (overlayStep.data?.warnings) {
    warnings.push(...overlayStep.data.warnings);
  }

  const overlayData = overlayStep.status === 'ok'
    ? { agent: overlayStep.data.agent ?? {}, warnings: overlayStep.data.warnings ?? [] }
    : { agent: {}, warnings: [] };

  // Snapshot gsr-* keys BEFORE apply — used to detect real changes for requiresReopen
  let preApplyGsrKeys = new Set();
  if (!dryRun) {
    let resolvedTarget = targetPath;
    if (!resolvedTarget && configPath) {
      resolvedTarget = join(dirname(dirname(configPath)), 'opencode.json');
    } else if (!resolvedTarget) {
      resolvedTarget = null;
    }
    if (resolvedTarget && existsSync(resolvedTarget)) {
      try {
        const existing = JSON.parse(readFileSync(resolvedTarget, 'utf8'));
        preApplyGsrKeys = new Set(
          Object.keys(existing.agent ?? {}).filter(k => k.startsWith('gsr-'))
        );
      } catch {
        preApplyGsrKeys = new Set();
      }
    }
  }

  // Step 3: apply
  const applyStep = await runApplyStep({ overlayData, dryRun, force, targetPath, configPath });
  steps.push(applyStep);

  // Collect apply warnings
  if (applyStep.data?.warnings) {
    warnings.push(...applyStep.data.warnings);
  }

  // Step 4: commands (OpenCode)
  const commandsStep = await runCommandsStep({ dryRun, commandsDir });
  steps.push(commandsStep);

  // Step 5: commands (Claude Code)
  const claudeCodeStep = await runCommandsClaudeCodeStep({ dryRun, claudeCommandsDir });
  steps.push(claudeCodeStep);

  // Step 6: validate
  const validateStep = await runValidateStep({
    overlayData,
    targetPath: applyStep.data?.writtenPath ?? targetPath,
    configPath,
    dryRun,
    preApplyGsrKeys,
  });
  steps.push(validateStep);

  // Step 7: deploy TUI plugin
  const tuiPluginStep = await deployGsrPluginStep({ dryRun, projectDir, opencodeConfigDir });
  steps.push(tuiPluginStep);

  // Derive requiresReopen from validate step
  const requiresReopen = validateStep.data?.requiresReopen === true;

  // noop: no gsr-* entries changed and we are not in dry-run
  // A dry-run is never noop (it didn't attempt to write anything)
  const noop = !dryRun && !requiresReopen && validateStep.status === 'ok' && applyStep.status === 'ok';

  return {
    steps,
    status: aggregateStatus(steps),
    warnings,
    requiresReopen,
    noop,
  };
}
