import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveControllerLabel } from '../../core/controller.js';
import {
  applyInstallIntent,
  describeInstallBootstrap,
  listProfiles,
  parseYaml,
  resolveActivationState,
  resolveRouterState,
  normalizeInstallIntent,
  setActiveProfile,
  setActivationState,
  stringifyYaml,
  validateRouterConfig,
} from '../../core/router.js';
import {
  assembleV4Config,
  buildV4WritePlan,
  loadV4Profiles,
} from '../../core/router-v4-io.js';
import {
  detectOpenCodeRuntimeCapabilities,
  evaluateOpenCodeRuntimeContract,
} from './runtime-contract.js';
import {
  DEFAULT_MULTIMODEL_VISIBILITY,
  MULTIMODEL_CONTRACT_VERSION,
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  projectShareableMultimodelMetadata,
} from './multimodel-contract.js';
import {
  MULTIMODEL_ORCHESTRATION_MANAGER_CONTRACT_VERSION,
  createMultimodelOrchestrationManagerContract,
} from './multimodel-orchestration-manager-contract.js';
import {
  createAgentTeamsLiteIntegrationContract,
  normalizeAgentTeamsLiteStatus,
} from './agent-teams-lite-contract.js';
import {
  HANDOFF_DELEGATION_CONTRACT_VERSION,
  createHandoffDelegationBoundary,
  createHandoffDelegationRequestEnvelope,
  validateHandoffDelegationRequest,
} from './handoff-delegation-contract.js';
import {
  createProviderExecutionBoundary,
  createProviderExecutionCapabilityEnvelope,
  createProviderExecutionErrorEnvelope,
  createProviderExecutionRequestEnvelope,
  createProviderExecutionResultEnvelope,
  validateProviderExecutionRequest,
} from './provider-execution-contract.js';
import {
  generateOpenCodeOverlay as _generateOpenCodeOverlay,
  mapPermissions as _mapPermissions,
  mergeOverlayWithExisting as _mergeOverlayWithExisting,
  mergeOverlayWithFile as _mergeOverlayWithFile,
  writeOpenCodeConfig as _writeOpenCodeConfig,
  OPENCODE_CONFIG_PATH as _OPENCODE_CONFIG_PATH,
  GSR_AGENT_PREFIX as _GSR_AGENT_PREFIX,
} from './overlay-generator.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function detectOpenCodeRuntimeContext(overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const release = overrides.release ?? os.release();
  const cwd = overrides.cwd ?? process.cwd();
  const moduleDir = overrides.moduleDir ?? MODULE_DIR;
  const isWSL = platform === 'linux' && /microsoft|wsl/i.test(release);
  const isLinux = platform === 'linux';
  const supported = isLinux || isWSL;

  return {
    ...overrides,
    platform,
    release,
    cwd,
    moduleDir,
    isLinux,
    isWSL,
    supported,
  };
}

export function getOpenCodeCapabilities(context = detectOpenCodeRuntimeContext()) {
  const runtimeCapabilities = detectOpenCodeRuntimeCapabilities(context);

  return {
    platformValidated: runtimeCapabilities.supported,
    providerExecution: false,
    multiRunner: false,
    judge: false,
    radar: false,
    costLatencySelection: false,
    advancedHealthChecks: false,
    inSessionFailover: false,
    workspaceDiscovery: true,
    configPersistence: true,
    reason: runtimeCapabilities.supported
      ? 'OpenCode adapter is configuration-backed and runtime-contract thin in this batch.'
      : 'OpenCode adapter is only supported on Linux/WSL in this batch.',
  };
}

export function formatConfigPathForDisplay(configPath, cwd = process.cwd()) {
  const relative = path.relative(cwd, configPath);
  return relative || configPath;
}

export function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);

  while (true) {
    const configPath = path.join(current, 'router', 'router.yaml');
    if (fs.existsSync(configPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Could not find router/router.yaml from the current directory.');
    }

    current = parent;
  }
}

export function discoverConfigPath(startPoints = [process.cwd(), MODULE_DIR]) {
  const seeds = Array.isArray(startPoints) ? startPoints : [startPoints];

  for (const seed of seeds) {
    try {
      return path.join(findProjectRoot(seed), 'router', 'router.yaml');
    } catch {
      // Keep trying the next consumer context.
    }
  }

  return null;
}

export function getConfigPath(startPoints = [process.cwd(), MODULE_DIR]) {
  const configPath = discoverConfigPath(startPoints);
  if (!configPath) {
    throw new Error('Could not find router/router.yaml from the current context or module.');
  }

  return configPath;
}

export function tryGetConfigPath(startPoints = [process.cwd(), MODULE_DIR]) {
  return discoverConfigPath(startPoints);
}

export function loadRouterConfig(configPath = getConfigPath()) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);

  if (config.version === 4) {
    const routerDir = path.dirname(configPath);
    const profiles = loadV4Profiles(routerDir);
    const assembled = assembleV4Config(config, profiles);

    Object.defineProperty(assembled, '_v4Source', {
      value: { ...assembled._v4Source, routerDir },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    validateRouterConfig(assembled);
    return assembled;
  }

  validateRouterConfig(config);
  return config;
}

export function renderOpenCodeCommand(context = detectOpenCodeRuntimeContext()) {
  return buildOpenCodeSurfaceReport('render', context);
}

export function installOpenCodeCommand(options = {}, context = detectOpenCodeRuntimeContext()) {
  return buildInstallationSurfaceReport('install', options, context);
}

export function bootstrapOpenCodeCommand(options = {}, context = detectOpenCodeRuntimeContext()) {
  return buildInstallationSurfaceReport('bootstrap', options, context);
}

export function activateOpenCodeCommand(context = detectOpenCodeRuntimeContext()) {
  return buildOpenCodeSurfaceReport('activate', context);
}

export function deactivateOpenCodeCommand(context = detectOpenCodeRuntimeContext()) {
  return buildOpenCodeSurfaceReport('deactivate', context);
}

export function saveRouterConfig(config, configPath = getConfigPath(), previousConfig = null) {
  validateRouterConfig(config);

  // Detect v4 configs: either config has _v4Source or previousConfig does (spread loses non-enumerable).
  const v4Source = config._v4Source ?? previousConfig?._v4Source ?? null;

  if (v4Source) {
    // Restore _v4Source if it was lost by object spread (e.g., setActiveProfile returns a plain spread).
    // Also update coreConfig to reflect the new assembled config's top-level fields so buildV4WritePlan
    // can correctly detect changes made via setActiveProfile / setActivationState.
    const configWithSource = config._v4Source
      ? config
      : Object.defineProperty({ ...config }, '_v4Source', {
          value: {
            ...v4Source,
            coreConfig: {
              ...v4Source.coreConfig,
              active_catalog: config.active_catalog,
              active_preset: config.active_preset,
              activation_state: config.activation_state,
              metadata: config.metadata,
            },
          },
          enumerable: false,
          configurable: true,
          writable: true,
        });
    return saveV4Config(configWithSource, configPath, previousConfig);
  }

  const yaml = stringifyYaml(config);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(tempPath, yaml, 'utf8');

  try {
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures; the original error is the important one.
    }

    throw error;
  }
}

function saveV4Config(config, configPath, previousConfig) {
  // Pass previousConfig as-is (may be null for fresh installs); buildV4WritePlan handles null as "all new".
  const writePlan = buildV4WritePlan(previousConfig, config);
  const routerDir = config._v4Source.routerDir ?? path.dirname(configPath);

  // Ensure profiles directory exists
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  // Write profiles FIRST (core last for crash safety)
  for (const pw of writePlan.profileWrites) {
    const profilePath = pw.filePath ?? path.join(profilesDir, `${pw.presetName}.router.yaml`);
    const profileDir = path.dirname(profilePath);
    fs.mkdirSync(profileDir, { recursive: true });
    const yaml = stringifyYaml(pw.content);
    const tempPath = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, yaml, 'utf8');

    try {
      fs.renameSync(tempPath, profilePath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failures.
      }

      throw error;
    }
  }

  // Delete removed profiles
  for (const pd of writePlan.profileDeletes) {
    if (pd.filePath && fs.existsSync(pd.filePath)) {
      fs.unlinkSync(pd.filePath);
    }
  }

  // Write core LAST
  if (writePlan.coreChanged) {
    // Strip undefined fields before serialization so they don't appear as `null` in YAML.
    const coreToWrite = Object.fromEntries(
      Object.entries(writePlan.coreContent).filter(([, v]) => v !== undefined)
    );
    const coreYaml = stringifyYaml(coreToWrite);
    const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, coreYaml, 'utf8');

    try {
      fs.renameSync(tempPath, configPath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failures.
      }

      throw error;
    }
  }
}

export const OPENCODE_SESSION_SYNC_CONTRACT_VERSION = '1';
export const TOKEN_BUDGET_HINT_VERSION = '1';

export function createOpenCodeSlashCommandManifest(state = {}, configPath = null) {
  const schemaVersion = state.schemaVersion ?? state.version ?? null;

  return {
    kind: 'opencode-slash-command-manifest',
    contractVersion: OPENCODE_SESSION_SYNC_CONTRACT_VERSION,
    root: '/gsr',
    hostOwned: true,
    external: true,
    nonExecuting: true,
    lifecycle: 'host-local',
    configPath: configPath ?? null,
    schemaVersion,
    activeCatalogName: state.selectedCatalogName ?? null,
    activePresetName: state.selectedPresetName ?? null,
    activeProfileName: state.activeProfileName ?? null,
    commands: [
      // Root
      createSlashCommand('status', 'Current router state, routes, and pricing.', '/gsr status', ['config', 'profile', 'catalog']),
      createSlashCommand('version', 'Show installed gsr version.', '/gsr version', []),
      createSlashCommand('help', 'Help for commands.', '/gsr help [command]', []),
      createSlashCommand('sync', 'Push global contracts to Engram.', '/gsr sync', ['config']),

      // Route
      createSlashCommand('route-use', 'Switch the active preset.', '/gsr route use <preset>', ['profile']),
      createSlashCommand('route-show', 'Show resolved routes for current preset.', '/gsr route show', ['config']),
      createSlashCommand('route-activate', 'gsr takes control of routing.', '/gsr route activate', ['config', 'activation']),
      createSlashCommand('route-deactivate', `Host takes control back.`, '/gsr route deactivate', ['config', 'activation']),

      // Profile
      createSlashCommand('profile-list', 'List profiles.', '/gsr profile list', ['profile']),
      createSlashCommand('profile-create', 'Create an empty profile.', '/gsr profile create <name>', ['profile']),
      createSlashCommand('profile-delete', 'Delete a profile.', '/gsr profile delete <name>', ['profile']),
      createSlashCommand('profile-rename', 'Rename a profile.', '/gsr profile rename <old> <new>', ['profile']),
      createSlashCommand('profile-copy', 'Clone a profile.', '/gsr profile copy <src> <dest>', ['profile']),
      createSlashCommand('export', 'Export a preset for sharing.', '/gsr profile export <name> [--compact]', ['preset']),
      createSlashCommand('import', 'Import a preset.', '/gsr profile import <source>', ['preset', 'profile']),

      // Catalog
      createSlashCommand('catalog-list', 'List catalogs with status.', '/gsr catalog list', ['catalog']),
      createSlashCommand('catalog-create', 'Create a catalog (disabled by default).', '/gsr catalog create <name>', ['catalog']),
      createSlashCommand('catalog-delete', 'Delete an empty catalog.', '/gsr catalog delete <name>', ['catalog']),
      createSlashCommand('catalog-enable', 'Enable catalog in TUI host.', '/gsr catalog enable <name>', ['catalog']),
      createSlashCommand('catalog-disable', 'Disable catalog from TUI host.', '/gsr catalog disable <name>', ['catalog']),
      createSlashCommand('catalog-move', 'Move a profile to another catalog.', '/gsr catalog move <name> <catalog>', ['catalog', 'profile']),
      createSlashCommand('catalog-use', 'Set active catalog and preset.', '/gsr catalog use <catalog> [preset]', ['catalog']),

      // Inspect
      createSlashCommand('inspect-browse', 'Multimodel metadata for a preset.', '/gsr inspect browse [selector]', ['catalog', 'preset']),
      createSlashCommand('inspect-compare', 'Side-by-side preset comparison.', '/gsr inspect compare <a> <b>', ['catalog', 'preset']),
      createSlashCommand('inspect-render', 'Preview host boundary report.', '/gsr inspect render <target>', ['config', 'catalog', 'profile']),

      // Setup
      createSlashCommand('setup-install', 'Install router config.', '/gsr setup install [--intent ...]', ['config']),
      createSlashCommand('setup-uninstall', 'Remove gsr overlay from host config.', '/gsr setup uninstall', ['config']),
      createSlashCommand('setup-bootstrap', 'Guided first-time setup.', '/gsr setup bootstrap [--intent ...]', ['config']),
      createSlashCommand('setup-update', 'Check/apply config migrations.', '/gsr setup update [--apply]', ['config']),
      createSlashCommand('setup-apply', 'Generate TUI overlay.', '/gsr setup apply <target> [--apply]', ['config']),

      // Backward-compat aliases (kept for existing integrations)
      createSlashCommand('use', 'Select the active profile in router/router.yaml.', '/gsr use <profile>', ['profile']),
      createSlashCommand('reload', 'Reload the current config and print the resolved routes.', '/gsr reload', ['config']),
      createSlashCommand('list', 'List available profiles and mark the active one.', '/gsr list', ['config', 'profile']),
      createSlashCommand('browse', 'Inspect shareable multimodel metadata projected from schema v3.', '/gsr browse [selector]', ['catalog', 'preset']),
      createSlashCommand('compare', 'Compare two shareable multimodel projections.', '/gsr compare <left> <right>', ['catalog', 'preset']),
      createSlashCommand('install', 'Inspect or apply a YAML-first install intent.', '/gsr install [--intent ...]', ['config']),
      createSlashCommand('bootstrap', 'Show or apply a step-by-step bootstrap path.', '/gsr bootstrap [--intent ...]', ['config']),
      createSlashCommand('activate', 'Take control of routing without changing the active profile.', '/gsr activate', ['config', 'activation']),
      createSlashCommand('deactivate', `Hand control back to ${resolveControllerLabel()} without changing the active profile.`, '/gsr deactivate', ['config', 'activation']),
      createSlashCommand('render-opencode', 'Preview the OpenCode boundary report.', '/gsr render opencode', ['config', 'catalog', 'profile']),
      createSlashCommand('update', 'Show pending config migrations.', '/gsr update [--apply]', ['config']),
      createSlashCommand('apply-opencode', 'Generate and apply OpenCode overlay.', '/gsr apply opencode [--apply]', ['config']),
      createSlashCommand('uninstall', 'Remove gsr overlay from host config.', '/gsr uninstall', ['config']),
      createSlashCommand('profile-show', 'Show routes for a profile.', '/gsr profile show <name>', ['profile']),
    ],
    syncTriggers: ['config', 'catalog', 'preset', 'profile'],
  };
}

export function createOpenCodeSessionSnapshot(source = {}) {
  const state = source.state ?? {};
  const config = source.config ?? null;
  const commandManifest = source.commandManifest ?? createOpenCodeSlashCommandManifest(state, source.configPath ?? null);
  const configFingerprint = createOpenCodeSessionFingerprint(config, state);
  const rebindToken = createOpenCodeSessionRebindToken(configFingerprint, commandManifest);

  return {
    kind: 'opencode-session-snapshot',
    contractVersion: OPENCODE_SESSION_SYNC_CONTRACT_VERSION,
    configPath: source.configPath ?? null,
    schemaVersion: state.schemaVersion ?? state.version ?? null,
    activeCatalogName: state.selectedCatalogName ?? null,
    activePresetName: state.selectedPresetName ?? null,
    activeProfileName: state.activeProfileName ?? null,
    activationState: state.activationState ?? null,
    configFingerprint,
    rebindToken,
    commandManifest,
  };
}

export function compareOpenCodeSessionSnapshots(previousSnapshot, nextSnapshot) {
  const previous = previousSnapshot ?? null;
  const next = nextSnapshot ?? null;

  if (!previous) {
    return {
      kind: 'opencode-session-snapshot-diff',
      changed: false,
      changedFields: [],
      previousRebindToken: null,
      nextRebindToken: next?.rebindToken ?? null,
    };
  }

  const changedFields = [];

  if (previous?.configFingerprint !== next?.configFingerprint) changedFields.push('configFingerprint');
  if (previous?.schemaVersion !== next?.schemaVersion) changedFields.push('schemaVersion');
  if (previous?.activeCatalogName !== next?.activeCatalogName) changedFields.push('activeCatalogName');
  if (previous?.activePresetName !== next?.activePresetName) changedFields.push('activePresetName');
  if (previous?.activeProfileName !== next?.activeProfileName) changedFields.push('activeProfileName');
  if (previous?.activationState !== next?.activationState) changedFields.push('activationState');
  if (previous?.rebindToken !== next?.rebindToken) changedFields.push('rebindToken');
  if (previous?.commandManifest?.commands?.length !== next?.commandManifest?.commands?.length) changedFields.push('commandManifest');

  return {
    kind: 'opencode-session-snapshot-diff',
    changed: changedFields.length > 0,
    changedFields,
    previousRebindToken: previous?.rebindToken ?? null,
    nextRebindToken: next?.rebindToken ?? null,
  };
}

export function createOpenCodeSessionSyncContract(source = {}) {
  const previousSnapshot = source.previousSnapshot ?? null;
  const state = source.state ?? {};

  if (source.invalidReason) {
    const preservedSnapshot = previousSnapshot ?? null;

    return {
      kind: 'opencode-session-sync-contract',
      contractVersion: OPENCODE_SESSION_SYNC_CONTRACT_VERSION,
      status: 'invalid-config',
      supported: true,
      live: false,
      hostOwned: true,
      external: true,
      nonExecuting: true,
      configPath: source.configPath ?? null,
      reason: source.invalidReason,
      configFingerprint: preservedSnapshot?.configFingerprint ?? null,
      rebindToken: preservedSnapshot?.rebindToken ?? null,
      commandManifest: preservedSnapshot?.commandManifest ?? createOpenCodeSlashCommandManifest(state, source.configPath ?? null),
      previousSnapshot,
      currentSnapshot: preservedSnapshot,
      lastKnownGoodSnapshot: preservedSnapshot,
      diff: preservedSnapshot
        ? compareOpenCodeSessionSnapshots(previousSnapshot, preservedSnapshot)
        : { kind: 'opencode-session-snapshot-diff', changed: false, changedFields: [], previousRebindToken: null, nextRebindToken: null },
      rebindRequired: false,
      preservedSnapshot: Boolean(preservedSnapshot),
      syncTriggers: ['config', 'catalog', 'preset', 'profile'],
      exposure: createOpenCodeSlashCommandManifest(state, source.configPath ?? null),
    };
  }

  const currentSnapshot = createOpenCodeSessionSnapshot({
    config: source.config ?? null,
    state,
    configPath: source.configPath ?? null,
    commandManifest: source.commandManifest,
  });
  const diff = compareOpenCodeSessionSnapshots(previousSnapshot, currentSnapshot);
  const tokenBudgetHint = createTokenBudgetHint(source.config ?? null, state);

  return {
    kind: 'opencode-session-sync-contract',
    contractVersion: OPENCODE_SESSION_SYNC_CONTRACT_VERSION,
    status: diff.changed ? 'rebind-required' : 'ready',
    supported: true,
    live: true,
    hostOwned: true,
    external: true,
    nonExecuting: true,
    configPath: source.configPath ?? null,
    reason: diff.changed
      ? 'Config, catalog, preset, or profile data changed; rebind the host slash-command registry in place.'
      : 'The active host session bindings are already current.',
    configFingerprint: currentSnapshot.configFingerprint,
    rebindToken: currentSnapshot.rebindToken,
    commandManifest: currentSnapshot.commandManifest,
    previousSnapshot,
    currentSnapshot,
    lastKnownGoodSnapshot: currentSnapshot,
    diff,
    rebindRequired: diff.changed,
    preservedSnapshot: false,
    syncTriggers: currentSnapshot.commandManifest.syncTriggers,
    exposure: currentSnapshot.commandManifest,
    tokenBudgetHint,
  };
}

/**
 * Build a token budget hint from the active preset's lane metadata.
 * The hint is a declarative metadata contract — gsr does NOT track runtime
 * consumption. The TUI host uses these denominators to render budget bars.
 *
 * @param {object} config - Loaded (assembled) router config
 * @param {object} state - Resolved router state
 * @returns {object|null} Token budget hint contract, or null when data is unavailable
 */
export function createTokenBudgetHint(config, state) {
  if (!config?.catalogs || !state) return null;

  const catalogName = state.selectedCatalogName ?? null;
  const presetName = state.selectedPresetName ?? state.activeProfileName ?? null;
  if (!catalogName || !presetName) return null;

  const catalog = config.catalogs[catalogName];
  if (!catalog) return null;

  const preset = catalog.presets?.[presetName];
  if (!preset?.phases) return null;

  const phases = {};
  let hasAnyBudgetData = false;

  for (const [phaseName, lanes] of Object.entries(preset.phases)) {
    if (!Array.isArray(lanes) || lanes.length === 0) continue;
    const lane = lanes[0]; // Primary lane
    if (!lane || typeof lane !== 'object') continue;

    const contextWindow = isPositiveInt(lane.contextWindow) ? lane.contextWindow : null;
    const inputCostPerMillion = isNumeric(lane.inputPerMillion) ? Number(lane.inputPerMillion) : null;
    const outputCostPerMillion = isNumeric(lane.outputPerMillion) ? Number(lane.outputPerMillion) : null;
    const target = typeof lane.target === 'string' ? lane.target : null;

    if (contextWindow !== null || inputCostPerMillion !== null || outputCostPerMillion !== null) {
      hasAnyBudgetData = true;
    }

    phases[phaseName] = {
      target,
      contextWindow,
      inputCostPerMillion,
      outputCostPerMillion,
    };
  }

  if (!hasAnyBudgetData) return null;

  return {
    kind: 'token-budget-hint',
    contractVersion: TOKEN_BUDGET_HINT_VERSION,
    catalogName,
    presetName,
    phases,
    policy: {
      nonExecuting: true,
      informationalOnly: true,
      hostAccumulates: true,
    },
  };
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isNumeric(v) {
  return v !== null && v !== undefined && Number.isFinite(Number(v));
}

function createSlashCommand(id, summary, command, syncTriggers = []) {
  return {
    id,
    command,
    summary,
    syncTriggers,
    hostOwned: true,
    external: true,
    nonExecuting: true,
    lifecycle: 'host-local',
  };
}

function createOpenCodeSessionFingerprint(config, state) {
  return createStableFingerprint({
    config: config ?? null,
    state: {
      schemaVersion: state?.schemaVersion ?? state?.version ?? null,
      activeCatalogName: state?.selectedCatalogName ?? null,
      activePresetName: state?.selectedPresetName ?? null,
      activeProfileName: state?.activeProfileName ?? null,
      activationState: state?.activationState ?? null,
      laneRoles: state?.laneRoles ?? [],
      compatibilityNotes: state?.compatibilityNotes ?? [],
      resolvedPhases: state?.resolvedPhases ?? null,
    },
  });
}

function createOpenCodeSessionRebindToken(configFingerprint, commandManifest) {
  return createStableFingerprint({
    configFingerprint,
    root: commandManifest.root,
    commands: commandManifest.commands.map((command) => command.command),
    syncTriggers: commandManifest.syncTriggers,
  });
}

function createStableFingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function attachOpenCodeSessionSyncContract(report, sessionSyncContract) {
  return {
    ...report,
    sessionSyncContract,
    slashCommandManifest: sessionSyncContract.commandManifest,
  };
}

function attachHandoffDelegationContract(report, runtimeContext, command) {
  const withHandoff = {
    ...report,
    handoffDelegationContract: buildHandoffDelegationContract({
      command,
      runtimeContext,
      report,
    }),
  };

  return {
    ...withHandoff,
    agentTeamsLiteContract: createAgentTeamsLiteIntegrationContract(withHandoff, {
      command,
      runtimeContext,
    }),
  };
}

function attachRouterSchemaFacts(report, state) {
  return {
    ...report,
    routerSchemaContract: state.routerSchemaContract ?? null,
    schemaVersion: state.schemaVersion ?? state.version ?? null,
    selectedCatalogName: state.selectedCatalogName ?? null,
    selectedPresetName: state.selectedPresetName ?? null,
    compatibilityNotes: state.compatibilityNotes ?? [],
    laneRoles: state.laneRoles ?? [],
  };
}

export {
  HANDOFF_DELEGATION_CONTRACT_VERSION,
  DEFAULT_MULTIMODEL_VISIBILITY,
  MULTIMODEL_CONTRACT_VERSION,
  MULTIMODEL_ORCHESTRATION_MANAGER_CONTRACT_VERSION,
  createHandoffDelegationBoundary,
  createHandoffDelegationRequestEnvelope,
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  createMultimodelOrchestrationManagerContract,
  validateHandoffDelegationRequest,
  createProviderExecutionBoundary,
  createProviderExecutionCapabilityEnvelope,
  createProviderExecutionErrorEnvelope,
  createProviderExecutionRequestEnvelope,
  createProviderExecutionResultEnvelope,
  projectShareableMultimodelMetadata,
  createAgentTeamsLiteIntegrationContract,
  normalizeAgentTeamsLiteStatus,
  listProfiles,
  resolveActivationState,
  resolveRouterState,
  validateProviderExecutionRequest,
  setActiveProfile,
  setActivationState,
};

function buildInstallationSurfaceReport(command, options, context) {
  const runtimeContext = context?.supported === undefined
    ? detectOpenCodeRuntimeContext(context)
    : context;
  const capabilities = getOpenCodeCapabilities(runtimeContext);
  let configPath = discoverConfigPath([runtimeContext.cwd]);
  let normalizedIntent;
  let freshInstallCreated = false;

  if (!capabilities.platformValidated) {
    const runtimeContract = evaluateOpenCodeRuntimeContract({
      command,
      context: runtimeContext,
      intent: options.intent,
      configAvailable: Boolean(configPath),
      configValid: Boolean(configPath),
    });

    return attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'unsupported-platform',
      supported: false,
      reason: 'OpenCode install/bootstrap is only supported on Linux/WSL.',
      capabilities,
      runtimeContract,
      providerExecutionContract: runtimeContract.providerExecutionContract,
    }, runtimeContext, command);
  }

  try {
    normalizedIntent = normalizeInstallIntent(options.intent);
  } catch (error) {
    const runtimeContract = evaluateOpenCodeRuntimeContract({
      command,
      context: runtimeContext,
      intent: options.intent,
      configAvailable: Boolean(configPath),
      configValid: Boolean(configPath),
    });

    return attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'invalid-intent',
      supported: true,
      configPath: configPath ?? undefined,
      reason: error instanceof Error ? error.message : String(error),
      capabilities,
      runtimeContract,
      providerExecutionContract: runtimeContract.providerExecutionContract,
    }, runtimeContext, command);
  }

  const freshConfigPath = path.join(runtimeContext.cwd, 'router', 'router.yaml');
  let installRouteProposalContract = null;

  if (!configPath) {
    if (command === 'install') {
      const starterConfig = createFreshInstallConfig();

      if (options.apply === false) {
        const plannedConfig = normalizedIntent.length > 0
          ? applyInstallIntent(starterConfig, options.intent)
          : starterConfig;
        const plannedState = resolveRouterState(plannedConfig);
        const plannedActivation = resolveActivationState(plannedConfig);
        installRouteProposalContract = createInstallRouteProposalContract({
          configPath: freshConfigPath,
          intent: options.intent ?? null,
          directives: normalizedIntent,
          state: plannedState,
          activation: plannedActivation,
        });
        const runtimeContract = evaluateOpenCodeRuntimeContract({
          command,
          context: runtimeContext,
          intent: options.intent,
          configAvailable: false,
          configValid: true,
        });

        return attachHandoffDelegationContract({
          ...attachRouterSchemaFacts({}, plannedState),
          command,
          target: 'opencode',
          status: 'planned',
          supported: true,
          configPath: freshConfigPath,
          activeProfileName: plannedState.activeProfileName,
          activationState: plannedActivation.state,
          effectiveController: plannedActivation.effectiveController,
          resolvedPhases: plannedState.resolvedPhases,
          installRouteProposalContract,
          reason: 'A starter router/router.yaml would be created from scratch on apply.',
          nextSteps: [
            'Run gsr install to create router/router.yaml with the starter schema v1 contract.',
            'Or keep the shell-only flow and review the starter file before applying.',
          ],
          capabilities,
          runtimeContract: {
            ...runtimeContract,
            fallback: {
              verdict: 'minimal-fallback',
              target: 'shell',
              reason: 'No router/router.yaml exists yet; the install path can materialize a starter YAML contract on apply.',
            },
          },
          providerExecutionContract: runtimeContract.providerExecutionContract,
        }, runtimeContext, command);
      }

      const nextConfig = normalizedIntent.length > 0
        ? applyInstallIntent(starterConfig, options.intent)
        : starterConfig;
      const freshNextState = resolveRouterState(nextConfig);
      const freshNextActivation = resolveActivationState(nextConfig);
      installRouteProposalContract = createInstallRouteProposalContract({
        configPath: freshConfigPath,
        intent: options.intent ?? null,
        directives: normalizedIntent,
        state: freshNextState,
        activation: freshNextActivation,
      });

      try {
        fs.mkdirSync(path.dirname(freshConfigPath), { recursive: true });
        saveRouterConfig(nextConfig, freshConfigPath);
      } catch (error) {
        const runtimeContract = evaluateOpenCodeRuntimeContract({
          command,
          context: runtimeContext,
          intent: options.intent,
          configAvailable: false,
          configValid: false,
        });

        return attachHandoffDelegationContract({
          command,
          target: 'opencode',
          status: 'invalid-config',
          supported: true,
          configPath: freshConfigPath,
          reason: error instanceof Error ? error.message : String(error),
          capabilities,
          runtimeContract,
          providerExecutionContract: runtimeContract.providerExecutionContract,
        }, runtimeContext, command);
      }

      configPath = freshConfigPath;
      freshInstallCreated = true;
    } else if (command === 'bootstrap') {
      const runtimeContract = evaluateOpenCodeRuntimeContract({
        command,
        context: runtimeContext,
        intent: options.intent,
        configAvailable: false,
        configValid: false,
      });

      return attachHandoffDelegationContract({
        command,
        target: 'opencode',
        status: 'shell-ready',
        supported: true,
        reason: 'No router/router.yaml exists yet; bootstrap can create the minimal YAML contract on the next step.',
        nextSteps: [
          'Create router/router.yaml with version: 1 and a profile.',
          'Run gsr bootstrap --apply once the config exists, or keep using the shell step-by-step flow.',
          'Run gsr status to validate the adopted repo state.',
        ],
        capabilities,
        runtimeContract: {
          ...runtimeContract,
          fallback: {
            verdict: 'minimal-fallback',
            target: 'shell',
            reason: 'Use the shell bootstrap path until router/router.yaml exists.',
          },
        },
        providerExecutionContract: runtimeContract.providerExecutionContract,
      }, runtimeContext, command);
    }

    if (!configPath) {
      const runtimeContract = evaluateOpenCodeRuntimeContract({
        command,
        context: runtimeContext,
        intent: options.intent,
        configAvailable: false,
        configValid: false,
      });

      return attachHandoffDelegationContract({
        command,
        target: 'opencode',
        status: 'missing-config',
        supported: capabilities.platformValidated,
        reason: 'router/router.yaml was not found for the install/bootstrap surface.',
        capabilities,
        runtimeContract,
        providerExecutionContract: runtimeContract.providerExecutionContract,
      }, runtimeContext, command);
    }
  }

  const runtimeContract = evaluateOpenCodeRuntimeContract({
    command,
    context: runtimeContext,
    intent: options.intent,
    configAvailable: true,
    configValid: true,
  });
  const providerExecutionContract = runtimeContract.providerExecutionContract;

  try {
    const config = loadRouterConfig(configPath);
    const state = resolveRouterState(config);
    const activation = resolveActivationState(config);
    const routerSchemaFacts = attachRouterSchemaFacts({}, state);
    const intent = options.intent;

    if (command === 'bootstrap' && !options.apply) {
      const guidance = describeInstallBootstrap(config, intent);

      return attachHandoffDelegationContract({
        ...routerSchemaFacts,
        command,
        target: 'opencode',
        status: guidance.status,
        supported: true,
        configPath,
        activeProfileName: state.activeProfileName,
        activationState: activation.state,
        effectiveController: activation.effectiveController,
        resolvedPhases: state.resolvedPhases,
        reason: guidance.reason,
        nextSteps: guidance.nextSteps,
        capabilities,
        runtimeContract: {
          ...runtimeContract,
          fallback: {
            verdict: 'minimal-fallback',
            target: 'shell',
            reason: 'The bootstrap surface stays shell-first until an explicit apply is requested.',
          },
        },
        providerExecutionContract,
      }, runtimeContext, command);
    }

    if (normalizedIntent.length === 0) {
      const freshInstallStatus = command === 'install' && freshInstallCreated;

      return attachHandoffDelegationContract({
        ...routerSchemaFacts,
        command,
        target: 'opencode',
        status: freshInstallStatus ? 'created' : 'ready',
        supported: true,
        configPath,
        activeProfileName: state.activeProfileName,
        activationState: activation.state,
        effectiveController: activation.effectiveController,
        resolvedPhases: state.resolvedPhases,
        ...(freshInstallStatus && installRouteProposalContract ? { installRouteProposalContract } : {}),
        reason: freshInstallStatus
          ? 'Created router/router.yaml from scratch with the starter schema v1 contract.'
          : command === 'bootstrap'
          ? 'Bootstrap is available; use the shell step-by-step mode or provide an explicit intent.'
          : 'Installation contract is valid and ready for YAML-first updates.',
        nextSteps: command === 'bootstrap'
          ? [
              'Run gsr bootstrap --intent "profile=<name>; activation=active|inactive" --apply to persist a YAML update.',
              'Or edit router/router.yaml directly and re-run gsr status.',
            ]
          : undefined,
        capabilities,
        runtimeContract: {
          ...runtimeContract,
          fallback: {
            verdict: 'minimal-fallback',
            target: 'config',
            reason: command === 'bootstrap'
              ? 'Use the shell bootstrap path or apply the YAML contract explicitly.'
              : 'Keep the adapter configuration-backed; no provider execution is involved.',
          },
        },
        providerExecutionContract,
      }, runtimeContext, command);
    }

    const nextConfig = applyInstallIntent(config, intent);
    const changed = JSON.stringify(nextConfig) !== JSON.stringify(config);

    if (changed && options.apply !== false) {
      saveRouterConfig(nextConfig, configPath);
    }

    const nextState = resolveRouterState(nextConfig);
    const nextActivation = resolveActivationState(nextConfig);
    const freshInstallStatus = command === 'install' && freshInstallCreated;

      return attachHandoffDelegationContract({
        ...routerSchemaFacts,
        command,
        target: 'opencode',
        status: freshInstallStatus
          ? 'created'
          : changed
            ? (options.apply === false ? 'planned' : 'updated')
            : 'noop',
        supported: true,
        configPath,
        activeProfileName: nextState.activeProfileName,
        activationState: nextActivation.state,
        effectiveController: nextActivation.effectiveController,
        resolvedPhases: nextState.resolvedPhases,
        ...(freshInstallStatus ? { installRouteProposalContract } : {}),
        reason: freshInstallStatus
          ? 'Created router/router.yaml from scratch and applied the install intent.'
          : changed
          ? options.apply === false
            ? 'The install intent maps cleanly to router/router.yaml but was not applied.'
          : 'The install intent was applied to router/router.yaml.'
        : 'The install intent already matches router/router.yaml.',
      nextSteps: command === 'bootstrap' && options.apply !== true
        ? [
            'Re-run with --apply to persist the proposed YAML change.',
            'Or edit router/router.yaml manually and use gsr status to validate the result.',
          ]
        : undefined,
      capabilities,
      runtimeContract: {
        ...runtimeContract,
        fallback: {
          verdict: 'minimal-fallback',
          target: 'config',
          reason: options.apply === false
            ? 'The runtime contract stays configuration-backed until --apply persists the YAML update.'
            : 'The runtime contract stays configuration-backed; no provider execution is involved.',
        },
      },
      providerExecutionContract,
    }, runtimeContext, command);
  } catch (error) {
    return attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'invalid-config',
      supported: capabilities.platformValidated,
      configPath,
      reason: error instanceof Error ? error.message : String(error),
      capabilities,
      runtimeContract: {
        ...runtimeContract,
        supportLevel: 'unsupported',
        supported: false,
        capabilities: {
          ...runtimeContract.capabilities,
          configBackedRouting: {
            state: 'unsupported',
            reason: 'The router config is invalid.',
          },
        },
        fallback: {
          verdict: 'no-safe-fallback',
          target: 'none',
          reason: 'The router config is invalid, so no safe fallback can be trusted.',
        },
      },
      providerExecutionContract,
    }, runtimeContext, command);
  }
}

function createFreshInstallConfig() {
  const coreConfig = {
    version: 4,
    active_preset: 'multivendor',
    activation_state: 'inactive',
    metadata: {
      installation_contract: {
        source_of_truth: 'router/router.yaml',
        install_command: 'gsr install',
        bootstrap_command: 'gsr bootstrap',
        shell_fallback: 'gsr bootstrap --no-apply',
        runtime_execution: false,
      },
    },
  };

  const starterProfile = createFreshInstallStarterProfile();
  const profiles = [
    {
      filePath: null,
      fileName: 'multivendor.router.yaml',
      catalogName: 'default',
      content: starterProfile,
    },
  ];

  return assembleV4Config(coreConfig, profiles);
}

function createFreshInstallStarterProfile() {
  return {
    name: 'multivendor',
    availability: 'stable',
    aliases: 'latest',
    complexity: 'high',
    phases: {
      orchestrator: [{ target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary', fallbacks: 'openai/gpt-5', contextWindow: 200000 }],
      explore: [{ target: 'google/gemini-pro', kind: 'lane', phase: 'explore', role: 'primary', fallbacks: 'anthropic/claude-sonnet', contextWindow: 2000000 }],
      spec: [{ target: 'anthropic/claude-opus', kind: 'lane', phase: 'spec', role: 'primary', fallbacks: 'openai/gpt-5', contextWindow: 200000 }],
      design: [{ target: 'anthropic/claude-opus', kind: 'lane', phase: 'design', role: 'primary', fallbacks: 'openai/gpt-5', contextWindow: 200000 }],
      tasks: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'tasks', role: 'primary', fallbacks: 'openai/gpt', contextWindow: 200000 }],
      apply: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'apply', role: 'primary', fallbacks: 'openai/gpt-5', contextWindow: 200000 }],
      verify: [{ target: 'openai/gpt-5', kind: 'lane', phase: 'verify', role: 'judge', fallbacks: 'anthropic/claude-opus', contextWindow: 1000000 }],
      archive: [{ target: 'google/gemini-flash', kind: 'lane', phase: 'archive', role: 'primary', fallbacks: 'anthropic/claude-haiku', contextWindow: 1000000 }],
    },
  };
}

function createInstallRouteProposalContract({ configPath, intent, directives, state, activation }) {
  const routePlan = Object.fromEntries(Object.entries(state.resolvedPhases ?? {}).map(([phaseName, phase]) => [
    phaseName,
    {
      active: phase.active,
      candidates: [...(phase.candidates ?? [])],
    },
  ]));

  const contract = {
    kind: 'install-route-proposal',
    contractVersion: '1',
    source: {
      configPath,
      intent,
    },
    directives,
    proposal: {
      safe: true,
      activeProfileName: state.activeProfileName,
      activationState: activation.state,
      effectiveController: activation.effectiveController,
      routePlan,
      rationale: activation.state === 'active'
        ? 'Fresh install created router/router.yaml and left control with gsr as requested.'
        : `Fresh install created router/router.yaml and left control with ${resolveControllerLabel()} as requested.`,
    },
    policy: {
      nonExecuting: true,
      nonOwning: true,
      routerExternal: true,
    },
  };

  return {
    ...contract,
    planToken: createStableFingerprint(contract),
    rebindToken: createStableFingerprint({
      contract,
      source: contract.source,
      directives: contract.directives,
    }),
  };
}


function buildOpenCodeSurfaceReport(command, context) {
  const runtimeContext = context?.supported === undefined
    ? detectOpenCodeRuntimeContext(context)
    : context;
  const capabilities = getOpenCodeCapabilities(runtimeContext);
  const runtimeContract = evaluateOpenCodeRuntimeContract({
    command,
    context: runtimeContext,
    configAvailable: Boolean(discoverConfigPath([runtimeContext.cwd, runtimeContext.moduleDir])),
  });
  const providerExecutionContract = runtimeContract.providerExecutionContract;

  if (!capabilities.platformValidated) {
    return attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'unsupported-platform',
      supported: false,
      reason: 'OpenCode adapter is only supported on Linux/WSL.',
      capabilities,
      runtimeContract,
      providerExecutionContract,
    }, runtimeContext, command);
  }

  const configPath = discoverConfigPath([runtimeContext.cwd, runtimeContext.moduleDir]);

  if (!configPath) {
    return attachMultimodelOrchestrationManagerContract(attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'missing-config',
      supported: capabilities.platformValidated,
      reason: 'router/router.yaml was not found for the OpenCode surface.',
      capabilities,
      runtimeContract,
      providerExecutionContract,
    }, runtimeContext, command));
  }

  try {
    const config = loadRouterConfig(configPath);
    const activation = resolveActivationState(config);
    const state = resolveRouterState(config);

    if (command === 'activate' || command === 'deactivate') {
      const nextState = command === 'activate' ? 'active' : 'inactive';
      const nextConfig = setActivationState(config, nextState);

      if (activation.state !== nextState) {
        saveRouterConfig(nextConfig, configPath);
      }

      const nextStateReport = resolveRouterState(nextConfig);
      const nextActivation = resolveActivationState(nextConfig);

      return attachMultimodelOrchestrationManagerContract(attachHandoffDelegationContract({
        ...attachRouterSchemaFacts({}, nextStateReport),
        command,
        target: 'opencode',
        status: activation.state === nextState ? 'noop' : 'updated',
        supported: true,
        configPath,
        activeProfileName: nextStateReport.activeProfileName,
        activationState: nextActivation.state,
        effectiveController: nextActivation.effectiveController,
        resolvedPhases: nextStateReport.resolvedPhases,
        reason: activation.state === nextState
          ? `OpenCode activation is already ${nextState}.`
          : `OpenCode activation_state persisted as ${nextState}.`,
        capabilities,
        runtimeContract: {
          ...runtimeContract,
          fallback: {
            verdict: 'minimal-fallback',
            target: 'config',
            reason: 'Activation toggles remain configuration-backed and non-executing.',
          },
        },
        providerExecutionContract,
      }, runtimeContext, command));
    }

    const stateReport = attachRouterSchemaFacts({
      command,
      target: 'opencode',
      status: 'degraded',
      supported: true,
      configPath,
      activeProfileName: state.activeProfileName,
      activationState: activation.state,
      effectiveController: activation.effectiveController,
      resolvedPhases: state.resolvedPhases,
      reason: 'OpenCode render is configuration-backed only; provider execution is not implemented yet.',
      capabilities,
      runtimeContract,
      providerExecutionContract,
    }, state);

    const sessionSyncContract = createOpenCodeSessionSyncContract({
      config,
      state,
      configPath,
      previousSnapshot: runtimeContext.previousSessionSnapshot ?? null,
    });

    return attachMultimodelOrchestrationManagerContract(attachOpenCodeSessionSyncContract(
      attachHandoffDelegationContract(stateReport, runtimeContext, command),
      sessionSyncContract,
    ));
  } catch (error) {
    const sessionSyncContract = createOpenCodeSessionSyncContract({
      config: null,
      state: {},
      configPath,
      previousSnapshot: runtimeContext.previousSessionSnapshot ?? null,
      invalidReason: error instanceof Error ? error.message : String(error),
    });

    return attachMultimodelOrchestrationManagerContract(attachOpenCodeSessionSyncContract(attachHandoffDelegationContract({
      command,
      target: 'opencode',
      status: 'invalid-config',
      supported: capabilities.platformValidated,
      configPath,
      reason: error instanceof Error ? error.message : String(error),
      capabilities,
      runtimeContract: {
        ...runtimeContract,
        supportLevel: 'unsupported',
        supported: false,
        capabilities: {
          ...runtimeContract.capabilities,
          configBackedRouting: {
            state: 'unsupported',
            reason: 'The router config is invalid.',
          },
        },
        fallback: {
          verdict: 'no-safe-fallback',
          target: 'none',
          reason: 'The router config is invalid, so no safe fallback can be trusted.',
        },
      },
      providerExecutionContract,
    }, runtimeContext, command), sessionSyncContract));
  }
}

function attachMultimodelOrchestrationManagerContract(report) {
  if (!report?.routerSchemaContract) {
    return report;
  }

  return {
    ...report,
    multimodelOrchestrationManagerContract: createMultimodelOrchestrationManagerContract({
      schemaFacts: report.routerSchemaContract,
      reportRefs: {
        runtimeContract: report.runtimeContract,
        providerExecutionContract: report.providerExecutionContract,
        handoffDelegationContract: report.handoffDelegationContract,
        agentTeamsLiteContract: report.agentTeamsLiteContract,
      },
      parentPlanId: `${report.command ?? 'render'}:${report.activeProfileName ?? report.selectedPresetName ?? 'unknown'}`,
      handoffTarget: report.handoffDelegationContract?.boundary?.consumerOwners?.[0] ?? null,
    }),
  };
}

function buildHandoffDelegationContract({ command, runtimeContext, report }) {
  const compatibility = classifyHandoffCompatibility(report, runtimeContext);
  const request = createHandoffDelegationRequestEnvelope({
    trigger: {
      kind: 'opencode-handoff-trigger',
      command,
      target: 'opencode',
      status: report.status,
      supported: report.supported,
    },
    payload: {
      requestedOutcome: command,
      command,
      target: 'opencode',
      status: report.status,
      configPath: report.configPath ?? null,
      activeProfileName: report.activeProfileName ?? null,
      activationState: report.activationState ?? null,
      effectiveController: report.effectiveController ?? null,
      resolvedPhases: report.resolvedPhases ?? null,
    },
    contextCapsule: {
      kind: 'handoff-context-capsule',
      scope: 'report-only',
      routingFacts: {
        command,
        target: 'opencode',
        status: report.status,
        supported: report.supported,
        providerExecutionStatus: report.providerExecutionContract?.status ?? null,
      },
      environmentHints: {
        platform: runtimeContext.platform,
        release: runtimeContext.release,
        cwd: runtimeContext.cwd,
      },
      minimalState: {
        configPath: report.configPath ?? null,
        activeProfileName: report.activeProfileName ?? null,
        activationState: report.activationState ?? null,
        effectiveController: report.effectiveController ?? null,
        resolvedPhases: report.resolvedPhases ?? null,
      },
    },
    compatibility,
    contractVersion: HANDOFF_DELEGATION_CONTRACT_VERSION,
    consumerContractVersion: HANDOFF_DELEGATION_CONTRACT_VERSION,
    downstreamConsumer: 'agent-teams-lite',
  });

  return validateHandoffDelegationRequest(request, createHandoffDelegationBoundary());
}

function classifyHandoffCompatibility(report, runtimeContext) {
  if (runtimeContext?.supported === false) {
    return 'unsupported';
  }

  if (report.status === 'invalid-config' || report.status === 'invalid-intent') {
    return 'unsupported';
  }

  if (report.status === 'missing-config' || report.status === 'shell-ready') {
    return 'limited';
  }

  return 'supported';
}

// ── OpenCode Overlay Generation ──────────────────────────────────────────────

export const mapPermissions = _mapPermissions;
export const generateOpenCodeOverlay = _generateOpenCodeOverlay;
export const mergeOverlayWithExisting = _mergeOverlayWithExisting;
export const mergeOverlayWithFile = _mergeOverlayWithFile;
export const writeOpenCodeConfig = _writeOpenCodeConfig;
export const OPENCODE_CONFIG_PATH = _OPENCODE_CONFIG_PATH;
export const GSR_AGENT_PREFIX = _GSR_AGENT_PREFIX;

/**
 * Facade for the `gsr apply opencode [--apply]` CLI command.
 * Returns a structured report; the CLI is responsible for printing and writing.
 *
 * @param {{ apply?: boolean, configPath?: string, targetPath?: string }} options
 * @returns {{ agents: Record<string, object>, warnings: string[], writtenPath?: string }}
 */
export function applyOpenCodeOverlayCommand(options = {}) {
  const config = loadRouterConfig(options.configPath ?? getConfigPath());
  const overlay = _generateOpenCodeOverlay(config);

  if (!options.apply) {
    return { agents: overlay.agent, warnings: overlay.warnings };
  }

  const merged = _mergeOverlayWithFile(overlay, options.targetPath);
  const writtenPath = _writeOpenCodeConfig(merged, options.targetPath);

  return { agents: overlay.agent, warnings: overlay.warnings, writtenPath };
}
