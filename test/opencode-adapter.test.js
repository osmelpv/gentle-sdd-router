import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  activateOpenCodeCommand,
  bootstrapOpenCodeCommand,
  deactivateOpenCodeCommand,
  discoverConfigPath,
  detectOpenCodeRuntimeContext,
  formatConfigPathForDisplay,
  getOpenCodeCapabilities,
  compareOpenCodeSessionSnapshots,
  loadRouterConfig,
  createOpenCodeSessionSnapshot,
  createOpenCodeSessionSyncContract,
  createOpenCodeSlashCommandManifest,
  installOpenCodeCommand,
  renderOpenCodeCommand,
  resolveRouterState,
  saveRouterConfig,
} from '../src/adapters/opencode/index.js';


const fixtureYaml = `version: 1

active_profile: default

profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
        - openai/gpt
      explore:
        - google/gemini-flash
        - openai/gpt
    rules:
      fallback_enabled: true
      retry_count: 2
      timeout_seconds: 30
`;

const inactiveFixtureYaml = `version: 1

active_profile: default
activation_state: inactive

profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
        - openai/gpt
      explore:
        - google/gemini-flash
        - openai/gpt
    rules:
      fallback_enabled: true
      retry_count: 2
      timeout_seconds: 30
`;

const partialSetupFixtureYaml = `version: 1

active_profile: default
activation_state: inactive

metadata:
  installation_contract:
    source_of_truth: router/router.yaml

profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
        - openai/gpt
      explore:
        - google/gemini-flash
        - openai/gpt
    rules:
      fallback_enabled: true
      retry_count: 2
      timeout_seconds: 30
`;

const v3FixtureYaml = `version: 3

active_catalog: default
active_preset: latest
active_profile: latest
activation_state: active

catalogs:
  default:
    availability: stable
    presets:
      balanced:
        aliases: latest
        complexity: high
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet
              fallbacks: openai/gpt
            - kind: lane
              phase: orchestrator
              role: judge
              target: openai/o3
              fallbacks: anthropic/claude-opus
          verify:
            - kind: lane
              phase: verify
              role: radar
              target: google/gemini-pro
              fallbacks: openai/o3
      unavailable:
        availability: unavailable
        fallbacks: balanced
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: openai/gpt
              fallbacks: anthropic/claude-sonnet
`;

test('adapter validates Linux and WSL runtime contexts honestly', () => {
  const linux = detectOpenCodeRuntimeContext({ platform: 'linux', release: '6.8.0-generic' });
  const wsl = detectOpenCodeRuntimeContext({ platform: 'linux', release: '5.15.90.1-microsoft-standard-WSL2' });
  const windows = detectOpenCodeRuntimeContext({ platform: 'win32', release: '10.0.22631' });

  assert.equal(linux.isLinux, true);
  assert.equal(linux.isWSL, false);
  assert.equal(linux.supported, true);
  assert.equal(wsl.isWSL, true);
  assert.equal(wsl.supported, true);
  assert.equal(windows.supported, false);
  assert.equal(getOpenCodeCapabilities(windows).platformValidated, false);
});

test('adapter formats and discovers config paths outside core', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-adapter-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  assert.equal(discoverConfigPath([tempDir]), path.join(tempDir, 'router', 'router.yaml'));
  assert.equal(formatConfigPathForDisplay(path.join(tempDir, 'router', 'router.yaml'), tempDir), path.join('router', 'router.yaml'));
});

test('adapter loads and persists router config without leaking temp files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-io-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, fixtureYaml, 'utf8');

  const loaded = loadRouterConfig(configPath);
  loaded.active_profile = 'default';
  saveRouterConfig(loaded, configPath);

  const persisted = loadRouterConfig(configPath);
  assert.equal(persisted.active_profile, 'default');
  assert.ok(!fs.readdirSync(path.join(tempDir, 'router')).some((name) => name.endsWith('.tmp')));
});

test('adapter surfaces honest reports for render and activate', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-surface-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), inactiveFixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const render = renderOpenCodeCommand(context);
  const activate = activateOpenCodeCommand(context);

  assert.equal(render.status, 'degraded');
  assert.equal(activate.status, 'updated');
  assert.equal(render.target, 'opencode');
  assert.equal(activate.target, 'opencode');
  assert.match(render.reason, /configuration-backed/i);
  assert.match(activate.reason, /persisted/i);
  assert.equal(render.providerExecutionContract.status, 'supported');
  assert.equal(render.providerExecutionContract.boundary.capabilities.providerExecution.state, 'unsupported');
  assert.equal(activate.providerExecutionContract.result.execution, 'not-started');
  assert.equal(render.handoffDelegationContract.status, 'accepted');
  assert.equal(render.handoffDelegationContract.compatibility, 'supported');
  assert.equal(render.handoffDelegationContract.result.nonExecuting, true);
  assert.equal(render.agentTeamsLiteContract.kind, 'agent-teams-lite-integration-contract');
  assert.equal(render.agentTeamsLiteContract.status, 'degraded');
  assert.equal(render.agentTeamsLiteContract.compatibility, 'limited');
  assert.equal(render.agentTeamsLiteContract.read.available, true);
  assert.ok(render.agentTeamsLiteContract.read.refs.includes('handoffDelegationContract'));
  assert.equal(activate.handoffDelegationContract.status, 'accepted');
  assert.equal(activate.handoffDelegationContract.result.decision, 'accepted');
  assert.equal(render.runtimeContract.supportLevel, 'limited');
  assert.equal(render.runtimeContract.fallback.verdict, 'minimal-fallback');
  assert.equal(activate.runtimeContract.fallback.target, 'config');
});

test('adapter surfaces router schema facts for v3 metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-v3-surface-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), v3FixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const render = renderOpenCodeCommand(context);

  assert.equal(render.schemaVersion, 3);
  assert.equal(render.selectedCatalogName, 'default');
  assert.equal(render.selectedPresetName, 'balanced');
  assert.deepEqual(render.laneRoles, ['primary', 'judge', 'radar']);
  assert.ok(render.routerSchemaContract);
  assert.equal(render.routerSchemaContract.kind, 'router-schema-v3-view');
  assert.equal(render.routerSchemaContract.activePresetName, 'balanced');
  assert.match(render.compatibilityNotes.join(' '), /resolved to "balanced"/i);
  assert.equal(render.handoffDelegationContract.result.nonExecuting, true);
});

test('adapter projects a host-owned /gsr manifest with stable rebind tokens', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-session-manifest-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, v3FixtureYaml, 'utf8');

  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);
  const manifest = createOpenCodeSlashCommandManifest(state, configPath);
  const snapshot = createOpenCodeSessionSnapshot({ config, state, configPath, commandManifest: manifest });
  const nextSnapshot = createOpenCodeSessionSnapshot({ config, state, configPath, commandManifest: manifest });
  const diff = compareOpenCodeSessionSnapshots(snapshot, nextSnapshot);

  assert.equal(manifest.root, '/gsr');
  assert.equal(manifest.hostOwned, true);
  assert.equal(manifest.external, true);
  assert.equal(manifest.nonExecuting, true);
  assert.ok(manifest.commands.some((command) => command.command === '/gsr render opencode'));
  assert.equal(snapshot.rebindToken, nextSnapshot.rebindToken);
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.changedFields, []);
});

test('adapter preserves the last known good snapshot when refreshes are invalid', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-session-fallback-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, v3FixtureYaml, 'utf8');

  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);
  const previousSnapshot = createOpenCodeSessionSnapshot({ config, state, configPath });
  const contract = createOpenCodeSessionSyncContract({
    config: null,
    state: {},
    configPath,
    previousSnapshot,
    invalidReason: 'router/router.yaml is invalid.',
  });

  assert.equal(contract.status, 'invalid-config');
  assert.equal(contract.preservedSnapshot, true);
  assert.equal(contract.live, false);
  assert.equal(contract.lastKnownGoodSnapshot.rebindToken, previousSnapshot.rebindToken);
  assert.equal(contract.commandManifest.root, '/gsr');
  assert.equal(contract.rebindToken, previousSnapshot.rebindToken);
});

test('adapter keeps previous session snapshots through normalization and rebinds when they change', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-session-rebind-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, v3FixtureYaml, 'utf8');

  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);
  const previousSnapshot = createOpenCodeSessionSnapshot({ config, state, configPath });

  const normalized = detectOpenCodeRuntimeContext({
    cwd: tempDir,
    moduleDir: tempDir,
    platform: 'linux',
    release: '6.8.0-generic',
    previousSessionSnapshot: previousSnapshot,
    hostSessionId: 'session-123',
  });

  assert.equal(normalized.previousSessionSnapshot, previousSnapshot);
  assert.equal(normalized.hostSessionId, 'session-123');

  config.activation_state = 'inactive';
  saveRouterConfig(config, configPath);

  const report = renderOpenCodeCommand(normalized);

  assert.equal(report.sessionSyncContract.status, 'rebind-required');
  assert.equal(report.sessionSyncContract.diff.changed, true);
  assert.equal(report.sessionSyncContract.previousSnapshot, previousSnapshot);
  assert.equal(report.sessionSyncContract.diff.previousRebindToken, previousSnapshot.rebindToken);
  assert.notEqual(report.sessionSyncContract.currentSnapshot.rebindToken, previousSnapshot.rebindToken);
});

test('adapter can bootstrap step by step and apply install intents', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-bootstrap-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, inactiveFixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const bootstrap = bootstrapOpenCodeCommand({}, context);
  const install = installOpenCodeCommand({ intent: 'activation=active; profile=default' }, context);

  assert.equal(bootstrap.status, 'shell-ready');
  assert.match(bootstrap.reason, /shell bootstrap/i);
  assert.ok(Array.isArray(bootstrap.nextSteps));
  assert.equal(bootstrap.providerExecutionContract.status, 'supported');
  assert.equal(bootstrap.runtimeContract.fallback.target, 'shell');
  assert.equal(install.status, 'updated');
  assert.equal(install.runtimeContract.fallback.verdict, 'minimal-fallback');

  const persisted = loadRouterConfig(configPath);
  assert.equal(persisted.activation_state, 'active');
});

test('adapter rejects invalid install intents honestly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-invalid-intent-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, inactiveFixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const report = installOpenCodeCommand({ intent: 'unsupported-fragment' }, context);

  assert.equal(report.status, 'invalid-intent');
  assert.match(report.reason, /Unsupported install intent fragment/i);
  assert.equal(loadRouterConfig(configPath).activation_state, 'inactive');
});

test('bootstrap stays shell-ready on a fresh repo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-fresh-bootstrap-'));

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const report = bootstrapOpenCodeCommand({}, context);

  assert.equal(report.status, 'shell-ready');
  assert.equal(report.supported, true);
  assert.equal(report.configPath, undefined);
  assert.ok(Array.isArray(report.nextSteps));
  assert.match(report.reason, /No router\/router\.yaml exists yet/i);
});

test('install creates a starter v4 router when the config is missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-fresh-install-'));

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const report = installOpenCodeCommand({}, context);
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  const config = loadRouterConfig(configPath);

  assert.equal(report.status, 'created');
  assert.equal(report.configPath, configPath);
  assert.equal(report.activationState, 'inactive');
  // v4 fresh install uses 'multivendor' as the default active preset
  assert.equal(report.activeProfileName, 'multivendor');
  assert.equal(report.installRouteProposalContract.kind, 'install-route-proposal');
  assert.equal(report.installRouteProposalContract.proposal.safe, true);
  assert.equal(report.installRouteProposalContract.proposal.activationState, 'inactive');
  assert.equal(report.installRouteProposalContract.policy.nonExecuting, true);
  // Assembled v4 config is v3-shaped after loadRouterConfig
  assert.equal(config.activation_state, 'inactive');
  assert.equal(config.active_preset, 'multivendor');
  assert.equal(config.metadata.installation_contract.source_of_truth, 'router/router.yaml');
  assert.equal(config.metadata.installation_contract.runtime_execution, false);
  // v4 uses catalogs/presets structure
  const phaseKeys = Object.keys(config.catalogs.default.presets.multivendor.phases);
  assert.ok(phaseKeys.includes('orchestrator'));
  assert.ok(phaseKeys.includes('apply'));
  assert.ok(phaseKeys.includes('verify'));
  assert.equal(phaseKeys.length, 8);
  assert.equal(config.catalogs.default.presets.multivendor.phases.orchestrator[0].target, 'anthropic/claude-opus');
});

test('install leaves a fresh router in the requested activation state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-fresh-install-active-'));

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const report = installOpenCodeCommand({ intent: 'activation=active' }, context);
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  const config = loadRouterConfig(configPath);

  assert.equal(report.status, 'created');
  assert.equal(report.activationState, 'active');
  assert.equal(report.installRouteProposalContract.proposal.activationState, 'active');
  assert.equal(report.installRouteProposalContract.proposal.effectiveController, 'gsr');
  assert.equal(config.activation_state, 'active');
});

test('bootstrap recovers from a partial setup without rewriting YAML', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-partial-bootstrap-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, partialSetupFixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const first = bootstrapOpenCodeCommand({}, context);
  const second = bootstrapOpenCodeCommand({}, context);

  assert.equal(first.status, 'shell-ready');
  assert.equal(second.status, 'shell-ready');
  assert.equal(first.configPath, configPath);
  assert.equal(loadRouterConfig(configPath).metadata.installation_contract.source_of_truth, 'router/router.yaml');
});

test('adapter short-circuits unsupported platforms honestly', () => {
  const context = { cwd: '/tmp', moduleDir: '/tmp', platform: 'win32', release: '10.0.0' };
  const render = renderOpenCodeCommand(context);
  const activate = activateOpenCodeCommand(context);
  const deactivate = deactivateOpenCodeCommand(context);
  const install = installOpenCodeCommand({ intent: 'profile=default' }, context);
  const bootstrap = bootstrapOpenCodeCommand({}, context);

  assert.equal(render.status, 'unsupported-platform');
  assert.equal(activate.status, 'unsupported-platform');
  assert.equal(deactivate.status, 'unsupported-platform');
  assert.equal(install.status, 'unsupported-platform');
  assert.equal(bootstrap.status, 'unsupported-platform');
  assert.equal(render.supported, false);
  assert.match(render.reason, /Linux\/WSL/);
  assert.equal(render.providerExecutionContract.boundary.capabilities.providerExecution.state, 'unsupported');
  assert.equal(render.runtimeContract.fallback.verdict, 'no-safe-fallback');
  assert.equal(render.handoffDelegationContract.status, 'rejected');
  assert.equal(render.handoffDelegationContract.compatibility, 'unsupported');
  assert.match(render.handoffDelegationContract.error.reason, /unsupported/i);
});

test('adapter can deactivate and no-op when already inactive', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-surface-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), inactiveFixtureYaml, 'utf8');

  const context = { cwd: tempDir, moduleDir: tempDir, platform: 'linux', release: '6.8.0-generic' };
  const first = deactivateOpenCodeCommand(context);
  const second = deactivateOpenCodeCommand(context);

  assert.equal(first.status, 'noop');
  assert.equal(second.status, 'noop');
  assert.match(second.reason, /already inactive/i);
});
