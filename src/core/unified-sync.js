/**
 * Unified Sync Pipeline
 *
 * Orchestrates the 5-step sync pipeline:
 *   1. contracts  — generate/update .sync-manifest.json
 *   2. overlay    — generate OpenCode overlay from config
 *   3. apply      — merge overlay into opencode.json
 *   4. commands   — deploy gsr-*.md slash commands
 *   5. validate   — readback opencode.json and verify expected agents
 *
 * All steps return structured results; the caller decides what to print.
 * No step throws — failures are captured in the step result.
 *
 * @module unified-sync
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Lazy imports — avoids circular deps, allows test mocking
async function getSyncContracts() {
  const { syncContracts } = await import('./sync.js');
  return syncContracts;
}

async function getOverlayGenerators() {
  const mod = await import('../adapters/opencode/overlay-generator.js');
  return mod;
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

    const writtenPath = writeOpenCodeConfig(merged, resolvedTarget);
    const gsrCount = Object.keys(merged.agent ?? {}).filter(k => k.startsWith('gsr-')).length;

    // Count preserved user overrides from merge warnings
    const preservedCount = (merged.warnings ?? []).filter(
      w => w.includes('user prompt detected')
    ).length;

    return stepOk('apply', {
      writtenPath,
      agentCount: Object.keys(merged.agent ?? {}).length,
      gsrCount,
      preservedCount,
      warnings: merged.warnings ?? [],
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
 * Step 5: Validate — readback opencode.json and compare expected vs actual agents
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

// ── Main pipeline ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} UnifiedSyncOptions
 * @property {string} [configPath]   - router.yaml path (auto-discovered if omitted)
 * @property {boolean} [dryRun]      - Run all steps but don't write files (default: false)
 * @property {boolean} [force]       - Overwrite user entries in opencode.json (default: false)
 * @property {string} [cwd]          - Working dir for identity resolution (default: process.cwd())
 * @property {string} [targetPath]   - Explicit path for opencode.json (used in tests)
 * @property {string} [commandsDir]  - Explicit path for commands dir (used in tests)
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

  // Step 4: commands
  const commandsStep = await runCommandsStep({ dryRun, commandsDir });
  steps.push(commandsStep);

  // Step 5: validate
  const validateStep = await runValidateStep({
    overlayData,
    targetPath: applyStep.data?.writtenPath ?? targetPath,
    configPath,
    dryRun,
    preApplyGsrKeys,
  });
  steps.push(validateStep);

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
