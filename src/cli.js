import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from './router-config.js';
import { resolveControllerLabel, resolvePersona } from './core/controller.js';

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
    case 'profile':
      return runProfile(rest);
    case 'catalog':
      return runCatalog(rest);
    case 'inspect':
      return runInspect(rest);
    case 'setup':
      return runSetup(rest);

    // === Top-level (stay at root) ===
    case 'status':
      return runStatus();

    // === Backward-compat aliases (old flat commands still work) ===
    case 'use':
      return runUse(rest);
    case 'reload':
      return runReload();
    case 'list':
      return runList();
    case 'browse':
      return runBrowse(rest);
    case 'compare':
      return runCompare(rest);
    case 'render':
      return runRender(rest);
    case 'install':
      return runInstall(rest);
    case 'bootstrap':
      return runBootstrap(rest);
    case 'activate':
      return runToggleActivation('active', rest);
    case 'deactivate':
      return runToggleActivation('inactive', rest);
    case 'update':
      return runUpdate(rest);
    case 'apply':
      return runApply(rest);
    case 'export':
      return runExport(rest);
    case 'import':
      return await runImport(rest);
    case 'uninstall':
      return runUninstall(rest);
    case 'sync':
      return await runSync();
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

  process.stdout.write(`Active profile set to: ${profileName}\n`);
}

function runReload() {
  maybeWarnOutdatedConfig();
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);

  process.stdout.write(renderStatus(state, configPath, config));
}

function runStatus() {
  maybeWarnOutdatedConfig();
  const configPath = tryGetConfigPath();

  if (!configPath) {
    process.stdout.write(renderMissingStatus());
    return;
  }

  try {
    const config = loadRouterConfig(configPath);
    const state = resolveRouterState(config);

    process.stdout.write(renderStatus(state, configPath, config));
  } catch (error) {
    process.stdout.write(renderInvalidStatus(configPath, error));
  }
}

function runList() {
  maybeWarnOutdatedConfig();
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const profiles = listProfiles(config);

  // Build a map: presetName -> catalogName
  const presetCatalogMap = {};
  for (const [catalogName, catalog] of Object.entries(config.catalogs ?? {})) {
    for (const presetName of Object.keys(catalog.presets ?? {})) {
      presetCatalogMap[presetName] = catalogName;
    }
  }

  process.stdout.write('Profiles:\n');
  for (const profile of profiles) {
    const marker = profile.active ? '*' : ' ';
    const tags = buildProfileTags(config, profile.name);
    const tagSuffix = tags.length > 0 ? ` ${tags.map((t) => `[${t}]`).join(' ')}` : '';
    const catalogName = presetCatalogMap[profile.name] ?? 'default';
    const catalogMeta = config.catalogs?.[catalogName];
    const catalogLabel = getCatalogDisplayName(catalogName, catalogMeta);
    process.stdout.write(`${marker} ${profile.name} (${profile.phases.length} phases) — ${catalogLabel}${tagSuffix}\n`);
  }
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

function runApply(args) {
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
    process.stdout.write('Run `gsr apply opencode --apply` to write to ~/.config/opencode/opencode.json\n');
    return;
  }

  process.stdout.write('\n');
  process.stdout.write(`Written to: ${report.writtenPath}\n`);

  // Also deploy /gsr-* slash command files
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

async function runSync() {
  const { syncContracts } = await import('./core/sync.js');
  try {
    const result = syncContracts();
    process.stdout.write(`Synced ${result.roles} role contracts + ${result.phases} phase compositions.\n`);
    process.stdout.write(`Manifest: ${result.manifestPath}\n`);
    process.stdout.write(`Total: ${result.total} contracts.\n`);
  } catch (err) {
    process.stdout.write(`Sync failed: ${err.message}\n`);
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
    default:
      if (subcommand === 'help' || subcommand === '--help' || !subcommand) {
        process.stdout.write(renderCommandHelp('profile') ?? '');
        return;
      }
      printUsage();
      throw new Error(subcommand ? `Unknown profile command: ${subcommand}` : 'gsr profile requires a subcommand.');
  }
}

function runCatalog(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return runCatalogList(rest);
    case 'create':
      return runCatalogCreate(rest);
    case 'delete':
      return runCatalogDelete(rest);
    case 'enable':
      return runCatalogEnable(rest);
    case 'disable':
      return runCatalogDisable(rest);
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

function runProfileCreate(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr profile create requires a profile name.');
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
  process.stdout.write(`Created profile '${result.presetName}'${catalogLabel} → ${result.path}\n`);
}

function runProfileDelete(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    printUsage();
    throw new Error('gsr profile delete requires a profile name.');
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
  process.stdout.write(`Deleted profile '${result.presetName}' from ${result.path}\n`);
}

function runProfileRename(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const oldName = positional[0];
  const newName = positional[1];

  if (!oldName || !newName) {
    printUsage();
    throw new Error('gsr profile rename requires <old-name> <new-name>.');
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
  process.stdout.write(`Renamed profile '${result.oldName}' → '${result.newName}' (${result.path})\n`);
}

function runProfileCopy(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const sourceName = positional[0];
  const destName = positional[1];

  if (!sourceName || !destName) {
    printUsage();
    throw new Error('gsr profile copy requires <source> <dest>.');
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
  process.stdout.write(`Copied profile '${result.sourceName}' → '${result.destName}' (${result.path})\n`);
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

  process.stdout.write('Catalogs:\n');
  for (const cat of catalogs) {
    const meta = config.catalogs?.[cat.name];
    const displayLabel = getCatalogDisplayName(cat.name, meta);
    const enabledFlag = meta?.enabled === false ? ' [disabled]' : ' [enabled]';
    process.stdout.write(`  ${displayLabel}${enabledFlag} (${cat.profileCount} profile(s))\n`);
  }
}

function runCatalogCreate(args) {
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
  process.stdout.write(`Created catalog '${result.name}' at ${result.path}\n`);
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
  process.stdout.write(`Deleted catalog '${result.name}' from ${result.path}\n`);
}

function runCatalogEnable(args) {
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
  process.stdout.write(`Catalog '${name}' enabled. Its presets will appear in TUI host.\n`);
  process.stdout.write('Tip: Run `gsr setup apply opencode --apply` to update OpenCode agents.\n');
}

function runCatalogDisable(args) {
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
  process.stdout.write(`Catalog '${name}' disabled. Its presets will be hidden from TUI host.\n`);
  process.stdout.write('Tip: Run `gsr setup apply opencode --apply` to update OpenCode agents.\n');
}

function runCatalogMove(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  const targetCatalog = positional[1];

  if (!name || !targetCatalog) {
    printUsage();
    throw new Error('gsr catalog move requires: gsr catalog move <profile> <target-catalog>');
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
  process.stdout.write(`Moved profile '${result.name}' from '${result.from}' to '${result.to}'\n`);
}

function runCatalogUse(args) {
  const catalogName = args[0];
  const presetOverride = args[1]; // optional
  if (!catalogName) {
    printUsage();
    throw new Error('gsr catalog use requires a catalog name.');
  }
  const configPath = discoverConfigPath();
  if (!configPath) {
    process.stdout.write('No router config found. Run `gsr install` first.\n');
    return;
  }

  const config = loadRouterConfig(configPath);

  // Verify catalog exists
  if (!config.catalogs?.[catalogName]) {
    throw new Error(`Catalog '${catalogName}' not found.`);
  }

  // Determine which preset to activate
  const preset = presetOverride
    ?? config.catalogs[catalogName]?.active_preset
    ?? Object.keys(config.catalogs[catalogName]?.presets ?? {})[0]
    ?? null;

  if (!preset) {
    throw new Error(`Catalog '${catalogName}' has no profiles.`);
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

  process.stdout.write(`Active catalog: ${catalogName}\nActive preset: ${preset}\n`);
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

  // Step 1: Remove overlay + slash commands
  const overlayResult = removeOpenCodeOverlay();
  if (overlayResult.removedCount > 0) {
    process.stdout.write(`Removed ${overlayResult.removedCount} gsr-* agent(s) from ${overlayResult.path}\n`);
  } else {
    process.stdout.write('No gsr-* entries found in opencode.json.\n');
  }

  try {
    const cmdResult = removeGsrCommands();
    if (cmdResult.removed > 0) {
      process.stdout.write(`Removed ${cmdResult.removed} /gsr command(s).\n`);
    }
  } catch {
    // Non-blocking
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
    '  status                    Show who is in control, how to toggle it, the active profile, and resolved routes.',
    '  version                   Installed gsr version.',
    '  help [command]            Help for a command or subcommand.',
    '  sync                      Push global contracts to Engram (dev/repair).',
    '',
    '  route                     Control which models serve each phase.',
    '    use <preset>            Select the active profile in router/router.yaml without changing who is in control.',
    '    show                    Show resolved routes for current preset.',
    '    activate                gsr takes control of routing.',
    `    deactivate              Hand control back to ${controllerLabel} without changing the active profile.`,
    '',
    '  profile                   Manage routing profiles.',
    '    list                    List available profiles and mark the active one.',
    '    create <name>           Create an empty profile.',
    '    delete <name>           Delete a profile.',
    '    rename <old> <new>      Rename a profile.',
    '    copy <src> <dest>       Clone a profile.',
    '    export <name>           Export for sharing (--compact for gsr:// string).',
    '    import <source>         Import from file, URL, or gsr:// string.',
    '',
    '  catalog                   Manage profile catalogs and TUI visibility.',
    '    list                    List catalogs with status.',
    '    create <name>           Create a catalog (disabled by default).',
    '    delete <name>           Delete an empty catalog.',
    '    enable <name>           Enable catalog in TUI host (TAB cycling).',
    '    disable <name>          Disable catalog from TUI host.',
    '    move <name> <catalog>   Move a profile to another catalog.',
    '    use <name> [preset]     Set active catalog (and optionally preset).',
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
    'Backward-compat aliases (old commands still work at root):',
    '    use <profile>       Select the active profile in router/router.yaml without changing who is in control.',
    '    list                List available profiles and mark the active one.',
    '    browse [selector]   Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
    '    compare <left> <right>  Compare two shareable multimodel projections without recommending or executing anything.',
    '    render opencode     Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    '    export <preset>     Export a preset for sharing.',
    '    import <source>     Import a preset from file, URL, or string.',
    '    install             Inspect or apply a YAML-first install intent to router/router.yaml.',
    '    bootstrap           Show or apply a step-by-step bootstrap path for adoption.',
    '    activate            Take control of routing without changing the active profile.',
    `    deactivate          Hand control back to ${controllerLabel} without changing the active profile.`,
    '    update              Show/apply config migrations.',
    '    apply <target>      Generate and apply TUI overlay.',
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
      '  gsr apply opencode --apply  Write overlay to ~/.config/opencode/opencode.json.',
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

  if (normalized === 'profile') {
    const sub = subtopic?.toLowerCase();
    if (!sub) {
      return [
        'Usage: gsr profile <subcommand> [args]',
        'Manage routing profiles.',
        '',
        '  list                    List available profiles.',
        '  create <name>           Create a new empty profile.',
        '  delete <name>           Delete a profile.',
        '  rename <old> <new>      Rename a profile.',
        '  copy <src> <dst>        Copy/clone a profile.',
        '  export <name> [--compact] [--out <path>]  Export a preset for sharing.',
        '  import <source> [--catalog <name>] [--force]  Import a preset.',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr profile create <name> [--catalog <catalog>] [--target <model>]',
        'Create a new empty profile with a single orchestrator phase.',
        '  <name>           Profile name.',
        '  --catalog <name> Place in a named catalog subdirectory.',
        '  --target <model> Model target (default: anthropic/claude-sonnet).',
      ].join('\n') + '\n';
    }
    if (sub === 'delete') {
      return [
        'Usage: gsr profile delete <name> [--catalog <catalog>]',
        'Delete a profile file.',
        '  <name>           Profile name.',
        '  --catalog <name> Look in a specific catalog.',
      ].join('\n') + '\n';
    }
    if (sub === 'rename') {
      return [
        'Usage: gsr profile rename <old> <new> [--catalog <catalog>]',
        'Rename a profile (updates the file and the name field).',
      ].join('\n') + '\n';
    }
    if (sub === 'copy') {
      return [
        'Usage: gsr profile copy <source> <dest> [--catalog <catalog>]',
        'Copy/clone a profile to a new name.',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr profile list',
        'List available profiles and mark the active one.',
      ].join('\n') + '\n';
    }
    if (sub === 'show') {
      return [
        'Usage: gsr profile show',
        'Show resolved routes for the active profile.',
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
        'Manage profile catalogs and TUI visibility.',
        '',
        '  list               List catalogs with enable/disable status.',
        '  create <name>      Create a catalog (disabled by default).',
        '  delete <name>      Delete an empty catalog.',
        '  enable <name>      Enable catalog — its presets appear in TUI host.',
        '  disable <name>     Disable catalog — its presets are hidden from TUI host.',
        '  move <name> <catalog>  Move a profile to another catalog.',
        '  use <name> [preset]  Set active catalog (and optionally preset).',
        '',
        'Note: Only enabled catalogs generate agents in the TUI host (e.g., OpenCode TAB cycling).',
        'The SDD-Orchestrator (default) catalog is enabled by default. New catalogs start disabled.',
      ].join('\n') + '\n';
    }
    if (sub === 'list') {
      return [
        'Usage: gsr catalog list',
        'List all catalogs (directories under profiles/ + default).',
      ].join('\n') + '\n';
    }
    if (sub === 'create') {
      return [
        'Usage: gsr catalog create <name>',
        'Create a new catalog directory under profiles/.',
      ].join('\n') + '\n';
    }
    if (sub === 'delete') {
      return [
        'Usage: gsr catalog delete <name>',
        'Delete an empty catalog. Fails if the catalog contains profiles.',
      ].join('\n') + '\n';
    }
    if (sub === 'enable') {
      return 'Usage: gsr catalog enable <name>\nEnable a catalog so its presets appear in TUI host TAB cycling.\n';
    }
    if (sub === 'disable') {
      return 'Usage: gsr catalog disable <name>\nDisable a catalog so its presets are hidden from TUI host.\n';
    }
    if (sub === 'move') {
      return [
        'Usage: gsr catalog move <profile> <target-catalog> [--from <source-catalog>]',
        'Move a profile to another catalog.',
        '  <profile>         Profile name.',
        '  <target-catalog>  Destination catalog name.',
        '  --from <catalog>  Specify the source catalog explicitly (optional).',
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
      '  1. Removes gsr-* agent entries from ~/.config/opencode/opencode.json',
      '  2. Creates a backup of router/ at .router-backup-<timestamp>',
      '  3. Deletes the router/ directory',
      '',
      'Without --confirm, shows a preview of what will be deleted.',
      'With --confirm, executes the uninstall.',
    ].join('\n') + '\n';
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
