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
  listProfiles,
  loadRouterConfig,
  deactivateOpenCodeCommand,
  installOpenCodeCommand,
  planMigrations,
  renderOpenCodeCommand,
  resolveRouterState,
  runMigrations,
  saveRouterConfig,
  setActiveProfile,
  tryGetConfigPath,
} from './router-config.js';
import { resolveControllerLabel } from './core/controller.js';

const CURRENT_SCHEMA_VERSION = 4;
let wizardEntrypointForTesting = null;

function safeDiscoverConfigPath() {
  try {
    return discoverConfigPath();
  } catch {
    return null;
  }
}

export async function runCli(argv) {
  const [command, ...rest] = argv;

  // Interactive wizard: no command + TTY
  if (!command && process.stdout.isTTY) {
    const runWizard = wizardEntrypointForTesting
      ?? (await import('./ux/wizard.js')).runWizard;
    const configPath = safeDiscoverConfigPath();
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
    const cmd = typeof action === 'object' ? action.command : action;
    const cmdArgs = typeof action === 'object' && action.preset ? [action.preset] : [];
    return runCli([cmd, ...cmdArgs]);
  }

  if (command === '--help' || command === '-h' || command === 'help' || !command) {
    return runHelp(rest, command);
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    return runVersion();
  }

  switch (command) {
    case 'use':
      return runUse(rest);
    case 'reload':
      return runReload();
    case 'status':
      return runStatus();
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
  const config = loadRouterConfig(getConfigPath());
  const profiles = listProfiles(config);

  process.stdout.write('Profiles:\n');
  for (const profile of profiles) {
    const marker = profile.active ? '*' : ' ';
    process.stdout.write(`${marker} ${profile.name} (${profile.phases.length} phases)\n`);
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

  for (const [phaseName, route] of Object.entries(state.resolvedPhases)) {
    lines.push(`- ${phaseName}: ${formatRoute(route.active)}`);
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
    'Compatibility: router.yaml version 1 and 3 are supported; v3 powers multimodel browse/compare.',
    'Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing.',
    '',
    'Commands:',
    '  use <profile>      Select the active profile in router/router.yaml without changing who is in control.',
    '  reload             Reload the current config and print resolved routes.',
    '  status             Show who is in control, how to toggle it, the active profile, and resolved routes.',
    '  list               List available profiles and mark the active one.',
    '  browse [selector]  Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
    '  compare <left> <right> Compare two shareable multimodel projections without recommending or executing anything.',
    '  install            Inspect or apply a YAML-first install intent to router/router.yaml.',
    '  bootstrap          Show or apply a step-by-step bootstrap path for adoption.',
    '  activate           Take control of routing without changing the active profile.',
    `  deactivate         Hand control back to ${controllerLabel} without changing the active profile.`,
    '  render opencode    Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
    '  update             Show pending config migrations. Use --apply to apply them.',
    '  apply <target>     Generate and apply configuration overlay for a TUI target (e.g., opencode).',
    '  version            Show the installed gsr version.',
    '  help [command]     Show help for all commands or one command.',
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
