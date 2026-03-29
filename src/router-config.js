export {
  CANONICAL_PHASES,
  applyInstallIntent,
  describeInstallBootstrap,
  listProfiles,
  parseYaml,
  normalizeInstallIntent,
  normalizeRouterSchemaV3,
  resolveActivationState,
  resolveRouterState,
  setActivationState,
  setActiveProfile,
  stringifyYaml,
  validateRouterSchemaV3,
  validateRouterConfig,
} from './core/router.js';

export {
  loadV4Profiles,
  assembleV4Config,
  disassembleV4Config,
  buildV4WritePlan,
  validateProfileFile,
} from './core/router-v4-io.js';

export {
  exportPreset,
  exportPresetCompact,
  exportAllPresets,
  importPresetFromYaml,
  importPresetFromCompact,
  importPresetFromUrl,
  encodeCompactString,
  decodeCompactString,
  COMPACT_PREFIX,
} from './core/preset-io.js';

export {
  planMigrations,
  runMigrations,
  loadMigrationsRegistry,
} from './core/migrations/index.js';

export { resolveControllerLabel, resolveExecutionOwners, detectGentleAi } from './core/controller.js';

export {
  createAgentTeamsLiteIntegrationContract,
  compareOpenCodeSessionSnapshots,
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  createMultimodelOrchestrationManagerContract,
  createOpenCodeSessionSnapshot,
  createOpenCodeSessionSyncContract,
  createOpenCodeSlashCommandManifest,
  discoverConfigPath,
  detectOpenCodeRuntimeContext,
  activateOpenCodeCommand,
  applyOpenCodeOverlayCommand,
  bootstrapOpenCodeCommand,
  deactivateOpenCodeCommand,
  findProjectRoot,
  formatConfigPathForDisplay,
  generateOpenCodeOverlay,
  getConfigPath,
  getOpenCodeCapabilities,
  loadRouterConfig,
  installOpenCodeCommand,
  renderOpenCodeCommand,
  saveRouterConfig,
  projectShareableMultimodelMetadata,
  tryGetConfigPath,
} from './adapters/opencode/index.js';
