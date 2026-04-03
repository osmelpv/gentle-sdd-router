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

export { CANONICAL_PHASES as CANONICAL_PHASES_FULL, PHASE_METADATA } from './core/phases.js';
export { syncContracts, findContractsDir, readContracts, generateSyncManifest, readCatalogContracts } from './core/sync.js';
export { unifiedSync } from './core/unified-sync.js';

export {
  validateSddYaml,
  loadCustomSdds,
  loadCustomSdd,
  createCustomSdd,
  deleteCustomSdd,
  resolveContract,
  addPhaseInvoke,
  validateSddFull,
  listDeclaredInvocations,
} from './core/sdd-catalog-io.js';

export { shouldInvokeDebug } from './core/debug-invoke.js';

export {
  createInvocation,
  readInvocation,
  listInvocations,
  completeInvocation,
  getInvocationsDir,
} from './core/sdd-invocation-io.js';

export { loadPhaseMetadataForCatalog } from './core/phases.js';

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
  createProfile,
  updateProfile,
  deleteProfile,
  renameProfile,
  copyProfile,
  moveProfile,
  listCatalogs,
  createCatalog,
  deleteCatalog,
  getCatalogDisplayName,
  setCatalogEnabled,
} from './core/preset-io.js';

export {
  planMigrations,
  runMigrations,
  loadMigrationsRegistry,
} from './core/migrations/index.js';

export { resolveControllerLabel, resolveExecutionOwners, detectGentleAi, resolvePersona } from './core/controller.js';

export { resolveIdentity, readAgentsMd, resetIdentityCache, NEUTRAL_FALLBACK_PROMPT } from './core/agent-identity.js';
export {
  getGlobalSddAgentSpecs,
  DEFAULT_PRESET as DEFAULT_GLOBAL_SDD_PRESET,
  DEFAULT_DEBUG_PRESET as DEFAULT_GLOBAL_DEBUG_PRESET,
} from './core/global-sdd-agent-routing.js';
export { getProjectSddAgentSpecs } from './core/project-sdd-agent-routing.js';

export { removeOpenCodeOverlay, deployGsrCommands, removeGsrCommands, cleanStaleGlobalOverlay } from './adapters/opencode/overlay-generator.js';
export { materializeGlobalSddAgents } from './adapters/opencode/global-sdd-agent-materializer.js';
export { materializeProjectSddAgents } from './adapters/opencode/project-sdd-agent-materializer.js';

export {
  createAgentTeamsLiteIntegrationContract,
  compareOpenCodeSessionSnapshots,
  createMultimodelBrowseContract,
  createMultimodelCompareContract,
  createMultimodelOrchestrationManagerContract,
  createOpenCodeSessionSnapshot,
  createOpenCodeSessionSyncContract,
  createOpenCodeSlashCommandManifest,
  createTokenBudgetHint,
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
