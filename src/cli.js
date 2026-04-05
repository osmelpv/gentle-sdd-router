import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCustomSdd,
  loadCustomSdds,
  loadCustomSdd,
  deleteCustomSdd,
  scaffoldPhaseContract,
  addPhaseInvoke,
  validateSddFull,
  listDeclaredInvocations,
} from './core/sdd-catalog-io.js';
import {
  createInvocation,
  readInvocation,
  listInvocations,
  completeInvocation,
  getInvocationsDir,
} from './core/sdd-invocation-io.js';
import {
  formatConfigPathForDisplay,
  getConfigPath,
  activateOpenCodeCommand,
  applyOpenCodeOverlayCommand,
  bootstrapOpenCodeCommand,
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  discoverConfigPath,
  exportPreset,
  exportPresetCompact,
  exportAllPresets,
  importPresetFromYaml,
  importPresetFromCompact,
  importPresetFromUrl,
  listProfiles,
  loadRouterConfig,
  deactivateOpenCodeCommand,
  installOpenCodeCommand,
  parseYaml,
  planMigrations,
  renderOpenCodeCommand,
  resolveRouterState,
  runMigrations,
  saveRouterConfig,
  setActiveProfile,
  stringifyYaml,
  tryGetConfigPath,
  createProfile,
  deleteProfile,
  renameProfile,
  copyProfile,
  moveProfile,
  listCatalogs,
  createCatalog,
  deleteCatalog,
  getCatalogDisplayName,
  setCatalogEnabled,
  removeOpenCodeOverlay,
  deployGsrCommands,
  removeGsrCommands,
  cleanStaleGlobalOverlay,
  getGlobalSddAgentSpecs,
  DEFAULT_GLOBAL_SDD_PRESET,
  DEFAULT_GLOBAL_DEBUG_PRESET,
  materializeGlobalSddAgents,
  materializeProjectSddAgents,
} from './router-config.js';
import { getPublicPresetMetadata, getActivePublicPresetMetadata } from './core/public-preset-metadata.js';
import { resolveControllerLabel, resolvePersona } from './core/controller.js';
import { resolveIdentity, resetIdentityCache } from './core/agent-identity.js';
import { getSimpleStatus, getVerboseStatus, getUnifiedStatus } from './core/status-reporter.js';
import {
  readFallbackChain,
  readLanePrimary,
  writeFallbackChain,
  promoteFallback,
  formatFallbackList,
  validateModelId,
  getPresetPhases,
  resolveLane,
} from './core/fallback-io.js';

const CURRENT_SCHEMA_VERSION = 4;
let wizardEntrypointForTesting = null;

const COMMANDS_ALLOWED_WITHOUT_INSTALL = new Set([
  'install', 'bootstrap', 'help', '--help', '-h', 'version', '--version', '-v',
  // 'status' handles missing config gracefully and is always useful
  'status',
  'sync',
]);

function safeDiscoverConfigPath() {
  try {
    return discoverConfigPath();
  } catch {
    return null;
  }
}

/**
 * Discover config path using only process.cwd() — not the module dir.
 * Used for pre-install guard so the module's own router.yaml does not
 * shadow a missing user-project config.
 */
function safeDiscoverConfigPathFromCwd() {
  try {
    return discoverConfigPath([process.cwd()]);
  } catch {
    return null;
  }
}

export async function runCli(argv) {
  const [command, ...rest] = argv;

  // Interactive wizard: no command + TTY
  if (!command && process.stdout.isTTY) {
    // Try new TUI first
    if (!wizardEntrypointForTesting) {
      try {
        const { startTui } = await import('./ux/tui/app.js');
        const configPath = safeDiscoverConfigPathFromCwd();
        let config = null;
        if (configPath) {
          try {
            config = loadRouterConfig(configPath);
          } catch { /* fresh install flow */ }
        }
        await startTui(configPath, config);
        return;
      } catch {
        // Fall back to clack wizard
      }
    }

    const runWizard = wizardEntrypointForTesting
      ?? (await import('./ux/wizard.js')).runWizard;
    const configPath = safeDiscoverConfigPathFromCwd();
    let config = null;
    let version = 0;
    if (configPath) {
      try {
        config = loadRouterConfig(configPath);
        version = config.version ?? 0;
      } catch {
        // Invalid config — wizard will handle fresh-project path
      }
    }
    const action = await runWizard({ configPath, config, version });
    if (!action) return;

    if (typeof action === 'string') {
      return runCli([action]);
    }

    // Object actions from wizard sub-flows
    if (action.command === 'use' && action.preset) {
      return runCli(['use', action.preset]);
    }

    if (action.command === 'export') {
      const args = [action.preset];
      if (action.compact) args.push('--compact');
      return runCli(['export', ...args]);
    }

    if (action.command === 'import' && action.source) {
      return runCli(['import', action.source]);
    }

    if (action.command === 'compare') {
      return runCli(['compare', action.left, action.right]);
    }

    if (action.command === 'profile') {
      if (action.subcommand === 'create') return runCli(['profile', 'create', action.name]);
      if (action.subcommand === 'delete') return runCli(['profile', 'delete', action.name]);
      if (action.subcommand === 'rename') return runCli(['profile', 'rename', action.oldName, action.newName]);
      if (action.subcommand === 'copy') return runCli(['profile', 'copy', action.sourceName, action.destName]);
    }

    // Fallback — shouldn't reach here
    return runCli([action.command]);
  }

  if (command === '--help' || command === '-h' || command === 'help' || !command) {
    return runHelp(rest, command);
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    return runVersion();
  }

  // Pre-install guard: block commands that need config when none is found.
  // Uses cwd-only discovery so the module's own router.yaml does not shadow
  // a missing user-project config.
  if (command && !COMMANDS_ALLOWED_WITHOUT_INSTALL.has(command)) {
    const configPath = safeDiscoverConfigPathFromCwd();
    if (!configPath) {
      // Allow 'setup' only for install/bootstrap subcommands
      if (command === 'setup' && (rest[0] === 'install' || rest[0] === 'bootstrap')) {
        // Allow through — setup install/bootstrap create the config
      } else if (command === 'sdd' && rest[0] === 'global-sync') {
        // Allow through — global SDD agent sync is plugin-global, not project-local.
      } else {
        process.stdout.write(
          'Gentle SDD Router is not installed in this project.\n' +
          'Run `gsr install` or `gsr` to start the interactive setup.\n',
        );
        return;
      }
    }
  }

  switch (command) {
    // === Category dispatchers (new tree) ===
    case 'route':
      return runRoute(rest);
    case 'identity':
      return runIdentityCommand(rest);
    case 'preset':
      return runPreset(rest);
    case 'sdd':
      return runSddCommand(rest);
    case 'fallback':
      return runFallbackCommand(rest);
    case 'role':
      return runRoleCommand(rest);
    case 'phase':
      return runPhaseCommand(rest);
    case 'inspect':
      return runInspect(rest);
    case 'setup':
      return runSetup(rest);

    // === Top-level (stay at root) ===
    case 'status':
      return runStatus(rest);

    // === Backward-compat aliases (kept: sync, uninstall, update) ===
    case 'update':
      return runUpdate(rest);
    case 'uninstall':
      return runUninstall(rest);
    case 'sync':
      return await runSync(rest);
    default:
      printUsage();
      if (command) {
        throw new Error(`Unknown command: ${command}`);
      }
  }
}

export function setWizardEntrypointForTesting(runWizard) {
  wizardEntrypointForTesting = runWizard;
}

export function resetWizardEntrypointForTesting() {
  wizardEntrypointForTesting = null;
}

function maybeWarnOutdatedConfig() {
  const configPath = tryGetConfigPath();
  if (!configPath) {
    return;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    // Quick version extraction — avoid full parse for this non-blocking check.
    const match = raw.match(/^version:\s*(\d+)/m);
    if (!match) {
      return;
    }

    const version = parseInt(match[1], 10);
    if (Number.isFinite(version) && version < CURRENT_SCHEMA_VERSION) {
      process.stdout.write(
        `Note: Your router config (version ${version}) can be upgraded to version ${CURRENT_SCHEMA_VERSION}. Run \`gsr update\` for details.\n`,
      );
    }
  } catch {
    // Non-blocking: never fail a command because of this check.
  }
}

function runVersion() {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  process.stdout.write(`gsr v${pkg.version}\n`);
  process.stdout.write(`Tip: check for updates with npm update -g gentle-sdd-router\n`);
}

function runUse(args) {
  const profileName = args[0];
  if (!profileName) {
    throw new Error('gsr use requires a profile name.');
  }

  const configPath = getConfigPath();
  const currentConfig = loadRouterConfig(configPath);
  const nextConfig = setActiveProfile(currentConfig, profileName);
  saveRouterConfig(nextConfig, configPath, currentConfig);

  process.stdout.write(`Active preset set to: ${profileName}\n`);
}

function runReload() {
  maybeWarnOutdatedConfig();
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);

  process.stdout.write(renderStatus(state, configPath, config));
}

function runStatus(args = []) {
  // --verbose is silently ignored (unified status always includes full detail)
  maybeWarnOutdatedConfig();
  const configPath = tryGetConfigPath();

  if (!configPath) {
    process.stdout.write(getUnifiedStatus(null, {}) + '\n');
    return;
  }

  try {
    const config = loadRouterConfig(configPath);
    const routerDir = path.dirname(configPath);
    const catalogsDir = path.join(routerDir, 'catalogs');
    const manifestPath = path.join(routerDir, 'contracts', '.sync-manifest.json');
    const manifestExists = fs.existsSync(manifestPath);

    // Load custom SDDs for SDD CONNECTIONS graph
    let customSdds = [];
    try {
      customSdds = loadCustomSdds(catalogsDir);
    } catch {
      // tolerate missing catalogs dir
    }

    const statusOptions = {
      manifestExists,
      configPath: formatConfigPathForDisplay(configPath),
      routerDir,
      customSdds,
    };

    process.stdout.write(getUnifiedStatus(config, statusOptions) + '\n');
  } catch (error) {
    process.stdout.write(`❌ Configuration error: ${error.message}\n`);
  }
}

function runList() {
  maybeWarnOutdatedConfig();
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const presets = getPublicPresetMetadata(config);

  const activePresetName = config?.active_preset ?? config?.active_profile ?? null;
  if (activePresetName) {
    process.stdout.write(`Active preset: ${activePresetName}\n`);
  }
  process.stdout.write('Presets:\n');
  for (const preset of presets) {
    const tags = buildProfileTags(config, preset.name);
    const tagSuffix = tags.length > 0 ? ` ${tags.map((t) => `[${t}]`).join(' ')}` : '';
    process.stdout.write(`  ${preset.name} (${preset.phases} phases) — ${preset.sdd} (${preset.scope}, ${preset.visibility})${tagSuffix}\n`);
  }
}

function runPreset(args) {
  const [subcommand, ...rest] = args;
  return runProfile([subcommand, ...rest]);
}

function runBrowse(args) {
  maybeWarnOutdatedConfig();
  const selector = args[0] ?? null;
  const config = loadRouterConfig(getConfigPath());
  const report = createMultimodelBrowseContract(config, selector);

  process.stdout.write(renderMultimodelBrowseSurface(report));
}

function runCompare(args) {
  maybeWarnOutdatedConfig();
  const [leftSelector, rightSelector, ...rest] = args;

  if (!leftSelector || !rightSelector || rest.length > 0) {
    printUsage();
    throw new Error('gsr compare requires two selectors in the form <catalog/preset> <catalog/preset>.');
  }

  const config = loadRouterConfig(getConfigPath());
  const report = createMultimodelCompareContract(config, leftSelector, rightSelector);

  process.stdout.write(renderMultimodelCompareSurface(report));
}

function runRender(args) {
  maybeWarnOutdatedConfig();
  const target = args[0];

  if (target !== 'opencode') {
    printUsage();
    throw new Error(target ? `Unknown command: render ${target}` : 'gsr render requires a target.');
  }

  process.stdout.write(renderOpenCodeSurface(renderOpenCodeCommand()));
}

function runInstall(args) {
  const options = parseInstallOptions(args, { apply: true });
  process.stdout.write(renderOpenCodeSurface(installOpenCodeCommand(options)));
}

function runBootstrap(args) {
  const options = parseInstallOptions(args, { apply: false });
  process.stdout.write(renderOpenCodeSurface(bootstrapOpenCodeCommand(options)));
}

function runToggleActivation(nextState, args) {
  if (args.length > 0) {
    printUsage();
    throw new Error(`gsr ${nextState === 'active' ? 'activate' : 'deactivate'} does not take arguments.`);
  }

  const report = nextState === 'active'
    ? activateOpenCodeCommand()
    : deactivateOpenCodeCommand();

  process.stdout.write(renderOpenCodeSurface(report));
}

function runHelp(args, sourceCommand) {
  const topic = args[0];

  if (!topic) {
    process.stdout.write(renderGeneralHelp());
    return;
  }

  const helpText = renderCommandHelp(topic, args[1]);
  if (helpText) {
    process.stdout.write(helpText);
    return;
  }

  process.stdout.write(renderGeneralHelp());
  if (sourceCommand === 'help') {
    throw new Error(`Unknown command: ${topic}`);
  }
}

async function runUpdate(args) {
  const apply = args.includes('--apply');

  const configPath = discoverConfigPath();

  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const plan = planMigrations(routerDir);

  if (plan.pending.length === 0) {
    process.stdout.write(`Your config is up to date (version ${plan.currentVersion}).\n`);
    return;
  }

  process.stdout.write(`Pending migrations (${plan.pending.length}):\n`);
  for (const migration of plan.pending) {
    process.stdout.write(`  [${migration.id}] ${migration.name}: ${migration.description}\n`);
  }

  if (!apply) {
    process.stdout.write(`Run \`gsr update --apply\` to apply these migrations.\n`);
    return;
  }

  const result = await runMigrations(routerDir);

  if (result.applied.length === 0) {
    process.stdout.write('No migrations were applied.\n');
    return;
  }

  process.stdout.write(`Applied migrations:\n`);
  for (let i = 0; i < result.applied.length; i++) {
    const id = result.applied[i];
    const backup = result.backups[i];
    process.stdout.write(`  [${id}] applied successfully\n`);
    if (backup) {
      process.stdout.write(`    Backup: ${backup}\n`);
    }
  }

  process.stdout.write('Config migration complete.\n');
}

async function runApply(args) {
  const target = args[0];

  if (!target) {
    printUsage();
    throw new Error('gsr apply requires a target. Available: opencode');
  }

  if (target !== 'opencode') {
    printUsage();
    throw new Error(`Unknown apply target: ${target}. Available: opencode`);
  }

  const applyFlag = args.includes('--apply');
  const configPath = safeDiscoverConfigPath();

  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const report = applyOpenCodeOverlayCommand({
    apply: applyFlag,
    configPath,
  });

  const agentCount = Object.keys(report.agents).length;

  if (agentCount === 0) {
    process.stdout.write('No presets with orchestrator phase found — overlay would be empty.\n');
    return;
  }

  process.stdout.write(`OpenCode overlay: ${agentCount} agent(s) from router profiles\n`);
  process.stdout.write('\n');

  for (const [name, agent] of Object.entries(report.agents)) {
    const tools = agent.tools ?? {};
    const restricted = !tools.write || !tools.edit || !tools.bash;
    const hiddenTag = agent.hidden ? ' [hidden]' : '';
    const restrictedTag = restricted ? ' [restricted]' : '';
    process.stdout.write(`  ${name} — ${agent.description}${restrictedTag}${hiddenTag}\n`);
  }

  if (report.warnings.length > 0) {
    process.stdout.write('\n');
    for (const warning of report.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
  }

  if (!applyFlag) {
    process.stdout.write('\n');
    const projectRoot = configPath ? path.dirname(path.dirname(configPath)) : process.cwd();
    const localOpenCodePath = path.join(projectRoot, 'opencode.json');
    process.stdout.write(`Run \`gsr apply opencode --apply\` to write to ${localOpenCodePath}\n`);
    return;
  }

  // Clean stale gsr-* entries from global opencode.json (migration from pre-project-isolation behavior)
  try { cleanStaleGlobalOverlay(); } catch { /* non-blocking */ }

  process.stdout.write('\n');
  process.stdout.write(`Written to: ${report.writtenPath}\n`);

  // Also deploy /gsr-* slash command files (OpenCode)
  try {
    const cmdResult = deployGsrCommands();
    if (cmdResult.written > 0) {
      process.stdout.write(`Deployed ${cmdResult.written} /gsr command(s) to ${cmdResult.targetDir}\n`);
    }
    if (cmdResult.skipped > 0) {
      process.stdout.write(`${cmdResult.skipped} command(s) already up to date.\n`);
    }
  } catch {
    // Non-blocking: overlay is the priority
  }

  // Deploy /gsr-* slash command files to Claude Code (~/.claude/commands/)
  try {
    const { deployGsrCommandsClaudeCode } = await import('./adapters/claude-code/command-deployer.js');
    const claudeResult = await deployGsrCommandsClaudeCode();
    if (claudeResult.deployed > 0) {
      process.stdout.write(`Deployed ${claudeResult.deployed} /gsr command(s) to Claude Code (${claudeResult.targetDir})\n`);
    }
  } catch {
    // Non-blocking: Claude Code may not be installed
  }
}

function runExport(args) {
  const compact = args.includes('--compact');
  const outIndex = args.indexOf('--out');
  const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
  const allFlag = args.includes('--all');

  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);

  if (allFlag) {
    const presetMap = exportAllPresets(config);
    if (presetMap.size === 0) {
      process.stdout.write('No presets found to export.\n');
      return;
    }

    for (const [name, yaml] of presetMap) {
      const output = compact ? `${name}: ${exportPresetCompact(config, name)}\n` : `# preset: ${name}\n${yaml}\n---\n`;
      process.stdout.write(output);
    }

    return;
  }

  // Single preset export
  const presetName = args.find((arg) => !arg.startsWith('--') && arg !== outPath);
  if (!presetName) {
    printUsage();
    throw new Error('gsr export requires a preset name or --all.');
  }

  const output = compact
    ? exportPresetCompact(config, presetName) + '\n'
    : exportPreset(config, presetName) + '\n';

  if (outPath) {
    fs.writeFileSync(outPath, output, 'utf8');
    process.stdout.write(`Exported preset '${presetName}' to: ${outPath}\n`);
  } else {
    process.stdout.write(output);
  }
}

async function runSync(args = []) {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const { unifiedSync } = await import('./core/unified-sync.js');

  // Discover the local config path so unified-sync finds the right contracts dir
  const configPath = safeDiscoverConfigPath();

  try {
    const result = await unifiedSync({ configPath, dryRun, force });
    printSyncSummary(result, dryRun);

    if (result.status === 'failed') {
      const contractsStep = result.steps.find(s => s.name === 'contracts');
      const errMsg = contractsStep?.error ?? 'Unknown error';
      process.stdout.write(`Sync failed: ${errMsg}\n`);
    }
  } catch (err) {
    process.stdout.write(`Sync failed: ${err.message}\n`);
  }
}

/**
 * Print a human-readable summary of a unified sync result.
 * Shared between direct sync and auto-wiring paths.
 * @param {import('./core/unified-sync.js').UnifiedSyncResult} result
 * @param {boolean} [dryRun]
 */
function printSyncSummary(result, dryRun = false) {
  if (result.status === 'failed') {
    // Fatal failure — the caller will print the specific error
    return;
  }

  const prefix = dryRun ? '[dry-run] ' : '';

  // Contracts step
  const contractsStep = result.steps.find(s => s.name === 'contracts');
  if (contractsStep?.status === 'ok' && contractsStep.data) {
    const { roles = 0, phases = 0, total = 0 } = contractsStep.data;
    process.stdout.write(`${prefix}Synced ${roles} role contracts + ${phases} phase compositions (${total} total).\n`);
    if (contractsStep.data.manifestPath) {
      process.stdout.write(`${prefix}Manifest: ${contractsStep.data.manifestPath}\n`);
    }
  } else if (contractsStep?.status === 'skipped') {
    // Fix 1: contracts dir missing → graceful skip with warning
    process.stdout.write(`${prefix}Warning: ${contractsStep.data?.reason ?? 'Contracts directory not found — skipping global contracts'}\n`);
  }

  // Apply step — agent count and breakdown
  const applyStep = result.steps.find(s => s.name === 'apply');
  if (applyStep?.status === 'ok' && applyStep.data) {
    const gsrCount = applyStep.data.gsrCount ?? 0;
    if (dryRun) {
      // W2: dry-run reports create/update/preserve breakdown
      const wouldCreate = applyStep.data.wouldCreate ?? 0;
      const wouldUpdate = applyStep.data.wouldUpdate ?? 0;
      const wouldPreserve = applyStep.data.wouldPreserve ?? 0;
      process.stdout.write(
        `${prefix}Would create: ${wouldCreate}, Would update: ${wouldUpdate}, Would preserve: ${wouldPreserve} user overrides.\n`
      );
    } else if (gsrCount > 0) {
      process.stdout.write(`${prefix}${gsrCount} agent(s) synced to opencode.json.\n`);
    } else {
      process.stdout.write(`${prefix}No agents generated — all catalogs disabled or no presets.\n`);
    }
    if (applyStep.data.writtenPath) {
      process.stdout.write(`${prefix}Written: ${applyStep.data.writtenPath}\n`);
    }

    // W3: report preserved user overrides count
    const preservedCount = applyStep.data.preservedCount ?? 0;
    if (!dryRun && preservedCount > 0) {
      process.stdout.write(`${prefix}Preserved ${preservedCount} user-modified entries.\n`);
    }
  }

  // Commands step
  const commandsStep = result.steps.find(s => s.name === 'commands');
  if (commandsStep?.status === 'ok' && commandsStep.data && !commandsStep.data.dryRun) {
    const { written = 0, skipped = 0 } = commandsStep.data;
    process.stdout.write(`${prefix}Commands: ${written} written, ${skipped} already up to date.\n`);
  }

  // Warnings (non-preserve warnings only; preserved count is reported above)
  for (const warn of result.warnings ?? []) {
    if (!warn.includes('user prompt detected')) {
      process.stdout.write(`${prefix}Warning: ${warn}\n`);
    }
  }

  // Reopen / noop / synchronized notice
  if (result.requiresReopen) {
    process.stdout.write(`${prefix}Synchronized. Reopen editor to activate new agents.\n`);
  } else if (!dryRun && result.noop) {
    // W1: noop — second run with no changes
    process.stdout.write(`${prefix}Already up to date.\n`);
  } else if (result.status === 'ok' && !dryRun) {
    process.stdout.write(`${prefix}Synchronized.\n`);
  } else if (dryRun) {
    process.stdout.write(`${prefix}Dry-run complete — no files written.\n`);
  }
}

async function runImport(args) {
  if (args.length === 0) {
    printUsage();
    throw new Error('gsr import requires a source: file path, URL (https://), or --compact <string>.');
  }

  const force = args.includes('--force');
  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex !== -1 ? args[catalogIndex + 1] : undefined;

  const options = { force, catalog };

  // Find the config path to get routerDir
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);

  // Determine the source type
  const compactFlagIndex = args.indexOf('--compact');
  let result;

  if (compactFlagIndex !== -1) {
    // --compact <string>
    const compactStr = args[compactFlagIndex + 1];
    if (!compactStr) {
      throw new Error('gsr import --compact requires a compact string after the flag.');
    }

    result = importPresetFromCompact(compactStr, routerDir, options);
  } else {
    // First non-flag argument is the source
    const source = args.find((arg) => !arg.startsWith('--') && arg !== catalog);

    if (!source) {
      printUsage();
      throw new Error('gsr import requires a source: file path, URL (https://), or --compact <string>.');
    }

    if (source.startsWith('gsr://')) {
      // Compact string passed as positional argument
      result = importPresetFromCompact(source, routerDir, options);
    } else if (source.startsWith('https://')) {
      // URL import
      result = await importPresetFromUrl(source, routerDir, options);
    } else {
      // File import
      const yaml = fs.readFileSync(source, 'utf8');
      result = importPresetFromYaml(yaml, routerDir, options);
    }
  }

  const catalogLabel = result.catalog !== 'default' ? ` (catalog: ${result.catalog})` : '';
  process.stdout.write(`Imported preset '${result.presetName}'${catalogLabel} → ${result.path}\n`);
}

/**
 * Return display tags for a profile (e.g. 'local', 'budget').
 * Reads from the raw assembled config.
 */
function buildProfileTags(config, profileName) {
  const tags = [];

  // In v3/v4-assembled configs, look up the preset by name.
  if (config?.version === 3 && config.catalogs) {
    for (const [, catalog] of Object.entries(config.catalogs)) {
      const presetName = profileName.includes('/') ? profileName.split('/')[1] : profileName;
      const preset = catalog.presets?.[presetName];
      if (!preset) continue;

      // Explicit labels array
      if (Array.isArray(preset.labels)) {
        tags.push(...preset.labels);
      }

      // Infer 'local' when all first-lane targets use the ollama/ provider
      if (!tags.includes('local')) {
        const phases = preset.phases ?? {};
        const targets = Object.values(phases).map((lanes) => {
          const first = Array.isArray(lanes) ? lanes[0] : null;
          return typeof first?.target === 'string' ? first.target : null;
        }).filter(Boolean);
        if (targets.length > 0 && targets.every((t) => t.startsWith('ollama/'))) {
          tags.push('local');
        }
      }

      // Infer 'budget' from profile name containing 'cheap' or 'budget'
      const lowerName = presetName.toLowerCase();
      if (!tags.includes('budget') && (lowerName.includes('cheap') || lowerName.includes('budget'))) {
        tags.push('budget');
      }

      break;
    }
  }

  return tags;
}

/**
 * Look up the context window (max tokens) for a phase's primary lane
 * from the raw assembled config (v3/v4 assembled).
 * Returns null if no contextWindow data is available.
 */
function lookupLaneContextWindow(config, activeCatalogName, activePresetName, phaseName) {
  if (!config?.catalogs) return null;

  const catalog = config.catalogs[activeCatalogName];
  if (!catalog) return null;

  const preset = catalog.presets?.[activePresetName];
  if (!preset) return null;

  const lanes = preset.phases?.[phaseName];
  if (!Array.isArray(lanes) || lanes.length === 0) return null;

  const lane = lanes[0];
  const contextWindow = lane?.contextWindow;

  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return null;

  return contextWindow;
}

/**
 * Format a context window value as a human-readable string (e.g. "200K", "1M").
 */
function formatContextWindow(contextWindow) {
  if (!contextWindow) return null;
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

/**
 * Look up pricing fields (inputPerMillion, outputPerMillion) for a phase
 * from the raw assembled config (v3/v4 assembled).
 * Returns null if no pricing data is available.
 */
function lookupLanePricing(config, activeCatalogName, activePresetName, phaseName) {
  if (!config?.catalogs) return null;

  const catalog = config.catalogs[activeCatalogName];
  if (!catalog) return null;

  const preset = catalog.presets?.[activePresetName];
  if (!preset) return null;

  const lanes = preset.phases?.[phaseName];
  if (!Array.isArray(lanes) || lanes.length === 0) return null;

  const lane = lanes[0];
  const input = lane?.inputPerMillion;
  const output = lane?.outputPerMillion;

  // Accept both number and numeric-string values (YAML parser returns floats as strings).
  const isNumeric = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

  if (!isNumeric(input) && !isNumeric(output)) return null;

  return { inputPerMillion: isNumeric(input) ? Number(input) : null, outputPerMillion: isNumeric(output) ? Number(output) : null };
}

/**
 * Format pricing as "$IN/$OUT" string. Rounds to reasonable precision.
 */
function formatPricing(pricing) {
  if (!pricing) return null;

  const fmt = (n) => {
    if (n === null || n === undefined) return '?';
    const num = Number(n);
    if (!Number.isFinite(num)) return '?';
    if (num === 0) return '$0';
    if (num < 1) return `$${num}`;
    return `$${num.toFixed(2).replace(/\.00$/, '')}`;
  };

  return `${fmt(pricing.inputPerMillion)}/${fmt(pricing.outputPerMillion)}`;
}

function renderStatus(state, configPath, config = null) {
  const controllerLabel = resolveControllerLabel();
  const activation = state.activationState === 'active' || state.activationState === true
    ? {
        state: 'active',
        effectiveController: 'gsr',
      }
    : {
        state: 'inactive',
        effectiveController: controllerLabel,
      };
  // If the loaded config has _v4Source, it was originally a v4 multi-file config.
  // resolveRouterState assembles it as v3, so we must detect v4 from the source config.
  const isV4Source = config !== null && Object.getOwnPropertyDescriptor(config, '_v4Source') !== undefined;
  const schemaVersion = isV4Source ? 4 : (state.schemaVersion ?? state.version);
  const lines = [
    'Installed: yes',
    `In control: ${activation.effectiveController}`,
    `Activation: ${activation.state}`,
    `Toggle control: ${activation.state === 'active' ? 'gsr deactivate' : 'gsr activate'}`,
    `Schema: v${schemaVersion}`,
  ];

  if (state.selectedCatalogName) {
    lines.push(`Selected catalog: ${state.selectedCatalogName}`);
  }

  if (state.selectedPresetName) {
    lines.push(`Selected preset: ${state.selectedPresetName}`);
  }

  if (Array.isArray(state.laneRoles) && state.laneRoles.length > 0) {
    lines.push(`Lane roles: ${state.laneRoles.join(' / ')}`);
  }

  lines.push(
    schemaVersion === 3
      ? `Active preset: ${state.activeProfileName}`
      : `Active profile: ${state.activeProfileName}`,
    `Config: ${formatConfigPathForDisplay(configPath)}`,
    `Version: ${state.version}`,
    'Resolved routes:',
  );

  if (Array.isArray(state.compatibilityNotes) && state.compatibilityNotes.length > 0) {
    lines.push('Compatibility notes:');
    for (const note of state.compatibilityNotes) {
      lines.push(`- ${note}`);
    }
  }

  // Resolved routes with optional pricing
  const activeCatalogName = state.selectedCatalogName ?? null;
  const activePresetName = state.selectedPresetName ?? state.activeProfileName ?? null;

  for (const [phaseName, route] of Object.entries(state.resolvedPhases)) {
    const pricing = lookupLanePricing(config, activeCatalogName, activePresetName, phaseName);
    const contextWindow = lookupLaneContextWindow(config, activeCatalogName, activePresetName, phaseName);
    const pricingStr = pricing ? ` (${formatPricing(pricing)})` : '';
    const ctxStr = contextWindow ? ` [${formatContextWindow(contextWindow)} ctx]` : '';
    lines.push(`- ${phaseName}: ${formatRoute(route.active)}${pricingStr}${ctxStr}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderMissingStatus() {
  const controllerLabel = resolveControllerLabel();
  return [
    'Installed: no',
    `In control: ${controllerLabel}`,
    'Activation: inactive',
    'Toggle control: gsr activate',
    'Active profile: unavailable',
    'Config: missing',
    'Status: unavailable',
    'Reason: router/router.yaml is not available in the current context or next to the module.',
  ].join('\n') + '\n';
}

/**
 * Render a simplified, user-friendly status line.
 * Shows status indicator, active preset, and a one-liner message.
 * Does NOT expose overlay mechanics, routes, costs, or internal details.
 *
 * @param {import('./core/status-reporter.js').SimpleStatusResult} simple
 * @param {string|null} configPath
 * @param {object|null} config
 * @returns {string}
 */
function renderSimpleStatus(simple, configPath, config) {
  const lines = [];

  // Status indicator line
  lines.push(`${simple.emoji} ${simple.message}`);

  // Active preset (if available)
  if (config?.active_preset) {
    lines.push(`Preset: ${config.active_preset}`);
  }

  // Activation state
  if (config?.activation_state) {
    const state = config.activation_state;
    lines.push(`Activation: ${state}`);
  }

  // Hint for more details
  lines.push('Run `gsr status --verbose` for full details.');

  return lines.join('\n');
}

function renderInvalidStatus(configPath, error) {
  const message = error instanceof Error ? error.message : String(error);

  return [
    'Installed: yes',
    'In control: unknown',
    'Activation: unknown',
    'Toggle control: unavailable',
    'Active profile: unknown',
    `Config: ${formatConfigPathForDisplay(configPath)}`,
    'Status: invalid',
    `Reason: ${message}`,
  ].join('\n') + '\n';
}

async function runProfile(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return runList();
    case 'show':
      return runReload();
    case 'create':
      return runProfileCreate(rest);
    case 'delete':
      return runProfileDelete(rest);
    case 'rename':
      return runProfileRename(rest);
    case 'copy':
      return runProfileCopy(rest);
    case 'export':
      return runExport(rest);
    case 'import':
      return await runImport(rest);
    case 'move':
      return runCatalogMove(rest);
    default:
      if (subcommand === 'help' || subcommand === '--help' || !subcommand) {
        process.stdout.write(renderCommandHelp('preset') ?? '');
        return;
      }
      printUsage();
      throw new Error(subcommand ? `Unknown preset command: ${subcommand}` : 'gsr preset requires a subcommand.');
  }
}

async function runCatalog(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return runCatalogList(rest);
    case 'create':
      return await runCatalogCreate(rest);
    case 'delete':
      return runCatalogDelete(rest);
    case 'enable':
      return await runCatalogEnable(rest);
    case 'disable':
      return await runCatalogDisable(rest);
    case 'move':
      return runCatalogMove(rest);
    case 'use':
      return runCatalogUse(rest);
    default:
      if (subcommand === 'help' || subcommand === '--help' || !subcommand) {
        process.stdout.write(renderCommandHelp('catalog') ?? '');
        return;
      }
      printUsage();
      throw new Error(subcommand ? `Unknown catalog command: ${subcommand}` : 'gsr catalog requires a subcommand.');
  }
}

async function runProfileCreate(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr preset create requires a preset name.');
  }

  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex !== -1 ? args[catalogIndex + 1] : undefined;
  const targetIndex = args.indexOf('--target');
  const target = targetIndex !== -1 ? args[targetIndex + 1] : undefined;

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = createProfile(name, routerDir, { catalog, target });
  const catalogLabel = result.catalog !== 'default' ? ` (catalog: ${result.catalog})` : '';
  process.stdout.write(`Created preset '${result.presetName}'${catalogLabel} → ${result.path}\n`);

  // Auto-trigger unified sync after successful profile creation (REQ-7)
  try {
    const { unifiedSync } = await import('./core/unified-sync.js');
    const syncResult = await unifiedSync({ configPath });
    printSyncSummary(syncResult);
    if (syncResult.status === 'failed') {
      process.stdout.write('Note: Sync after profile create failed — run `gsr sync` manually.\n');
    }
  } catch (err) {
    // Non-blocking: profile creation succeeded; sync failure is a soft warning
    process.stdout.write(`Note: Sync after profile create failed: ${err.message}\n`);
  }
}

function runProfileDelete(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr preset delete requires a preset name.');
  }

  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex !== -1 ? args[catalogIndex + 1] : undefined;

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = deleteProfile(name, routerDir, { catalog });
  process.stdout.write(`Deleted preset '${result.presetName}' from ${result.path}\n`);
}

function runProfileRename(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const oldName = positional[0];
  const newName = positional[1];

  if (!oldName || !newName) {
    printUsage();
    throw new Error('gsr preset rename requires <old-name> <new-name>.');
  }

  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex !== -1 ? args[catalogIndex + 1] : undefined;

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = renameProfile(oldName, newName, routerDir, { catalog });
  process.stdout.write(`Renamed preset '${result.oldName}' → '${result.newName}' (${result.path})\n`);
}

function runProfileCopy(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const sourceName = positional[0];
  const destName = positional[1];

  if (!sourceName || !destName) {
    printUsage();
    throw new Error('gsr preset copy requires <source> <dest>.');
  }

  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex !== -1 ? args[catalogIndex + 1] : undefined;

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = copyProfile(sourceName, destName, routerDir, { catalog });
  process.stdout.write(`Copied preset '${result.sourceName}' → '${result.destName}' (${result.path})\n`);
}

function runCatalogList(_args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const config = loadRouterConfig(configPath);
  const catalogs = listCatalogs(routerDir);

  process.stdout.write('Preset sources (legacy):\n');
  for (const cat of catalogs) {
    const meta = config.catalogs?.[cat.name];
    const displayLabel = getCatalogDisplayName(cat.name, meta);
    const visibility = meta?.enabled === false ? 'hidden' : 'visible';
    process.stdout.write(`  ${displayLabel} [${visibility}] (${cat.profileCount} preset(s))\n`);
  }
}

async function runCatalogCreate(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr catalog create requires a catalog name.');
  }

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = createCatalog(name, routerDir);
  process.stdout.write(`Created preset source '${result.name}' at ${result.path}\n`);

  // Auto-enable + trigger unified sync (REQ-6)
  try {
    setCatalogEnabled(name, true, routerDir);
    const { unifiedSync } = await import('./core/unified-sync.js');
    const syncResult = await unifiedSync({ configPath });
    printSyncSummary(syncResult);
    if (syncResult.status === 'failed') {
      process.stdout.write('Note: Sync after catalog create failed — add profiles to make agents available.\n');
    }
  } catch (err) {
    // Non-blocking: catalog create succeeded; sync failure is a soft warning
    process.stdout.write(`Note: Sync after catalog create failed: ${err.message}\n`);
  }
}

function runCatalogDelete(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr catalog delete requires a catalog name.');
  }

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  const result = deleteCatalog(name, routerDir);
  process.stdout.write(`Deleted preset source '${result.name}' from ${result.path}\n`);
}

async function runCatalogEnable(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr catalog enable requires a catalog name.');
  }
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr setup install` first.\n');
    return;
  }
  const routerDir = path.dirname(configPath);
  setCatalogEnabled(name, true, routerDir);
  process.stdout.write(`Preset source '${name}' is now visible.\n`);

  // Auto-sync after enable (REQ-6)
  try {
    const { unifiedSync } = await import('./core/unified-sync.js');
    const syncResult = await unifiedSync({ configPath });
    printSyncSummary(syncResult);
  } catch (err) {
    process.stdout.write(`Note: Sync after catalog enable failed: ${err.message}\n`);
  }
}

async function runCatalogDisable(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr catalog disable requires a catalog name.');
  }
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr setup install` first.\n');
    return;
  }
  const routerDir = path.dirname(configPath);
  setCatalogEnabled(name, false, routerDir);
  process.stdout.write(`Preset source '${name}' is now hidden.\n`);

  // Auto-sync after disable to remove agents from opencode.json (REQ-6)
  try {
    const { unifiedSync } = await import('./core/unified-sync.js');
    const syncResult = await unifiedSync({ configPath });
    printSyncSummary(syncResult);
  } catch (err) {
    process.stdout.write(`Note: Sync after catalog disable failed: ${err.message}\n`);
  }
}

function runCatalogMove(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  const targetCatalog = positional[1];

  if (!name || !targetCatalog) {
    printUsage();
    throw new Error('gsr catalog move requires: gsr catalog move <preset> <target-source>');
  }

  const fromIndex = args.indexOf('--from');
  const sourceCatalog = fromIndex !== -1 ? args[fromIndex + 1] : undefined;

  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }
  const routerDir = path.dirname(configPath);
  const result = moveProfile(name, targetCatalog, routerDir, { sourceCatalog });
  process.stdout.write(`Moved preset '${result.name}' from '${result.from}' to '${result.to}'\n`);
}

function runCatalogUse(args) {
  const catalogName = args[0];
  const presetOverride = args[1]; // optional
  if (!catalogName) {
    printUsage();
    throw new Error('gsr catalog use requires a source name.');
  }
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const config = loadRouterConfig(configPath);

  // Verify catalog exists
  if (!config.catalogs?.[catalogName]) {
    throw new Error(`Source '${catalogName}' not found.`);
  }

  // Determine which preset to activate
  const preset = presetOverride
    ?? config.catalogs[catalogName]?.active_preset
    ?? Object.keys(config.catalogs[catalogName]?.presets ?? {})[0]
    ?? null;

  if (!preset) {
    throw new Error(`Source '${catalogName}' has no presets.`);
  }

  // Update router.yaml
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = parseYaml(raw);
  parsed.active_catalog = catalogName;
  parsed.active_preset = preset;
  const yaml = stringifyYaml(parsed);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, yaml, 'utf8');
  fs.renameSync(tempPath, configPath);

  process.stdout.write(`Active SDD source: ${catalogName}\nActive preset: ${preset}\n`);
}

// === CATEGORY DISPATCHERS ===

function runRoute(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'use': return runUse(rest);
    case 'show': return runReload();
    case 'activate': return runToggleActivation('active', rest);
    case 'deactivate': return runToggleActivation('inactive', rest);
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('route') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown route command: ${sub}` : 'gsr route requires a subcommand.');
  }
}

function runInspect(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'browse': return runBrowse(rest);
    case 'compare': return runCompare(rest);
    case 'render': return runRender(rest);
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('inspect') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown inspect command: ${sub}` : 'gsr inspect requires a subcommand.');
  }
}

function runSetup(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'install': return runInstall(rest);
    case 'uninstall': return runUninstall(rest);
    case 'bootstrap': return runBootstrap(rest);
    case 'update': return runUpdate(rest);
    case 'apply': return runApply(rest);
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('setup') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown setup command: ${sub}` : 'gsr setup requires a subcommand.');
  }
}

function runUninstall(args) {
  const confirm = args.includes('--confirm');
  const configPath = safeDiscoverConfigPathFromCwd();

  // Step 1: Remove project-local overlay (project-isolation: each project owns its opencode.json)
  // Commands (/gsr-*.md) are global npm package files and must NOT be removed on project uninstall.
  if (configPath) {
    const projectRoot = path.dirname(path.dirname(configPath));
    const localOpenCodePath = path.join(projectRoot, 'opencode.json');
    const overlayResult = removeOpenCodeOverlay(localOpenCodePath);
    if (overlayResult.removedCount > 0) {
      process.stdout.write(`Removed ${overlayResult.removedCount} gsr-* agent(s) from ${overlayResult.path}\n`);
    } else {
      process.stdout.write('No gsr-* entries found in opencode.json.\n');
    }
    // Also clean stale entries from global opencode.json (migration cleanup)
    try { cleanStaleGlobalOverlay(); } catch { /* non-blocking */ }
  } else {
    process.stdout.write('No gsr-* entries found in opencode.json.\n');
  }

  // Step 2: Remove router/ directory from the project
  if (!configPath) {
    process.stdout.write('No router config found in this project — nothing else to remove.\n');
    return;
  }

  const routerDir = path.dirname(configPath);
  if (!confirm) {
    process.stdout.write(`\nThis will delete: ${routerDir}/\n`);
    process.stdout.write('All profiles, backups, and migration state will be lost.\n');
    process.stdout.write('Run again with --confirm to proceed:\n');
    process.stdout.write('  gsr setup uninstall --confirm\n');
    return;
  }

  // Backup before deleting
  const backupDir = path.join(path.dirname(routerDir), '.router-backup-' + Date.now());
  fs.cpSync(routerDir, backupDir, { recursive: true });
  process.stdout.write(`Backup created: ${backupDir}\n`);

  fs.rmSync(routerDir, { recursive: true, force: true });
  process.stdout.write(`Removed: ${routerDir}/\n`);
  process.stdout.write('gsr has been fully uninstalled from this project.\n');
}

function printUsage() {
  process.stdout.write(renderGeneralHelp());
}

function renderGeneralHelp() {
  const controllerLabel = resolveControllerLabel();
  return [
    'Usage: gsr <command> [args]',
    'Router boundary: external, non-executing. Use gsr to inspect or update router/router.yaml.',
    'external router boundary, non-executing.',
    'Host sync: /gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing.',
    'Multimodel browse/compare expose shareable schema v3 metadata only.',
    'Compatibility: router.yaml versions 1, 3, and 4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format.',
    'Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing.',
    '',
    'Quick start:',
    '  gsr status                See current state.',
    '  gsr route use <preset>    Switch model routing.',
    '  gsr setup install         First-time setup.',
    '',
    'Commands:',
    '  status                    Show current router status. Use --verbose or --debug for full details.',
    '  version                   Installed gsr version.',
    '  help [command]            Help for a command or subcommand.',
    '  sync                      Push global contracts to Engram (dev/repair).',
    '',
    '  route                     Control which models serve each phase.',
    '    use <preset>            Select the active preset in router/router.yaml without changing who is in control.',
    '    show                    Show resolved routes for current preset.',
    '    activate                gsr takes control of routing.',
    `    deactivate              Hand control back to ${controllerLabel} without changing the active profile.`,
    '',
    '  preset                    Manage routing presets (canonical public term).',
    '    list                    List available presets and mark the active one.',
    '    create <name>           Create an empty preset.',
    '    delete <name>           Delete a preset.',
    '    rename <old> <new>      Rename a preset.',
    '    copy <src> <dest>       Clone a preset.',
    '    export <name>           Export for sharing (--compact for gsr:// string).',
    '    import <source>         Import from file, URL, or gsr:// string.',
    '  profile                   Legacy alias for preset commands.',
    '',
    '  fallback                  Manage per-agent/per-lane fallback chains.',
    '    list <preset> [phase]   List fallback chains for a preset.',
    '    add <preset> <phase> <model>  Append a model to the fallback chain.',
    '    remove <preset> <phase> <index>  Remove by 1-based index.',
    '    move <preset> <phase> <from> <to>  Reorder entries (1-based).',
    '    set <preset> <phase> <model,model,...>  Replace entire chain.',
    '    promote <preset> <phase> <index>  Promote fallback to primary.',
    '',
    '  catalog                   Legacy/advanced compatibility commands (scheduled for removal).',
    '',
    '  inspect                   Read-only views of metadata and boundaries.',
    '    browse [selector]       Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
    '    compare <a> <b>         Side-by-side preset comparison.',
    '    render <target>         Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    '',
    '  setup                     Install, configure, and maintain gsr.',
    '    install                 Inspect or apply a YAML-first install intent to router/router.yaml.',
    '    uninstall               Remove gsr from this project (overlay + router/ with backup).',
    '    bootstrap               Show or apply a step-by-step bootstrap path for adoption.',
    '    update                  Show/apply config migrations (--apply).',
    '    apply <target>          Generate TUI overlay (--apply to write).',
    '',
    'Backward-compat aliases (kept at root for compatibility):',
    '    update              Show/apply config migrations.',
    '    uninstall           Remove gsr from this project.',
    '    sync                Push global contracts to Engram.',
  ].join('\n') + '\n';
}

function renderCommandHelp(topic, subtopic) {
  const normalized = topic.toLowerCase();

  if (normalized === 'use') {
    return [
      'Usage: gsr use <profile>',
      'Select the active profile in router/router.yaml without changing who is in control.',
    ].join('\n') + '\n';
  }

  if (normalized === 'reload') {
    return [
      'Usage: gsr reload',
      'Reload the current config and print the resolved routes.',
    ].join('\n') + '\n';
  }

  if (normalized === 'status') {
    return [
      'Usage: gsr status',
      'Show who is in control, how to toggle it, the active profile, and resolved routes.',
    ].join('\n') + '\n';
  }

  if (normalized === 'list') {
    return [
      'Usage: gsr list',
      'List available profiles and mark the active one.',
    ].join('\n') + '\n';
  }

  if (normalized === 'browse') {
    return [
      'Usage: gsr browse [selector]',
      'Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
    ].join('\n') + '\n';
  }

  if (normalized === 'compare') {
    return [
      'Usage: gsr compare <left> <right>',
      'Compare two shareable multimodel projections without recommending or executing anything.',
    ].join('\n') + '\n';
  }

  if (normalized === 'render' && subtopic === 'opencode') {
    return [
      'Usage: gsr render opencode',
      'Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    ].join('\n') + '\n';
  }

  if (normalized === 'activate' || normalized === 'deactivate') {
    const controllerLabel = resolveControllerLabel();
    return [
      `Usage: gsr ${normalized}`,
      normalized === 'activate'
        ? 'Take control of routing without changing the active profile.'
        : `Hand control back to ${controllerLabel} without changing the active profile.`,
    ].join('\n') + '\n';
  }

  if (normalized === 'render') {
    if (subtopic && subtopic !== 'opencode') {
      return null;
    }

    return [
      `Usage: gsr ${normalized} opencode`,
      'Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    ].join('\n') + '\n';
  }

  if (normalized === 'install') {
    return [
      'Usage: gsr install [--intent <spec>] [--profile <name>] [--activation active|inactive] [--phase <name> --chain <models>] [--no-apply]',
      'Inspect or apply a YAML-first install intent to router/router.yaml.',
    ].join('\n') + '\n';
  }

  if (normalized === 'bootstrap') {
    return [
      'Usage: gsr bootstrap [--intent <spec>] [--profile <name>] [--activation active|inactive] [--phase <name> --chain <models>] [--apply]',
      'Show or apply a step-by-step bootstrap path for adoption.',
    ].join('\n') + '\n';
  }

  if (normalized === 'update') {
    return [
      'Usage: gsr update [--apply]',
      'Show pending config migrations. Use --apply to actually apply them.',
    ].join('\n') + '\n';
  }

  if (normalized === 'apply') {
    return [
      'Usage: gsr apply <target> [--apply]',
      'Generate and apply a configuration overlay for a TUI target.',
      'Targets: opencode',
      '  gsr apply opencode          Preview the generated OpenCode overlay (dry-run).',
      '  gsr apply opencode --apply  Write overlay to ./opencode.json in the project root.',
      'Only gsr-* agent keys are created/modified; all other opencode.json keys are preserved.',
    ].join('\n') + '\n';
  }

  if (normalized === 'version') {
    return [
      'Usage: gsr version',
      'Show the installed gsr version.',
    ].join('\n') + '\n';
  }

  if (normalized === 'export') {
    return [
      'Usage: gsr export <preset> [--compact] [--out <path>]',
      '       gsr export --all [--compact]',
      'Export a preset to stdout, a file, or as a compact gsr:// string for sharing.',
      '  <preset>       Name of the preset to export.',
      '  --all          Export all presets.',
      '  --compact      Output as a compact gsr:// string (base64-encoded gzip).',
      '  --out <path>   Write output to a file instead of stdout.',
    ].join('\n') + '\n';
  }

  if (normalized === 'import') {
    return [
      'Usage: gsr import <source> [--catalog <name>] [--force]',
      '       gsr import --compact <string> [--catalog <name>] [--force]',
      'Import a preset from a file, HTTPS URL, or compact gsr:// string.',
      '  <source>         File path, https:// URL, or gsr:// compact string.',
      '  --compact <str>  Import from a compact gsr:// string.',
      '  --catalog <name> Place the imported preset in a named catalog subdirectory.',
      '  --force          Overwrite an existing preset with the same name.',
    ].join('\n') + '\n';
  }

  if (normalized === 'preset' || normalized === 'profile') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr preset <subcommand> [args]',
        'Manage routing presets. (`profile` remains as a legacy alias.)',
        '',
        '  list                    List available presets.',
        '  create <name>           Create a new empty preset.',
        '  delete <name>           Delete a preset.',
        '  rename <old> <new>      Rename a preset.',
        '  copy <src> <dst>        Copy/clone a preset.',
        '  export <name> [--compact] [--out <path>]  Export a preset for sharing.',
        '  import <source> [--catalog <name>] [--force]  Import a preset.',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr preset create <name> [--catalog <catalog>] [--target <model>]',
        'Create a new empty preset with a single orchestrator phase.',
        '  <name>           Preset name.',
        '  --catalog <name> Place in a named catalog subdirectory.',
        '  --target <model> Model target (default: anthropic/claude-sonnet).',
      ].join('\n') + '\n';
    }
    if (sub === 'delete') {
      return [
        'Usage: gsr preset delete <name> [--catalog <catalog>]',
        'Delete a preset file.',
        '  <name>           Preset name.',
        '  --catalog <name> Look in a specific catalog.',
      ].join('\n') + '\n';
    }
    if (sub === 'rename') {
      return [
        'Usage: gsr preset rename <old> <new> [--catalog <catalog>]',
        'Rename a preset (updates the file and the name field).',
      ].join('\n') + '\n';
    }
    if (sub === 'copy') {
      return [
        'Usage: gsr preset copy <source> <dest> [--catalog <catalog>]',
        'Copy/clone a preset to a new name.',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr preset list',
        'List available presets and mark the active one.',
      ].join('\n') + '\n';
    }
    if (sub === 'show') {
      return [
        'Usage: gsr preset show',
        'Show resolved routes for the active preset.',
      ].join('\n') + '\n';
    }
    if (sub === 'export') {
      return renderCommandHelp('export');
    }
    if (sub === 'import') {
      return renderCommandHelp('import');
    }
    return null;
  }

  if (normalized === 'catalog') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr catalog <subcommand> [args]',
        'Legacy/advanced compatibility commands for internal preset sources.',
        '',
        '  list               List internal preset sources and host visibility.',
        '  create <name>      Create an internal preset source (legacy).',
        '  delete <name>      Delete an empty preset source.',
        '  enable <name>      Make a source visible in the host.',
        '  disable <name>     Hide a source from the host.',
        '  move <name> <catalog>  Move a preset to another source.',
        '  use <name> [preset]  Set active source (and optionally preset).',
        '',
        'Note: Presets are the canonical public concept. `catalog` remains temporarily for compatibility only.',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr catalog list',
        'List internal preset sources (legacy compatibility view).',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr catalog create <name>',
        'Create a new internal preset source directory (legacy).',
      ].join('\n') + '\n';
    }
    if (sub === 'delete') {
      return [
        'Usage: gsr catalog delete <name>',
        'Delete an empty internal preset source. Fails if it contains presets.',
      ].join('\n') + '\n';
    }
    if (sub === 'enable') {
      return 'Usage: gsr catalog enable <name>\nMake an internal preset source visible in the host.\n';
    }
    if (sub === 'disable') {
      return 'Usage: gsr catalog disable <name>\nHide an internal preset source from the host.\n';
    }
    if (sub === 'move') {
      return [
        'Usage: gsr catalog move <preset> <target-source> [--from <source-catalog>]',
        'Move a preset to another internal source.',
        '  <preset>          Preset name.',
        '  <target-source>   Destination source name.',
        '  --from <catalog>  Specify the source explicitly (optional).',
      ].join('\n') + '\n';
    }
    return null;
  }

  if (normalized === 'route') {
    const sub = subtopic?.toLowerCase();
    if (sub === 'use') {
      return 'Usage: gsr route use <preset>\nSwitch the active routing preset.\n';
    }
    if (sub === 'show') {
      return 'Usage: gsr route show\nShow resolved routes for the current preset.\n';
    }
    return [
      'Usage: gsr route <subcommand> [args]',
      'Control which models serve each development phase.',
      '',
      '  use <preset>       Switch the active routing preset.',
      '  show               Show resolved routes for the current preset.',
      '  activate           gsr takes control of routing.',
      '  deactivate         Host takes control back.',
    ].join('\n') + '\n';
  }

  if (normalized === 'inspect') {
    return [
      'Usage: gsr inspect <subcommand> [args]',
      'Read-only views of multimodel metadata and host boundaries.',
      '',
      '  browse [selector]  Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
      '  compare <a> <b>    Compare two shareable multimodel projections without recommending or executing anything.',
      '  render <target>    Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    ].join('\n') + '\n';
  }

  if (normalized === 'setup') {
    const sub = subtopic?.toLowerCase();
    if (sub === 'install') return renderCommandHelp('install');
    if (sub === 'uninstall') return renderCommandHelp('uninstall');
    if (sub === 'bootstrap') return renderCommandHelp('bootstrap');
    if (sub === 'update') return renderCommandHelp('update');
    if (sub === 'apply') return renderCommandHelp('apply');
    return [
      'Usage: gsr setup <subcommand> [args]',
      'Install, configure, and maintain gsr.',
      '',
      '  install            Inspect or apply a YAML-first install intent to router/router.yaml.',
      '  uninstall          Remove gsr from this project (overlay + router/ with backup).',
      '  bootstrap          Show or apply a step-by-step bootstrap path for adoption.',
      '  update             Show/apply config migrations (--apply).',
      '  apply <target>     Generate TUI overlay (--apply to write).',
    ].join('\n') + '\n';
  }

  if (normalized === 'uninstall') {
    return [
      'Usage: gsr setup uninstall [--confirm]',
      'Fully uninstall gsr from this project:',
      '  1. Removes gsr-* agent entries from ./opencode.json (project-local)',
      '  2. Creates a backup of router/ at .router-backup-<timestamp>',
      '  3. Deletes the router/ directory',
      '',
      'Without --confirm, shows a preview of what will be deleted.',
      'With --confirm, executes the uninstall.',
    ].join('\n') + '\n';
  }

  if (normalized === 'fallback') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr fallback <subcommand> [args]',
        'Manage per-agent/per-lane fallback chains in preset profile files.',
        '',
        '  list <preset> [phase]              List fallback chains.',
        '  add <preset> <phase> <model>       Append a model to the chain.',
        '  remove <preset> <phase> <index>    Remove entry by 1-based index.',
        '  move <preset> <phase> <from> <to>  Reorder entries (both 1-based).',
        '  set <preset> <phase> <models>      Replace entire chain (comma-separated).',
        '  promote <preset> <phase> <index>   Promote fallback to primary; old primary → fallback #1.',
        '',
        'Options:',
        '  --lane N   Target lane index (0-based, default: 0)',
        '',
        'Examples:',
        '  gsr fallback list premium',
        '  gsr fallback list premium orchestrator',
        '  gsr fallback add premium orchestrator openai/gpt-5.4',
        '  gsr fallback remove premium orchestrator 2',
        '  gsr fallback move premium orchestrator 3 1',
        '  gsr fallback set premium orchestrator "mistral/mistral-large-3,openai/gpt-5.3-instant"',
        '  gsr fallback promote premium orchestrator 2',
        '  gsr fallback add premium apply openai/gpt-5.4 --lane 0',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr fallback list <preset> [phase] [--lane N]',
        'List fallback chains for a preset.',
        '  <preset>   Preset name (required).',
        '  [phase]    Phase name. If omitted, shows all phases.',
        '  --lane N   Show only lane N (0-based, default: all lanes).',
        '',
        'Examples:',
        '  gsr fallback list premium',
        '  gsr fallback list premium orchestrator',
      ].join('\n') + '\n';
    }
    if (sub === 'add') {
      return [
        'Usage: gsr fallback add <preset> <phase> <model> [--lane N]',
        'Append a model to the end of the fallback chain.',
        '  <preset>   Preset name.',
        '  <phase>    Phase name.',
        '  <model>    Model ID in "provider/model" format.',
        '  --lane N   Lane index (0-based, default: 0).',
        '',
        'Example:',
        '  gsr fallback add premium orchestrator openai/gpt-5.4',
      ].join('\n') + '\n';
    }
    if (sub === 'remove') {
      return [
        'Usage: gsr fallback remove <preset> <phase> <index> [--lane N]',
        'Remove a fallback entry by 1-based index.',
        '  <preset>   Preset name.',
        '  <phase>    Phase name.',
        '  <index>    1-based position in the chain.',
        '  --lane N   Lane index (0-based, default: 0).',
        '',
        'Example:',
        '  gsr fallback remove premium orchestrator 2',
      ].join('\n') + '\n';
    }
    if (sub === 'move') {
      return [
        'Usage: gsr fallback move <preset> <phase> <from> <to> [--lane N]',
        'Move a fallback entry from one position to another (both 1-based).',
        '  <preset>   Preset name.',
        '  <phase>    Phase name.',
        '  <from>     Source position (1-based).',
        '  <to>       Destination position (1-based).',
        '  --lane N   Lane index (0-based, default: 0).',
        '',
        'Example:',
        '  gsr fallback move premium orchestrator 3 1',
      ].join('\n') + '\n';
    }
    if (sub === 'set') {
      return [
        'Usage: gsr fallback set <preset> <phase> <models> [--lane N]',
        'Replace the entire fallback chain with a comma-separated list.',
        '  <preset>   Preset name.',
        '  <phase>    Phase name.',
        '  <models>   Comma-separated model IDs.',
        '  --lane N   Lane index (0-based, default: 0).',
        '',
        'Example:',
        '  gsr fallback set premium orchestrator "mistral/mistral-large-3,openai/gpt-5.3-instant"',
      ].join('\n') + '\n';
    }
    if (sub === 'promote') {
      return [
        'Usage: gsr fallback promote <preset> <phase> <index> [--lane N]',
        'Promote a fallback to primary. Old primary becomes fallback #1.',
        '  <preset>   Preset name.',
        '  <phase>    Phase name.',
        '  <index>    1-based position of the fallback to promote.',
        '  --lane N   Lane index (0-based, default: 0).',
        '',
        'Example:',
        '  gsr fallback promote premium orchestrator 2',
      ].join('\n') + '\n';
    }
    return null;
  }

  if (normalized === 'sdd') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr sdd <subcommand> [args]',
        'Manage custom SDD definitions (stored in router/catalogs/).',
        '',
        '  create <name> [--description <desc>]  Create a new custom SDD.',
        '  list                                  List all custom SDDs.',
        '  show <name>                           Show SDD details (phases, triggers).',
        '  delete <name> [--yes]                 Delete a custom SDD.',
        `  global-sync [--preset <name>] [--debug-preset <name>]  Materialize global sdd-* agents.`,
        '',
        'Examples:',
        '  gsr sdd create game-design --description "Game design workflow"',
        '  gsr sdd list',
        '  gsr sdd show game-design',
        '  gsr sdd delete game-design --yes',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr sdd create <name> [--description <desc>]',
        'Create a new custom SDD catalog in router/catalogs/<name>/.',
        '  <name>               SDD name (slug: lowercase letters, digits, hyphens).',
        '  --description <desc> Optional human-readable description.',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr sdd list',
        'List all custom SDDs in router/catalogs/.',
      ].join('\n') + '\n';
    }
    if (sub === 'show') {
      return [
        'Usage: gsr sdd show <name>',
        'Show the phases, triggers, and metadata of a custom SDD.',
      ].join('\n') + '\n';
    }
    if (sub === 'delete') {
      return [
        'Usage: gsr sdd delete <name> [--yes]',
        'Delete a custom SDD catalog and all its files.',
        '  <name>  SDD name to delete.',
        '  --yes   Skip confirmation prompt.',
      ].join('\n') + '\n';
    }
    if (sub === 'global-sync') {
      return [
        'Usage: gsr sdd global-sync [--preset <name>] [--debug-preset <name>]',
        'Materialize/update global sdd-* agents in ~/.config/opencode/opencode.json using GSR presets.',
        `  --preset <name>        Standard SDD preset (default: ${DEFAULT_GLOBAL_SDD_PRESET}).`,
        `  --debug-preset <name>  Debug SDD preset (default: ${DEFAULT_GLOBAL_DEBUG_PRESET}).`,
      ].join('\n') + '\n';
    }
    return null;
  }

  if (normalized === 'role') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr role <subcommand> [args]',
        'Manage catalog-scoped role contracts for a custom SDD.',
        '',
        '  create <name> --sdd <sdd-name>  Create a new role contract .md file.',
        '',
        'Examples:',
        '  gsr role create director --sdd game-design',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr role create <name> --sdd <sdd-name>',
        'Create a new catalog-scoped role contract in router/catalogs/<sdd>/contracts/roles/.',
        '  <name>           Role name (slug: lowercase letters, digits, hyphens).',
        '  --sdd <sdd-name> The SDD catalog to add the role to (required).',
      ].join('\n') + '\n';
    }
    return null;
  }

  if (normalized === 'phase') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr phase <subcommand> [args]',
        'Manage catalog-scoped phase contracts for a custom SDD.',
        '',
        '  create <name> --sdd <sdd-name>  Create a new phase contract .md file.',
        '  invoke <name> --sdd <sdd-name> --target <catalog>/<sdd> --trigger <trigger>',
        '                                   Add/update invoke declaration on a phase.',
        '',
        'Examples:',
        '  gsr phase create concept --sdd game-design',
        '  gsr phase invoke level-design --sdd game-design --target art-production/asset-pipeline --trigger on_issues',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr phase create <name> --sdd <sdd-name>',
        'Create a new catalog-scoped phase contract in router/catalogs/<sdd>/contracts/phases/.',
        '  <name>           Phase name (slug: lowercase letters, digits, hyphens).',
        '  --sdd <sdd-name> The SDD catalog to add the phase to (required).',
      ].join('\n') + '\n';
    }
    if (sub === 'invoke') {
      return [
        'Usage: gsr phase invoke <phase-name> --sdd <sdd-name> --target <catalog>/<sdd> --trigger <trigger>',
        '  [--input-from <field>] [--required-fields <comma-separated>]',
        'Add or update an invoke declaration on a phase in a custom SDD.',
        '  <phase-name>          Phase to add invoke to (must exist in sdd.yaml).',
        '  --sdd <sdd-name>      The SDD catalog that owns the phase (required).',
        '  --target <cat>/<sdd>  Target catalog/sdd to invoke (required).',
        '  --trigger <trigger>   When to invoke: on_issues | always | never | manual.',
        '  --input-from <field>  Where the callee reads its input from (optional).',
        '  --required-fields <fields>  Comma-separated field names required from phase output (optional).',
        '',
        'Example:',
        '  gsr phase invoke level-design --sdd game-design \\',
        '    --target art-production/asset-pipeline \\',
        '    --trigger on_issues \\',
        '    --input-from phase_output \\',
        '    --required-fields "issues,affected_files"',
      ].join('\n') + '\n';
    }
    return null;
  }

  return null;
}

function renderOpenCodeSurface(report) {
  const lines = [
    `Command: ${report.command} opencode`,
    `Status: ${report.status}`,
    `Supported: ${report.supported ? 'yes' : 'no'}`,
  ];

  if (report.schemaVersion) {
    lines.push(`Schema: v${report.schemaVersion}`);
  }

  if (report.selectedCatalogName) {
    lines.push(`Selected catalog: ${report.selectedCatalogName}`);
  }

  if (report.selectedPresetName) {
    lines.push(`Selected preset: ${report.selectedPresetName}`);
  }

  if (report.sessionSyncContract) {
    const session = report.sessionSyncContract;
    lines.push(
      `Host session sync: ${session.status}`,
      `Slash root: ${session.commandManifest.root}`,
      `Slash commands: ${session.commandManifest.commands.length}`,
      `Rebind token: ${session.rebindToken ?? 'unavailable'}`,
    );
  }

  if (Array.isArray(report.laneRoles) && report.laneRoles.length > 0) {
    lines.push(`Lane roles: ${report.laneRoles.join(' / ')}`);
  }

  if (Array.isArray(report.compatibilityNotes) && report.compatibilityNotes.length > 0) {
    lines.push('Compatibility notes:');
    for (const note of report.compatibilityNotes) {
      lines.push(`- ${note}`);
    }
  }

  if (report.configPath) {
    lines.push(`Config: ${formatConfigPathForDisplay(report.configPath)}`);
  }

  if (report.activeProfileName) {
    lines.push(report.schemaVersion === 3
      ? `Active preset: ${report.activeProfileName}`
      : `Active profile: ${report.activeProfileName}`);
  }

  if (report.activationState) {
    lines.push(`Activation: ${report.activationState}`);
  }

  if (report.effectiveController) {
    lines.push(`Effective controller: ${report.effectiveController}`);
  }

  if (report.resolvedPhases) {
    lines.push('Resolved routes:');
    for (const [phaseName, route] of Object.entries(report.resolvedPhases)) {
      lines.push(`- ${phaseName}: ${formatRoute(route.active)}`);
    }
  }

  if (Array.isArray(report.nextSteps) && report.nextSteps.length > 0) {
    lines.push('Next steps:');
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  if (report.providerExecutionContract) {
    const contract = report.providerExecutionContract;
    lines.push(`Contract status: ${contract.status}`);
    lines.push(`Contract compatibility: ${contract.compatibility}`);

    if (contract.boundary) {
      lines.push(`Boundary owner: ${contract.boundary.owner}`);
      lines.push(`Execution owners: ${contract.boundary.executionOwners.join(' / ')}`);
      lines.push(`Provider execution: ${contract.boundary.capabilities.providerExecution.state}`);
    }

    lines.push('Boundary mode: non-executing');

    if (contract.error) {
      lines.push(`Contract error: ${contract.error.errorType}`);
    }

    if (contract.result) {
      lines.push(`Contract result: ${contract.result.execution}`);
    }
  }

  if (report.handoffDelegationContract) {
    const contract = report.handoffDelegationContract;
    lines.push(`Handoff status: ${contract.status}`);
    lines.push(`Handoff compatibility: ${contract.compatibility}`);

    if (contract.boundary) {
      lines.push(`Handoff owner: ${contract.boundary.owner}`);
      lines.push(`Downstream consumer: ${contract.boundary.consumerOwners.join(' / ')}`);
    }

    lines.push('Handoff mode: report-only');

    if (contract.trigger) {
      lines.push(`Handoff trigger: ${contract.trigger.kind}`);
    }

    if (contract.result) {
      lines.push(`Handoff decision: ${contract.result.decision}`);
      if (Array.isArray(contract.result.nextSteps) && contract.result.nextSteps.length > 0) {
        lines.push('Handoff next steps:');
        for (const step of contract.result.nextSteps) {
          lines.push(`- ${step}`);
        }
      }
    }

    if (contract.error) {
      lines.push(`Handoff reason: ${contract.error.reason}`);
    }
  }

  if (report.agentTeamsLiteContract) {
    const contract = report.agentTeamsLiteContract;
    lines.push(`Agent Teams Lite contract: ${contract.status}`);
    lines.push(`Agent Teams Lite compatibility: ${contract.compatibility}`);
    lines.push('Agent Teams Lite mode: report-only');
    lines.push(`Agent Teams Lite read: ${contract.read.available ? 'available' : 'unavailable'}`);

    if (contract.read.refs.length > 0) {
      lines.push(`Agent Teams Lite refs: ${contract.read.refs.join(' / ')}`);
    }

    if (contract.recovery.hints.length > 0) {
      lines.push('Agent Teams Lite recovery:');
      for (const hint of contract.recovery.hints) {
        lines.push(`- ${hint}`);
      }
    }
  }

  if (report.multimodelOrchestrationManagerContract) {
    const contract = report.multimodelOrchestrationManagerContract;
    lines.push(`Multimodel orchestration manager: ${contract.contractVersion}`);
    lines.push(`Manager plan: ${contract.planId}`);
    lines.push(`Manager mode: ${contract.complexity.mode}`);
    lines.push(`Manager split/dispatch: ${contract.split.length} / ${contract.dispatch.length}`);
    lines.push(`Manager merge: ${contract.merge.mergeId}`);
    lines.push(`Manager judge/radar: ${contract.judge.length} / ${contract.radar.length}`);
    lines.push(`Manager recovery: resume=${contract.recovery.resumeToken}, cursor=${contract.recovery.cursor}, target=${contract.recovery.handoffTarget ?? 'none'}`);
    lines.push('Manager policy: report-only / non-executing');
  }

  if (report.runtimeContract) {
    lines.push(`Runtime support: ${report.runtimeContract.supportLevel}`);
    lines.push(`Runtime fallback: ${report.runtimeContract.fallback.verdict} (${report.runtimeContract.fallback.target})`);
    lines.push(`Normalized intent: ${formatRuntimeIntent(report.runtimeContract.intent)}`);
    lines.push('Runtime capabilities:');

    for (const [name, capability] of Object.entries(report.runtimeContract.capabilities)) {
      if (!capability || typeof capability !== 'object' || !('state' in capability)) {
        continue;
      }

      lines.push(`- ${name}: ${capability.state}`);
    }

    lines.push('Runtime limits:');
    for (const limit of report.runtimeContract.limits ?? []) {
      lines.push(`- ${limit.capability}: ${limit.state} — ${limit.reason}`);
    }
  }

  lines.push(`Reason: ${report.reason}`);

  return `${lines.join('\n')}\n`;
}

function renderMultimodelBrowseSurface(report) {
  const lines = [
    'Command: browse multimodel',
    'Status: report-only',
    `Schema: v${report.schemaVersion}`,
    `Selector: ${report.resolvedSelector}`,
    `Visibility: availability=${report.visibility.availability ? 'yes' : 'no'} pricing=${report.visibility.pricing ? 'yes' : 'no'} labels=${report.visibility.labels ? 'yes' : 'no'} guidance=${report.visibility.guidance ? 'yes' : 'no'}`,
    'Policy: non-recommendation / non-execution',
    `Catalog: ${report.catalog.name}`,
    `Catalog availability: ${report.catalog.availability ?? 'hidden'}`,
  ];

  if (report.catalog.labels.length > 0) {
    lines.push(`Catalog labels: ${report.catalog.labels.join(' / ')}`);
  }

  lines.push(
    `Preset: ${report.preset.name}`,
    `Preset aliases: ${report.preset.aliases.length > 0 ? report.preset.aliases.join(' / ') : 'none'}`,
    `Preset availability: ${report.preset.availability ?? 'hidden'}`,
    `Preset complexity: ${formatMultimodelComplexity(report.preset.complexity)}`,
  );

  if (report.preset.laneSummary.length > 0) {
    lines.push('Lane summary:');
    for (const lane of report.preset.laneSummary) {
      lines.push(`- ${lane.phase}: ${lane.roles.length > 0 ? lane.roles.join(' / ') : 'none'} (${lane.laneCount} lanes)`);
    }
  }

  lines.push(
    `Pricing: ${report.pricing.visibility ? formatMultimodelPricing(report.pricing) : 'hidden'}`,
    `Guidance: ${report.guidance.visibility ? formatMultimodelGuidance(report.guidance.summary) : 'hidden'}`,
  );

  return `${lines.join('\n')}\n`;
}

function renderMultimodelCompareSurface(report) {
  const lines = [
    'Command: compare multimodel',
    'Status: report-only',
    `Schema: v${report.schemaVersion}`,
    `Left: ${report.leftResolvedSelector ?? report.leftSelector ?? report.left.preset.name}`,
    `Right: ${report.rightResolvedSelector ?? report.rightSelector ?? report.right.preset.name}`,
    `Visibility: availability=${report.visibility.availability ? 'yes' : 'no'} pricing=${report.visibility.pricing ? 'yes' : 'no'} labels=${report.visibility.labels ? 'yes' : 'no'} guidance=${report.visibility.guidance ? 'yes' : 'no'}`,
    'Policy: non-recommendation / non-execution',
  ];

  if (report.differences.length === 0) {
    lines.push('Differences: none');
    return `${lines.join('\n')}\n`;
  }

  lines.push('Differences:');
  for (const diff of report.differences) {
    lines.push(`- ${diff.path}: ${formatMultimodelValue(diff.left)} -> ${formatMultimodelValue(diff.right)}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatMultimodelComplexity(complexity) {
  if (!complexity) {
    return 'hidden';
  }

  if (typeof complexity === 'string') {
    return complexity;
  }

  if (complexity.kind === 'label') {
    return complexity.label ?? 'unknown';
  }

  const parts = [];
  if (complexity.label) {
    parts.push(complexity.label);
  }
  if (Number.isFinite(complexity.min)) {
    parts.push(`min=${complexity.min}`);
  }
  if (Number.isFinite(complexity.max)) {
    parts.push(`max=${complexity.max}`);
  }

  return parts.length > 0 ? parts.join(' ') : 'hidden';
}

function formatMultimodelPricing(pricing) {
  const parts = [];

  if (pricing.band) {
    parts.push(`band=${pricing.band}`);
  }

  if (pricing.currency) {
    parts.push(`currency=${pricing.currency}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'hidden';
}

function formatMultimodelGuidance(summary) {
  if (!summary) {
    return 'hidden';
  }

  const parts = [];

  if (summary.default) {
    const defaultParts = [];
    if (Number.isFinite(summary.default.laneCount)) {
      defaultParts.push(`lanes=${summary.default.laneCount}`);
    }
    if (Array.isArray(summary.default.ordering) && summary.default.ordering.length > 0) {
      defaultParts.push(`ordering=${summary.default.ordering.join(' / ')}`);
    }
    if (defaultParts.length > 0) {
      parts.push(`default(${defaultParts.join(', ')})`);
    }
  }

  const complexityLabels = Object.keys(summary.byComplexity ?? {});
  if (complexityLabels.length > 0) {
    parts.push(`by-complexity=${complexityLabels.join(' / ')}`);
  }

  return parts.length > 0 ? parts.join('; ') : 'hidden';
}

function formatMultimodelValue(value) {
  if (value === null || value === undefined) {
    return 'hidden';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => formatMultimodelValue(item)).join(', ')}]`;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatRuntimeIntent(intent) {
  if (!intent) {
    return '(none)';
  }

  const parts = [intent.command, intent.target];
  if (intent.apply) {
    parts.push('apply');
  }

  if (Array.isArray(intent.fragments) && intent.fragments.length > 0) {
    parts.push(intent.fragments.join(' | '));
  }

  return parts.filter(Boolean).join(' · ');
}

function formatRoute(route) {
  const raw = route && typeof route === 'object'
    ? route.target ?? route.kind ?? '(none)'
    : route ?? '(none)';

  return formatProviderModel(raw);
}

function formatProviderModel(routeTarget) {
  const text = String(routeTarget);

  if (text === '(none)') {
    return text;
  }

  const slashIndex = text.indexOf('/');
  if (slashIndex < 0) {
    return colorize(text, 'bold');
  }

  const provider = text.slice(0, slashIndex);
  const model = text.slice(slashIndex + 1);

  return `${colorize(provider, 'cyan')}${colorize(' / ', 'dim')}${colorize(model, 'bold')}`;
}

function colorize(text, style) {
  if (!supportsColor()) {
    return text;
  }

  const styles = {
    bold: '\u001b[1m',
    cyan: '\u001b[36m',
    dim: '\u001b[2m',
  };

  return `${styles[style]}${text}\u001b[0m`;
}

function supportsColor() {
  return process.stdout?.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}

function parseInstallOptions(args, defaults = {}) {
  const options = {
    apply: defaults.apply,
    intent: [],
  };
  let pendingPhaseName = null;
  let freeformTokens = [];

  function flushFreeform() {
    if (freeformTokens.length > 0) {
      options.intent.push(freeformTokens.join(' '));
      freeformTokens = [];
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--apply') {
      flushFreeform();
      options.apply = true;
      continue;
    }

    if (token === '--no-apply') {
      flushFreeform();
      options.apply = false;
      continue;
    }

    if (token === '--intent') {
      flushFreeform();
      const value = args[++index];
      if (!value) {
        throw new Error('gsr install/bootstrap requires a value after --intent.');
      }

      options.intent.push(value);
      continue;
    }

    if (token === '--profile') {
      flushFreeform();
      const value = args[++index];
      if (!value) {
        throw new Error('gsr install/bootstrap requires a value after --profile.');
      }

      options.intent.push(`profile=${value}`);
      continue;
    }

    if (token === '--activation') {
      flushFreeform();
      const value = args[++index];
      if (!value) {
        throw new Error('gsr install/bootstrap requires a value after --activation.');
      }

      options.intent.push(`activation=${value}`);
      continue;
    }

    if (token === '--phase') {
      flushFreeform();
      pendingPhaseName = args[++index];
      if (!pendingPhaseName) {
        throw new Error('gsr install/bootstrap requires a value after --phase.');
      }
      continue;
    }

    if (token === '--chain') {
      flushFreeform();
      const chain = args[++index];
      if (!pendingPhaseName || !chain) {
        throw new Error('gsr install/bootstrap requires --phase before --chain.');
      }

      options.intent.push(`phase.${pendingPhaseName}=${chain}`);
      pendingPhaseName = null;
      continue;
    }

    if (pendingPhaseName) {
      options.intent.push(`phase.${pendingPhaseName}=${token}`);
      pendingPhaseName = null;
      continue;
    }

    freeformTokens.push(token);
  }

  flushFreeform();

  if (pendingPhaseName) {
    throw new Error('gsr install/bootstrap requires a chain value after --phase.');
  }

  return {
    ...options,
    intent: options.intent.join('; '),
  };
}

// === SDD COMMANDS ============================================================

/**
 * Internal dispatcher for `gsr sdd <subcommand>`.
 * @param {string[]} args
 */
export function runSddCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runSddCreate(rest, catalogsDir);
    }
    case 'list': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runSddList(rest, catalogsDir);
    }
    case 'show': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runSddShow(rest, catalogsDir);
    }
    case 'delete': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runSddDelete(rest, catalogsDir);
    }
    case 'invoke': {
      const projectRoot = process.cwd();
      return runSddInvoke(rest, getInvocationsDir(projectRoot));
    }
    case 'invoke-complete': {
      const projectRoot = process.cwd();
      return runSddInvokeComplete(rest, getInvocationsDir(projectRoot));
    }
    case 'invoke-status': {
      const projectRoot = process.cwd();
      return runSddInvokeStatus(rest, getInvocationsDir(projectRoot));
    }
    case 'invocations': {
      // Fix 4: if a positional name arg is provided, show DECLARED invocations from sdd.yaml
      const positionalName = rest.find(a => !a.startsWith('--'));
      if (positionalName) {
        const configPath = discoverConfigPath();
        if (!configPath) {
          process.stdout.write('No router config found. Run `gsr install` first.\n');
          return;
        }
        const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
        return runSddDeclaredInvocations(rest, catalogsDir);
      }
      // No name: list RUNTIME invocation records (existing behavior)
      const projectRoot = process.cwd();
      return runSddInvocations(rest, getInvocationsDir(projectRoot));
    }
    case 'validate': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runSddValidate(rest, catalogsDir);
    }
    case 'global-sync': {
      return runSddGlobalSync(rest);
    }
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('sdd') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown sdd command: ${sub}` : 'gsr sdd requires a subcommand.');
  }
}

/**
 * Internal dispatcher for `gsr role <subcommand>`.
 * @param {string[]} args
 */
export function runRoleCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runRoleCreate(rest, catalogsDir);
    }
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('role') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown role command: ${sub}` : 'gsr role requires a subcommand.');
  }
}

/**
 * Internal dispatcher for `gsr phase <subcommand>`.
 * @param {string[]} args
 */
export function runPhaseCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runPhaseCreate(rest, catalogsDir);
    }
    case 'invoke': {
      const configPath = discoverConfigPath();
      if (!configPath) {
        process.stdout.write('No router config found. Run `gsr install` first.\n');
        return;
      }
      const catalogsDir = path.join(path.dirname(configPath), 'catalogs');
      return runPhaseInvoke(rest, catalogsDir);
    }
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(renderCommandHelp('phase') ?? '');
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown phase command: ${sub}` : 'gsr phase requires a subcommand.');
  }
}

// === EXPORTED SDD COMMAND FUNCTIONS (for direct testing) =====================

/**
 * Create a new custom SDD.
 * @param {string[]} args - CLI args after 'sdd create'
 * @param {string} catalogsDir - Path to router/catalogs/
 */
export function runSddCreate(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr sdd create requires a name.');
  }

  const descIndex = args.indexOf('--description');
  const description = descIndex !== -1 ? args[descIndex + 1] : undefined;

  const result = createCustomSdd(catalogsDir, name, description);
  process.stdout.write(`Created SDD '${result.name}' at ${result.path}\n`);

  const configPath = path.join(path.dirname(catalogsDir), 'router.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const syncResult = materializeProjectSddAgents(configPath);
      process.stdout.write(`Project SDD agents synced: ${syncResult.count}\n`);
    } catch {
      // Non-blocking. Some tests and partial setups don't have full v4 profile structure yet.
    }
  }
}

/**
 * List all custom SDDs.
 * @param {string[]} _args
 * @param {string} catalogsDir
 */
export function runSddList(_args, catalogsDir) {
  const sdds = loadCustomSdds(catalogsDir);

  if (sdds.length === 0) {
    process.stdout.write('No custom SDDs found. Run `gsr sdd create <name>` to create one.\n');
    return;
  }

  process.stdout.write('Custom SDDs:\n');
  for (const sdd of sdds) {
    const desc = sdd.description ? ` — ${sdd.description}` : '';
    const phaseCount = Object.keys(sdd.phases).length;
    process.stdout.write(`  ${sdd.name}${desc} (${phaseCount} phase(s))\n`);
  }
}

/**
 * Show details of a custom SDD.
 * @param {string[]} args
 * @param {string} catalogsDir
 */
export function runSddShow(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr sdd show requires a name.');
  }

  const sdd = loadCustomSdd(catalogsDir, name);

  process.stdout.write(`SDD: ${sdd.name}\n`);
  if (sdd.description) {
    process.stdout.write(`Description: ${sdd.description}\n`);
  }
  process.stdout.write(`Version: ${sdd.version}\n`);
  process.stdout.write(`Phases (${Object.keys(sdd.phases).length}):\n`);
  for (const [phaseName, phase] of Object.entries(sdd.phases)) {
    process.stdout.write(`  ${phaseName}: ${phase.intent} [${phase.execution}]\n`);
  }
  if (sdd.triggers) {
    process.stdout.write('Triggers:\n');
    if (sdd.triggers.from_sdd) {
      process.stdout.write(`  from_sdd: ${sdd.triggers.from_sdd}\n`);
    }
    if (sdd.triggers.trigger_phase) {
      process.stdout.write(`  trigger_phase: ${sdd.triggers.trigger_phase}\n`);
    }
    if (sdd.triggers.return_to) {
      process.stdout.write(`  return_to: ${sdd.triggers.return_to}\n`);
    }
  }
}

/**
 * Delete a custom SDD.
 * @param {string[]} args
 * @param {string} catalogsDir
 */
export function runSddDelete(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr sdd delete requires a name.');
  }

  const yes = args.includes('--yes');

  if (!yes) {
    process.stdout.write(`This will delete SDD '${name}' and all its contents.\n`);
    process.stdout.write(`Run with --yes to confirm: gsr sdd delete ${name} --yes\n`);
    return;
  }

  const result = deleteCustomSdd(catalogsDir, name);
  process.stdout.write(`Deleted SDD '${result.name}' from ${result.path}\n`);
}

/**
 * Validate a custom SDD: checks sdd.yaml, phase/role contracts, deps, invoke targets.
 * gsr sdd validate <name>
 * @param {string[]} args
 * @param {string} catalogsDir
 */
export function runSddValidate(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr sdd validate requires a name.');
  }

  let result;
  try {
    result = validateSddFull(catalogsDir, name);
  } catch (err) {
    process.stdout.write(`Validating SDD: ${name}\n`);
    process.stdout.write(`  ❌ sdd.yaml — ${err.message}\n`);
    process.stdout.write('SDD is invalid.\n');
    return;
  }

  const phaseCount = result.details.phases.total;
  process.stdout.write(`Validating SDD: ${name}\n`);

  // sdd.yaml line
  process.stdout.write(`  ✅ sdd.yaml — valid (${phaseCount} phases)\n`);

  // Phase contracts
  const { phases } = result.details;
  if (phases.missing.length === 0) {
    process.stdout.write(`  ✅ Phase contracts — ${phases.present}/${phases.total} present\n`);
  } else {
    process.stdout.write(
      `  ❌ Phase contracts — ${phases.present}/${phases.total} present ` +
      `(missing: ${phases.missing.join(', ')})\n`
    );
  }

  // Role contracts
  const { roles } = result.details;
  if (roles.total > 0) {
    if (roles.missing.length === 0) {
      process.stdout.write(`  ✅ Role contracts — ${roles.present}/${roles.total} present\n`);
    } else {
      process.stdout.write(
        `  ⚠️ Role contracts — ${roles.present}/${roles.total} present ` +
        `(missing: ${roles.missing.join(', ')})\n`
      );
    }
  }

  // Dependency graph
  process.stdout.write(
    `  ✅ Dependency graph — ${result.details.deps.hasCycles ? 'CYCLES DETECTED' : 'no cycles'}\n`
  );

  // Invoke declarations
  const { invokes } = result.details;
  const invokeWarningCount = invokes.warnings.length;
  if (invokeWarningCount > 0) {
    process.stdout.write(
      `  ⚠️ Invoke declarations — ${invokes.valid} valid targets ` +
      `(${invokeWarningCount} warning(s))\n`
    );
    for (const w of invokes.warnings) {
      process.stdout.write(`    ⚠️ ${w}\n`);
    }
  } else if (invokes.valid > 0) {
    process.stdout.write(`  ✅ Invoke declarations — ${invokes.valid} valid targets\n`);
  }

  // Summary
  const totalWarnings = result.warnings.length;
  const totalErrors = result.errors.length;

  if (totalErrors > 0) {
    process.stdout.write(`  ❌ ${totalErrors} error(s) found\n`);
    process.stdout.write('SDD is invalid.\n');
  } else if (totalWarnings > 0) {
    process.stdout.write(`  ⚠️ ${totalWarnings} warning(s) found\n`);
    process.stdout.write('SDD is valid with warnings.\n');
  } else {
    process.stdout.write('SDD is valid.\n');
  }
}

/**
 * Materialize global sdd-* agents in ~/.config/opencode/opencode.json using GSR presets.
 * gsr sdd global-sync [--preset <name>] [--debug-preset <name>]
 *
 * @param {string[]} args
 * @param {{ targetPath?: string, cwd?: string }} [options]
 */
export function runSddGlobalSync(args, options = {}) {
  const presetIndex = args.indexOf('--preset');
  const debugPresetIndex = args.indexOf('--debug-preset');
  const preset = presetIndex !== -1 ? args[presetIndex + 1] : DEFAULT_GLOBAL_SDD_PRESET;
  const debugPreset = debugPresetIndex !== -1 ? args[debugPresetIndex + 1] : DEFAULT_GLOBAL_DEBUG_PRESET;

  if (!preset) throw new Error('gsr sdd global-sync requires a value after --preset.');
  if (!debugPreset) throw new Error('gsr sdd global-sync requires a value after --debug-preset.');

  const specs = getGlobalSddAgentSpecs({ preset, debugPreset, cwd: options.cwd ?? process.cwd() });
  const result = materializeGlobalSddAgents(specs, options.targetPath);

  process.stdout.write(`Global SDD agents synced: ${result.count}\n`);
  process.stdout.write(`Preset: ${preset}\n`);
  process.stdout.write(`Debug preset: ${debugPreset}\n`);
  process.stdout.write(`Written: ${result.writtenPath}\n`);
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
  }
}

async function syncProjectSddAgentsIfPossible(configPath, options = {}) {
  try {
    const result = materializeProjectSddAgents(configPath, options);
    return result;
  } catch (err) {
    process.stdout.write(`Note: project SDD agent sync failed: ${err.message}\n`);
    return null;
  }
}

/**
 * List DECLARED invocations from a custom SDD's sdd.yaml.
 * gsr sdd invocations <name>
 * @param {string[]} args
 * @param {string} catalogsDir
 */
export function runSddDeclaredInvocations(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr sdd invocations <name> requires a name.');
  }

  let invocations;
  try {
    invocations = listDeclaredInvocations(catalogsDir, name);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  if (invocations.length === 0) {
    process.stdout.write(`Declared invocations for ${name}: none\n`);
    return;
  }

  process.stdout.write(`Declared invocations for ${name}:\n`);
  for (const inv of invocations) {
    const awaitStr = inv.await ? 'await' : 'no-await';
    const onFailureStr = `on_failure: ${inv.on_failure}`;
    process.stdout.write(`  ${inv.phase} → ${inv.catalog}/${inv.sdd} (${awaitStr}, ${onFailureStr})\n`);

    if (inv.input_context && inv.input_context.length > 0) {
      const inputs = inv.input_context.map(c => c.field ? `${c.artifact}.${c.field}` : c.artifact).join(', ');
      process.stdout.write(`    input: ${inputs}\n`);
    }
    if (inv.output_expected && inv.output_expected.length > 0) {
      const outputs = inv.output_expected.map(o => o.format ? `${o.artifact} (${o.format})` : o.artifact).join(', ');
      process.stdout.write(`    output: ${outputs}\n`);
    }
  }
}

// === ROLE CONTRACT TEMPLATE ===================================================

const ROLE_CONTRACT_TEMPLATE = (roleName) => `---
name: ${roleName}
description: >
  {Role description placeholder}
metadata:
  author: user
  version: "1.0"
  scope: catalog
---

## Role Definition

{Describe what this role does within the SDD workflow.}

## Input Contract

- {What this role receives}

## Output Contract

- {What this role produces}
`;

// === PHASE CONTRACT TEMPLATE ==================================================

const PHASE_CONTRACT_TEMPLATE = (phaseName) => `---
name: ${phaseName}
phase_order: 0
description: {Phase intent from sdd.yaml}
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|

## Execution Mode
Default: \`sequential\`

## Phase Input
- {Describe expected input}

## Phase Output
- {Describe expected output}
`;

// === EXPORTED ROLE/PHASE COMMAND FUNCTIONS ====================================

/**
 * Create a catalog-scoped role contract.
 * @param {string[]} args - CLI args after 'role create'
 * @param {string} catalogsDir
 */
export function runRoleCreate(args, catalogsDir) {
  const sddIndex = args.indexOf('--sdd');
  const sddName = sddIndex !== -1 ? args[sddIndex + 1] : null;
  if (!sddName) {
    throw new Error('gsr role create requires --sdd <catalog>.');
  }

  // Positional name: non-flag arg that is NOT the value after --sdd
  const name = args.find((a, i) => {
    if (a.startsWith('--')) return false;
    if (sddIndex !== -1 && i === sddIndex + 1) return false;
    return true;
  });
  if (!name) {
    throw new Error('gsr role create requires a role name.');
  }

  // Verify catalog exists
  const catalogDir = path.join(catalogsDir, sddName);
  if (!fs.existsSync(catalogDir)) {
    throw new Error(`Catalog '${sddName}' not found at ${catalogDir}.`);
  }

  const rolePath = path.join(catalogDir, 'contracts', 'roles', `${name}.md`);
  fs.mkdirSync(path.dirname(rolePath), { recursive: true });

  const template = ROLE_CONTRACT_TEMPLATE(name);
  const tempPath = `${rolePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, template, 'utf8');
  fs.renameSync(tempPath, rolePath);

  process.stdout.write(`Created role contract '${name}' at ${rolePath}\n`);
}

/**
 * Create a catalog-scoped phase contract.
 * @param {string[]} args - CLI args after 'phase create'
 * @param {string} catalogsDir
 */
export function runPhaseCreate(args, catalogsDir) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    throw new Error('gsr phase create requires a phase name.');
  }

  const sddIndex = args.indexOf('--sdd');
  const sddName = sddIndex !== -1 ? args[sddIndex + 1] : null;
  if (!sddName) {
    throw new Error('gsr phase create requires --sdd <catalog>.');
  }

  // Verify catalog exists
  const catalogDir = path.join(catalogsDir, sddName);
  if (!fs.existsSync(catalogDir)) {
    throw new Error(`Catalog '${sddName}' not found at ${catalogDir}.`);
  }

  const phasePath = path.join(catalogDir, 'contracts', 'phases', `${name}.md`);

  // Do not overwrite existing contract — print warning instead
  if (fs.existsSync(phasePath)) {
    process.stdout.write(`Warning: Phase contract '${name}' already exists at ${phasePath}. Skipping.\n`);
    return;
  }

  // Extract optional --intent flag
  const intentIndex = args.indexOf('--intent');
  const intent = intentIndex !== -1 ? (args[intentIndex + 1] ?? '') : '';

  const result = scaffoldPhaseContract(catalogsDir, sddName, name, { intent });
  process.stdout.write(`Created phase contract '${name}' at ${result.path}\n`);
}

/**
 * Add or update an invoke declaration on a phase in a custom SDD.
 * gsr phase invoke <phase-name> --sdd <sdd-name> --target <catalog>/<sdd> --trigger <trigger>
 *   [--input-from <field>] [--required-fields <comma-separated>]
 *
 * @param {string[]} args - CLI args after 'phase invoke'
 * @param {string} catalogsDir - Path to router/catalogs/
 */
export function runPhaseInvoke(args, catalogsDir) {
  // Positional: phase name (first non-flag arg not following a flag)
  const phaseName = args.find((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = args[i - 1];
    if (prev && prev.startsWith('--')) return false;
    return true;
  });
  if (!phaseName) {
    throw new Error('gsr phase invoke requires a phase name.');
  }

  // --sdd <sdd-name>
  const sddIndex = args.indexOf('--sdd');
  const sddName = sddIndex !== -1 ? args[sddIndex + 1] : null;
  if (!sddName) {
    throw new Error('gsr phase invoke requires --sdd <sdd-name>.');
  }

  // --target <catalog>/<sdd>
  const targetIndex = args.indexOf('--target');
  const targetArg = targetIndex !== -1 ? args[targetIndex + 1] : null;
  if (!targetArg) {
    throw new Error('gsr phase invoke requires --target <catalog>/<sdd>.');
  }
  const slashIdx = targetArg.indexOf('/');
  const catalog = slashIdx !== -1 ? targetArg.slice(0, slashIdx).trim() : targetArg.trim();
  const sddTarget = slashIdx !== -1 ? targetArg.slice(slashIdx + 1).trim() : '';

  // --trigger <trigger>
  const triggerIndex = args.indexOf('--trigger');
  const trigger = triggerIndex !== -1 ? args[triggerIndex + 1] : undefined;

  // --input-from <field>
  const inputFromIndex = args.indexOf('--input-from');
  const input_from = inputFromIndex !== -1 ? args[inputFromIndex + 1] : undefined;

  // --required-fields <comma-separated>
  const reqFieldsIndex = args.indexOf('--required-fields');
  const reqFieldsRaw = reqFieldsIndex !== -1 ? args[reqFieldsIndex + 1] : undefined;
  const required_fields = reqFieldsRaw
    ? reqFieldsRaw.split(',').map(f => f.trim()).filter(Boolean)
    : undefined;

  const result = addPhaseInvoke(catalogsDir, sddName, phaseName, {
    catalog,
    sdd: sddTarget || catalog,
    trigger,
    input_from,
    required_fields,
  });

  process.stdout.write(
    `Invoke added to phase '${result.phaseName}' in SDD '${result.sddName}'.\n` +
    `  catalog: ${result.invoke.catalog}\n` +
    (result.invoke.trigger ? `  trigger: ${result.invoke.trigger}\n` : '')
  );
}

// === EXPORTED INVOKE COMMAND FUNCTIONS ========================================

/**
 * Parse a "catalog/sdd" argument string into { catalog, sdd }.
 * Throws if argument is missing or malformed.
 * @param {string|undefined} arg
 * @param {string} label - Name for error messages ('callee', 'caller', etc.)
 * @returns {{ catalog: string, sdd: string }}
 */
function parseCatalogSddArg(arg, label) {
  if (!arg || typeof arg !== 'string') {
    throw new Error(`${label} argument is required in "catalog/sdd" format.`);
  }
  const slashIdx = arg.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`${label} must be in "catalog/sdd" format (got: "${arg}").`);
  }
  const catalog = arg.slice(0, slashIdx).trim();
  const sdd = arg.slice(slashIdx + 1).trim();
  if (!catalog || !sdd) {
    throw new Error(`${label} must be in "catalog/sdd" format (got: "${arg}").`);
  }
  return { catalog, sdd };
}

/**
 * Create a cross-catalog invocation record.
 * gsr sdd invoke <catalog>/<sdd> --from <catalog>/<sdd> --phase <name> [--payload <string>]
 *
 * @param {string[]} args - CLI args after 'sdd invoke'
 * @param {string} invDir - Path to invocations directory
 */
export function runSddInvoke(args, invDir) {
  // Parse positional callee argument (non-flag)
  const calleeArg = args.find((a, i) => {
    if (a.startsWith('--')) return false;
    // Skip values following flags
    const prev = args[i - 1];
    if (prev && prev.startsWith('--')) return false;
    return true;
  });
  const callee = parseCatalogSddArg(calleeArg, 'callee');

  // --from <catalog>/<sdd>
  const fromIdx = args.indexOf('--from');
  if (fromIdx === -1 || !args[fromIdx + 1]) {
    throw new Error('--from <catalog>/<sdd> is required.');
  }
  const caller = parseCatalogSddArg(args[fromIdx + 1], '--from');

  // --phase <name>
  const phaseIdx = args.indexOf('--phase');
  if (phaseIdx === -1 || !args[phaseIdx + 1]) {
    throw new Error('--phase <name> is required.');
  }
  const phase = args[phaseIdx + 1];

  // --payload <string> (optional)
  const payloadIdx = args.indexOf('--payload');
  const payload = payloadIdx !== -1 ? (args[payloadIdx + 1] ?? '') : '';

  const record = createInvocation(
    caller.catalog,
    caller.sdd,
    phase,
    callee.catalog,
    callee.sdd,
    payload,
    invDir
  );

  process.stdout.write(`Invocation created: ${record.id}\n`);
}

/**
 * Complete or fail a pending invocation record.
 * gsr sdd invoke-complete <id> [--result <string>] [--failed]
 *
 * @param {string[]} args
 * @param {string} invDir
 */
export function runSddInvokeComplete(args, invDir) {
  const id = args.find((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = args[i - 1];
    if (prev && prev.startsWith('--')) return false;
    return true;
  });
  if (!id) {
    throw new Error('gsr sdd invoke-complete requires an invocation id.');
  }

  const failed = args.includes('--failed');
  const status = failed ? 'failed' : 'completed';

  const resultIdx = args.indexOf('--result');
  const result = resultIdx !== -1 ? (args[resultIdx + 1] ?? null) : null;

  const updated = completeInvocation(id, result, status, invDir);
  process.stdout.write(`Invocation ${updated.id} marked as ${updated.status}.\n`);
}

/**
 * Print the status of an invocation record.
 * gsr sdd invoke-status <id>
 *
 * @param {string[]} args
 * @param {string} invDir
 */
export function runSddInvokeStatus(args, invDir) {
  const id = args.find((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = args[i - 1];
    if (prev && prev.startsWith('--')) return false;
    return true;
  });
  if (!id) {
    throw new Error('gsr sdd invoke-status requires an invocation id.');
  }

  const record = readInvocation(id, invDir);
  process.stdout.write(`id: ${record.id}\n`);
  process.stdout.write(`status: ${record.status}\n`);
  process.stdout.write(`caller: ${record.caller.catalog}/${record.caller.sdd} (phase: ${record.caller.phase})\n`);
  process.stdout.write(`callee: ${record.callee.catalog}/${record.callee.sdd}\n`);
  process.stdout.write(`payload: ${record.payload ?? '(none)'}\n`);
  process.stdout.write(`result: ${record.result ?? '(none)'}\n`);
  process.stdout.write(`created_at: ${record.created_at}\n`);
  process.stdout.write(`updated_at: ${record.updated_at}\n`);
  if (record.completed_at) {
    process.stdout.write(`completed_at: ${record.completed_at}\n`);
  }
}

/**
 * List all invocation records, optionally filtered by status.
 * gsr sdd invocations [--status <pending|running|completed|failed>]
 *
 * @param {string[]} args
 * @param {string} invDir
 */
export function runSddInvocations(args, invDir) {
  const statusIdx = args.indexOf('--status');
  const statusFilter = statusIdx !== -1 ? args[statusIdx + 1] : undefined;

  const records = listInvocations(invDir, statusFilter);

  if (records.length === 0) {
    process.stdout.write('No invocation records found.\n');
    return;
  }

  for (const record of records) {
    process.stdout.write(`${record.id}  ${record.status}  ${record.caller.catalog}/${record.caller.sdd}:${record.caller.phase} → ${record.callee.catalog}/${record.callee.sdd}\n`);
  }
}

// ── identity command ──────────────────────────────────────────────────────────

/**
 * Internal dispatcher for `gsr identity <subcommand>`.
 * @param {string[]} args
 */
function runIdentityCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'show':
      return runIdentityShow(rest);
    default:
      if (sub === 'help' || sub === '--help' || !sub) {
        process.stdout.write(
          'Usage: gsr identity show [--preset <name>]\n' +
          '\nSubcommands:\n' +
          '  show    Resolve and display agent identity for a preset or all enabled presets\n'
        );
        return;
      }
      printUsage();
      throw new Error(sub ? `Unknown identity command: ${sub}` : 'gsr identity requires a subcommand.');
  }
}

/**
 * Show resolved agent identity for a preset or all enabled presets.
 *
 * @param {string[]} args - CLI args after 'identity show'
 * @param {object} [options] - Override { configPath, cwd } for testing
 */
export async function runIdentityShow(args, options = {}) {
  const presetFlag = args.indexOf('--preset');
  const targetPreset = presetFlag !== -1 ? args[presetFlag + 1] : null;

  const configPath = options.configPath ?? tryGetConfigPath();
  const cwd = options.cwd ?? process.cwd();

  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  let config;
  try {
    config = loadRouterConfig(configPath);
  } catch (err) {
    process.stdout.write(`Error loading router config: ${err.message}\n`);
    return;
  }

  const catalogs = config.catalogs ?? {};
  const presetsToShow = [];

  // Collect all presets across enabled catalogs
  for (const [, catalog] of Object.entries(catalogs)) {
    if (catalog.enabled === false) continue;
    for (const [presetName, preset] of Object.entries(catalog.presets ?? {})) {
      presetsToShow.push({ presetName, preset });
    }
  }

  if (presetsToShow.length === 0) {
    process.stdout.write('No enabled presets found.\n');
    return;
  }

  // Filter by preset name if specified
  if (targetPreset) {
    const found = presetsToShow.find(p => p.presetName === targetPreset);
    if (!found) {
      process.stdout.write(`Preset '${targetPreset}' not found in enabled catalogs.\n`);
      return;
    }
    _printIdentityForPreset(found.presetName, found.preset, cwd);
    return;
  }

  // Show all enabled presets
  for (const { presetName, preset } of presetsToShow) {
    _printIdentityForPreset(presetName, preset, cwd);
    process.stdout.write('\n');
  }
}

/**
 * Print the resolved identity for a single preset to stdout.
 * @param {string} presetName
 * @param {object} preset
 * @param {string} cwd
 */
function _printIdentityForPreset(presetName, preset, cwd) {
  const identity = resolveIdentity(preset, { cwd });

  process.stdout.write(`=== ${presetName} ===\n`);
  process.stdout.write(`Sources: ${identity.sources.join(', ')}\n`);
  process.stdout.write(`Prompt:\n${identity.prompt}\n`);
}

// === FALLBACK COMMANDS ========================================================

/**
 * Internal dispatcher for `gsr fallback <subcommand>`.
 * @param {string[]} args
 */
export async function runFallbackCommand(args) {
  const [sub, ...rest] = args;

  if (sub === 'help' || sub === '--help' || !sub) {
    process.stdout.write(renderCommandHelp('fallback') ?? '');
    return;
  }

  switch (sub) {
    case 'list':    return runFallbackList(rest);
    case 'add':     return runFallbackAdd(rest);
    case 'remove':  return runFallbackRemove(rest);
    case 'move':    return runFallbackMove(rest);
    case 'set':     return runFallbackSet(rest);
    case 'promote': return runFallbackPromote(rest);
    default:
      printUsage();
      throw new Error(`Unknown fallback command: ${sub}`);
  }
}

/**
 * Parse --lane N flag from args. Returns 0 if not specified.
 * @param {string[]} args
 * @returns {number}
 */
function parseLaneFlag(args) {
  const idx = args.indexOf('--lane');
  if (idx !== -1) {
    const val = args[idx + 1];
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`--lane requires a non-negative integer (got: "${val}").`);
    }
    return n;
  }
  return 0;
}

/**
 * gsr fallback list <preset> [phase] [--lane N]
 * No phase → list ALL phases and their fallback chains.
 * With phase → list that phase's chain(s).
 * @param {string[]} args
 */
export async function runFallbackList(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a) => !a.startsWith('--'));
  const presetName = positionals[0];
  const phaseName = positionals[1];

  if (!presetName) {
    throw new Error('gsr fallback list requires a preset name.');
  }

  let phases;
  try {
    phases = phaseName ? [phaseName] : getPresetPhases(configPath, presetName);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  process.stdout.write(`Fallback chains for preset '${presetName}':\n\n`);

  for (const phase of phases) {
    let chain = [];
    let primary = '';
    try {
      chain = readFallbackChain(configPath, presetName, phase, 0);
      primary = readLanePrimary(configPath, presetName, phase, 0);
    } catch {
      chain = [];
    }
    process.stdout.write(`${phase} (lane 0):\n`);
    if (primary) process.stdout.write(`  Primary: ${primary}\n`);
    process.stdout.write(formatFallbackList(chain) + '\n');
    process.stdout.write('\n');
  }
}

/**
 * gsr fallback add <preset> <phase> <model> [--lane N]
 * Appends model to end of chain.
 * @param {string[]} args
 */
export async function runFallbackAdd(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const presetName = positionals[0];
  const phaseName = positionals[1];
  const modelId = positionals[2];
  const laneIndex = parseLaneFlag(args);

  if (!presetName || !phaseName || !modelId) {
    throw new Error('gsr fallback add requires: <preset> <phase> <model>');
  }

  // Validate model format
  const validationError = validateModelId(modelId);
  if (validationError) {
    process.stdout.write(`Error: ${validationError}\n`);
    return;
  }

  let chain;
  try {
    chain = readFallbackChain(configPath, presetName, phaseName, laneIndex);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  const newChain = [...chain, modelId];
  await writeFallbackChain(configPath, presetName, phaseName, laneIndex, newChain);

  process.stdout.write(`Added '${modelId}' to fallbacks for ${presetName}/${phaseName} (lane ${laneIndex}).\n`);
  process.stdout.write(`Chain is now:\n${formatFallbackList(newChain)}\n`);
}

/**
 * gsr fallback remove <preset> <phase> <index> [--lane N]
 * Removes entry by 1-based index.
 * @param {string[]} args
 */
export async function runFallbackRemove(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const presetName = positionals[0];
  const phaseName = positionals[1];
  const indexStr = positionals[2];
  const laneIndex = parseLaneFlag(args);

  if (!presetName || !phaseName || !indexStr) {
    throw new Error('gsr fallback remove requires: <preset> <phase> <index>');
  }

  const oneBasedIndex = parseInt(indexStr, 10);
  if (!Number.isFinite(oneBasedIndex) || oneBasedIndex < 1) {
    throw new Error(`Index must be a positive integer (got: "${indexStr}").`);
  }

  let chain;
  try {
    chain = readFallbackChain(configPath, presetName, phaseName, laneIndex);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  if (oneBasedIndex > chain.length) {
    process.stdout.write(`Error: Index ${oneBasedIndex} is out of bounds (chain has ${chain.length} entries).\n`);
    return;
  }

  const removed = chain[oneBasedIndex - 1];
  const newChain = chain.filter((_, idx) => idx !== oneBasedIndex - 1);
  await writeFallbackChain(configPath, presetName, phaseName, laneIndex, newChain);

  process.stdout.write(`Removed '${removed}' from fallbacks for ${presetName}/${phaseName} (lane ${laneIndex}).\n`);
  if (newChain.length > 0) {
    process.stdout.write(`Chain is now:\n${formatFallbackList(newChain)}\n`);
  } else {
    process.stdout.write('Chain is now empty.\n');
  }
}

/**
 * gsr fallback move <preset> <phase> <from> <to> [--lane N]
 * Moves entry from one 1-based index to another.
 * @param {string[]} args
 */
export async function runFallbackMove(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const presetName = positionals[0];
  const phaseName = positionals[1];
  const fromStr = positionals[2];
  const toStr = positionals[3];
  const laneIndex = parseLaneFlag(args);

  if (!presetName || !phaseName || !fromStr || !toStr) {
    throw new Error('gsr fallback move requires: <preset> <phase> <from> <to>');
  }

  const fromIndex = parseInt(fromStr, 10);
  const toIndex = parseInt(toStr, 10);
  if (!Number.isFinite(fromIndex) || fromIndex < 1) {
    throw new Error(`"from" must be a positive integer (got: "${fromStr}").`);
  }
  if (!Number.isFinite(toIndex) || toIndex < 1) {
    throw new Error(`"to" must be a positive integer (got: "${toStr}").`);
  }

  let chain;
  try {
    chain = readFallbackChain(configPath, presetName, phaseName, laneIndex);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  if (fromIndex > chain.length) {
    process.stdout.write(`Error: "from" index ${fromIndex} is out of bounds (chain has ${chain.length} entries).\n`);
    return;
  }
  if (toIndex > chain.length) {
    process.stdout.write(`Error: "to" index ${toIndex} is out of bounds (chain has ${chain.length} entries).\n`);
    return;
  }
  if (fromIndex === toIndex) {
    process.stdout.write(`Nothing to move — "from" and "to" are the same (${fromIndex}).\n`);
    return;
  }

  // Perform the move
  const newChain = [...chain];
  const [moved] = newChain.splice(fromIndex - 1, 1);
  newChain.splice(toIndex - 1, 0, moved);

  await writeFallbackChain(configPath, presetName, phaseName, laneIndex, newChain);

  process.stdout.write(`Moved '${moved}' from position ${fromIndex} to ${toIndex} in ${presetName}/${phaseName} (lane ${laneIndex}).\n`);
  process.stdout.write(`Chain is now:\n${formatFallbackList(newChain)}\n`);
}

/**
 * gsr fallback set <preset> <phase> <model,model,...> [--lane N]
 * Replaces entire chain.
 * @param {string[]} args
 */
export async function runFallbackSet(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const presetName = positionals[0];
  const phaseName = positionals[1];
  const modelsStr = positionals[2];
  const laneIndex = parseLaneFlag(args);

  if (!presetName || !phaseName || !modelsStr) {
    throw new Error('gsr fallback set requires: <preset> <phase> <model,model,...>');
  }

  const newChain = modelsStr.split(',').map((s) => s.trim()).filter(Boolean);

  // Validate all model IDs
  const errors = [];
  for (const modelId of newChain) {
    const err = validateModelId(modelId);
    if (err) errors.push(err);
  }
  if (errors.length > 0) {
    for (const err of errors) {
      process.stdout.write(`Error: ${err}\n`);
    }
    return;
  }

  // Verify preset/phase exist before writing
  try {
    readFallbackChain(configPath, presetName, phaseName, laneIndex);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  await writeFallbackChain(configPath, presetName, phaseName, laneIndex, newChain);

  process.stdout.write(`Fallback chain for ${presetName}/${phaseName} (lane ${laneIndex}) set to:\n`);
  process.stdout.write(formatFallbackList(newChain) + '\n');
}

/**
 * gsr fallback promote <preset> <phase> <index> [--lane N]
 * Promotes the fallback at 1-based <index> to primary.
 * Old primary becomes fallback #1.
 * @param {string[]} args
 */
export async function runFallbackPromote(args) {
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const positionals = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const presetName = positionals[0];
  const phaseName = positionals[1];
  const indexStr = positionals[2];
  const laneIndex = parseLaneFlag(args);

  if (!presetName || !phaseName || !indexStr) {
    throw new Error('gsr fallback promote requires: <preset> <phase> <index>');
  }

  const fallbackIndex = parseInt(indexStr, 10);
  if (!Number.isFinite(fallbackIndex) || fallbackIndex < 1) {
    throw new Error(`Index must be a positive integer (got: "${indexStr}").`);
  }

  let result;
  try {
    result = await promoteFallback(configPath, presetName, phaseName, laneIndex, fallbackIndex);
  } catch (err) {
    process.stdout.write(`Error: ${err.message}\n`);
    return;
  }

  const { promoted, demoted, newFallbacks } = result;

  process.stdout.write(`✓ Promoted: ${promoted} → primary (${phaseName}, lane ${laneIndex})\n`);
  process.stdout.write(`✓ Demoted:  ${demoted} → fallback #1\n`);
  process.stdout.write('New chain:\n');
  process.stdout.write(formatFallbackList(newFallbacks) + '\n');
}

export { resetIdentityCache };
