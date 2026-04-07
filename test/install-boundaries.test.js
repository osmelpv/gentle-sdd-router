import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  installOpenCodeCommand,
  bootstrapOpenCodeCommand,
  loadRouterConfig,
  resolveRouterState,
  resolveActivationState,
  discoverConfigPath,
} from '../src/adapters/opencode/index.js';
import {
  normalizeInstallIntent,
  describeInstallBootstrap,
  applyInstallIntent,
  validateRouterConfig,
  CANONICAL_PHASES,
} from '../src/router-config.js';

const linuxContext = (cwd) => ({ cwd, moduleDir: cwd, platform: 'linux', release: '6.8.0-generic' });

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gsr-boundary-${label}-`));
}

function writeFixture(tempDir, yaml) {
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), yaml, 'utf8');
}

const inactiveFixture = `version: 1
active_profile: default
activation_state: inactive
profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
      explore:
        - google/gemini-flash
    rules:
      fallback_enabled: true
      retry_count: 2
      timeout_seconds: 30
`;

const activeFixture = `version: 1
active_profile: default
activation_state: active
profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
      explore:
        - google/gemini-flash
`;

// ─── Wizard behavior: fresh vs update ────────────────────────────────

test('install on a fresh repo creates the config (status=created)', () => {
  const tempDir = makeTempDir('fresh-create');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.status, 'created');
  assert.equal(report.supported, true);
  assert.ok(report.configPath?.endsWith('router/router.yaml'));
});

test('install on an existing repo updates the config (status=updated) or noops', () => {
  const tempDir = makeTempDir('existing-update');
  writeFixture(tempDir, inactiveFixture);

  const report = installOpenCodeCommand({ intent: 'activation=active' }, linuxContext(tempDir));

  assert.ok(report.status === 'updated' || report.status === 'noop');
  assert.equal(report.supported, true);
});

test('install with no intent on existing config returns ready (not created)', () => {
  const tempDir = makeTempDir('existing-noop');
  writeFixture(tempDir, inactiveFixture);

  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.status, 'ready');
  assert.equal(report.supported, true);
  assert.ok(!report.installRouteProposalContract);
});

test('install with no intent on fresh config returns created with proposal contract', () => {
  const tempDir = makeTempDir('fresh-no-intent');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.status, 'created');
  assert.ok(report.installRouteProposalContract);
  assert.equal(report.installRouteProposalContract.kind, 'install-route-proposal');
});

// ─── Preview / confirm / cancel semantics ────────────────────────────

test('install --no-apply previews without writing to disk (fresh repo)', () => {
  const tempDir = makeTempDir('preview-fresh');
  const report = installOpenCodeCommand({ intent: 'activation=active', apply: false }, linuxContext(tempDir));

  assert.equal(report.status, 'planned');
  assert.ok(!fs.existsSync(path.join(tempDir, 'router', 'router.yaml')));
  assert.equal(report.activationState, 'active');
});

test('install --no-apply previews without writing to disk (existing repo)', () => {
  const tempDir = makeTempDir('preview-existing');
  writeFixture(tempDir, inactiveFixture);
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  const mtimeBefore = fs.statSync(configPath).mtimeMs;

  const report = installOpenCodeCommand({ intent: 'activation=active', apply: false }, linuxContext(tempDir));

  assert.equal(report.status, 'planned');
  assert.equal(report.activationState, 'active');
  assert.equal(fs.statSync(configPath).mtimeMs, mtimeBefore);
});

test('install without --no-apply persists the change (existing repo)', () => {
  const tempDir = makeTempDir('confirm-existing');
  writeFixture(tempDir, inactiveFixture);

  const report = installOpenCodeCommand({ intent: 'activation=active' }, linuxContext(tempDir));
  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));

  assert.equal(report.status, 'updated');
  assert.equal(config.activation_state, 'active');
});

test('install with identical intent returns noop and does not rewrite the file', () => {
  const tempDir = makeTempDir('cancel-noop');
  writeFixture(tempDir, activeFixture);
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  const contentBefore = fs.readFileSync(configPath, 'utf8');

  const report = installOpenCodeCommand({ intent: 'activation=active' }, linuxContext(tempDir));

  assert.equal(report.status, 'noop');
  assert.match(report.reason, /already matches/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), contentBefore);
});

// ─── Starter YAML generation (schema v4) ────────────────────────────

test('fresh install generates a valid v4 config with all canonical phases', () => {
  const tempDir = makeTempDir('starter-v4');
  installOpenCodeCommand({}, linuxContext(tempDir));

  // v4 fresh install writes router/router.yaml (core) + router/profiles/multivendor.router.yaml
  assert.ok(fs.existsSync(path.join(tempDir, 'router', 'router.yaml')), 'router/router.yaml should exist');
  assert.ok(fs.existsSync(path.join(tempDir, 'router', 'profiles', 'multivendor.router.yaml')), 'multivendor profile file should exist');

  // loadRouterConfig returns an assembled v3-shaped config from the v4 layout
  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));

  assert.equal(config.activation_state, 'inactive');
  // active_preset is no longer written to disk (Phase 7); profile exists in catalog instead.
  assert.ok(config.catalogs?.default?.presets?.multivendor, 'multivendor preset should exist in default catalog');
  const phaseKeys = Object.keys(config.catalogs.default.presets.multivendor.phases);
  assert.ok(phaseKeys.includes('orchestrator'));
  assert.ok(phaseKeys.includes('apply'));
  assert.ok(phaseKeys.includes('verify'));
  assert.equal(phaseKeys.length, 8);
});

test('starter config includes installation_contract metadata with correct semantics', () => {
  const tempDir = makeTempDir('starter-meta');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  const contract = config.metadata?.installation_contract;

  assert.ok(contract);
  assert.equal(contract.source_of_truth, 'router/router.yaml');
  assert.equal(contract.install_command, 'gsr install');
  assert.equal(contract.bootstrap_command, 'gsr bootstrap');
  assert.equal(contract.shell_fallback, 'gsr bootstrap --no-apply');
  assert.equal(contract.runtime_execution, false);
});

test('starter config assigns a provider/model target to every phase', () => {
  const tempDir = makeTempDir('starter-phases');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  // v4 assembled config uses catalogs/presets structure
  const phases = config.catalogs.default.presets.multivendor.phases;

  for (const phaseName of CANONICAL_PHASES) {
    const chain = phases[phaseName];
    assert.ok(chain, `${phaseName} should be present`);
    // Phase 7: phases are now in simplified schema {model, fallbacks?}
    if (Array.isArray(chain)) {
      // Old lane array format (backward compat)
      assert.ok(chain.length > 0, `${phaseName} should have at least one candidate`);
      const firstLane = chain[0];
      assert.ok(firstLane && typeof firstLane === 'object', `${phaseName} first candidate should be a lane object`);
      assert.ok((firstLane.target ?? firstLane.model)?.includes('/'), `${phaseName} target should be provider/model`);
    } else {
      // Simplified schema
      assert.ok(chain && typeof chain === 'object', `${phaseName} should be an object`);
      assert.ok(chain.model?.includes('/'), `${phaseName} model should be provider/model`);
    }
  }
});

test('starter v4 config has multivendor preset with availability and complexity', () => {
  const tempDir = makeTempDir('starter-rules');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  // v4 multivendor preset carries availability and complexity metadata instead of rules
  const preset = config.catalogs.default.presets.multivendor;

  assert.equal(preset.availability, 'stable');
  assert.equal(preset.complexity, 'high');
});

test('starter config validates without errors', () => {
  const tempDir = makeTempDir('starter-validate');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));

  assert.equal(validateRouterConfig(config), true);
});

// ─── Bootstrap of missing router/ directory and router/router.yaml ──

test('bootstrap on a fresh repo stays shell-ready and does not create anything', () => {
  const tempDir = makeTempDir('bootstrap-fresh');
  const report = bootstrapOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.status, 'shell-ready');
  assert.equal(report.supported, true);
  assert.ok(!fs.existsSync(path.join(tempDir, 'router')));
  assert.ok(!fs.existsSync(path.join(tempDir, 'router', 'router.yaml')));
  assert.match(report.reason, /No router\/router\.yaml exists yet/i);
  assert.ok(Array.isArray(report.nextSteps));
  assert.ok(report.nextSteps.length > 0);
});

test('bootstrap on a fresh repo with intent stays shell-ready', () => {
  const tempDir = makeTempDir('bootstrap-fresh-intent');
  const report = bootstrapOpenCodeCommand({ intent: 'profile=default' }, linuxContext(tempDir));

  assert.equal(report.status, 'shell-ready');
  assert.ok(!fs.existsSync(path.join(tempDir, 'router', 'router.yaml')));
});

test('install creates the router/ directory when it does not exist', () => {
  const tempDir = makeTempDir('mkdir-install');
  assert.ok(!fs.existsSync(path.join(tempDir, 'router')));

  installOpenCodeCommand({}, linuxContext(tempDir));

  assert.ok(fs.statSync(path.join(tempDir, 'router')).isDirectory());
  assert.ok(fs.statSync(path.join(tempDir, 'router', 'router.yaml')).isFile());
});

test('install on an existing router dir does not clobber other files', () => {
  const tempDir = makeTempDir('preserve-files');
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'custom-note.md'), 'keep me', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), inactiveFixture, 'utf8');

  installOpenCodeCommand({ intent: 'activation=active' }, linuxContext(tempDir));

  assert.equal(fs.readFileSync(path.join(tempDir, 'router', 'custom-note.md'), 'utf8'), 'keep me');
  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  assert.equal(config.activation_state, 'active');
});

test('discoverConfigPath returns the path after install materializes it', () => {
  const tempDir = makeTempDir('discover-after-install');
  assert.equal(discoverConfigPath([tempDir]), null);

  installOpenCodeCommand({}, linuxContext(tempDir));

  const discovered = discoverConfigPath([tempDir]);
  assert.ok(discovered);
  assert.ok(discovered.endsWith('router/router.yaml'));
});

// ─── Initial route proposal / activation behavior ────────────────────

test('fresh install proposal reflects the default activation (inactive)', () => {
  const tempDir = makeTempDir('proposal-default');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.installRouteProposalContract.proposal.activationState, 'inactive');
  assert.match(report.installRouteProposalContract.proposal.effectiveController, /^(Gentleman|host)$/);
  assert.equal(report.installRouteProposalContract.proposal.safe, true);
});

test('fresh install proposal reflects explicit activation=active intent', () => {
  const tempDir = makeTempDir('proposal-active');
  const report = installOpenCodeCommand({ intent: 'activation=active' }, linuxContext(tempDir));

  assert.equal(report.installRouteProposalContract.proposal.activationState, 'active');
  assert.equal(report.installRouteProposalContract.proposal.effectiveController, 'gsr');
});

test('fresh install proposal contains routePlan with all canonical phases', () => {
  const tempDir = makeTempDir('proposal-routes');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  const routePlan = report.installRouteProposalContract.proposal.routePlan;

  for (const phaseName of CANONICAL_PHASES) {
    assert.ok(routePlan[phaseName], `routePlan should include ${phaseName}`);
    assert.ok(routePlan[phaseName].active, `${phaseName} should have an active route`);
  }
});

test('install proposal contract is non-executing and non-owning', () => {
  const tempDir = makeTempDir('proposal-policy');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  const policy = report.installRouteProposalContract.policy;

  assert.equal(policy.nonExecuting, true);
  assert.equal(policy.nonOwning, true);
  assert.equal(policy.routerExternal, true);
});

test('install proposal includes planToken and rebindToken', () => {
  const tempDir = makeTempDir('proposal-tokens');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  const contract = report.installRouteProposalContract;

  assert.ok(contract.planToken);
  assert.equal(typeof contract.planToken, 'string');
  assert.equal(contract.planToken.length, 64);
  assert.ok(contract.rebindToken);
  assert.equal(contract.rebindToken.length, 64);
});

test('preview (planned) fresh install also produces a proposal contract', () => {
  const tempDir = makeTempDir('preview-proposal');
  const report = installOpenCodeCommand({ apply: false }, linuxContext(tempDir));

  assert.equal(report.status, 'planned');
  assert.ok(report.installRouteProposalContract);
  assert.equal(report.installRouteProposalContract.proposal.safe, true);
});

// ─── Install with profile intent on fresh repo ──────────────────────

test('install on a fresh repo with profile intent sets the active profile', () => {
  const tempDir = makeTempDir('fresh-profile');
  // v4 fresh install only has 'multivendor' preset; use that as the profile intent
  const report = installOpenCodeCommand({ intent: 'profile=multivendor' }, linuxContext(tempDir));

  assert.equal(report.status, 'created');
  assert.equal(report.activeProfileName, 'multivendor');

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  // active_preset is no longer written to disk (Phase 7); profile exists in catalog instead.
  assert.ok(config.catalogs?.default?.presets?.multivendor, 'multivendor preset in catalog after profile intent install');
});

// ─── Installability docs/metadata coherence ──────────────────────────

test('starter config passes resolveRouterState without errors', () => {
  const tempDir = makeTempDir('starter-state');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  const state = resolveRouterState(config);

  // v4 fresh install uses 'multivendor' as the default active preset
  assert.equal(state.activeProfileName, 'multivendor');
  assert.ok(state.resolvedPhases);
  assert.ok(Object.keys(state.resolvedPhases).length > 0);
});

test('starter config activation state resolves consistently between state and activation', () => {
  const tempDir = makeTempDir('starter-activation');
  installOpenCodeCommand({}, linuxContext(tempDir));

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  const state = resolveRouterState(config);
  const activation = resolveActivationState(config);

  assert.equal(state.activationState, 'inactive');
  assert.equal(activation.state, 'inactive');
  assert.match(activation.effectiveController, /^(Gentleman|host)$/);
});

test('describeInstallBootstrap returns noop when intent already matches the config', () => {
  const config = {
    version: 1,
    active_profile: 'default',
    activation_state: 'active',
    profiles: {
      default: {
        phases: { orchestrator: ['anthropic/claude-sonnet'] },
      },
    },
  };

  const guidance = describeInstallBootstrap(config, 'activation=active');

  assert.equal(guidance.status, 'noop');
  assert.match(guidance.reason, /already matches/i);
  assert.ok(guidance.nextSteps.some((step) => /gsr status/i.test(step)));
});

test('describeInstallBootstrap returns planned when intent changes the config', () => {
  const config = {
    version: 1,
    active_profile: 'default',
    activation_state: 'inactive',
    profiles: {
      default: {
        phases: { orchestrator: ['anthropic/claude-sonnet'] },
      },
    },
  };

  const guidance = describeInstallBootstrap(config, 'activation=active');

  assert.equal(guidance.status, 'planned');
  assert.ok(guidance.nextConfig);
  assert.equal(guidance.nextConfig.activation_state, 'active');
  assert.ok(guidance.nextSteps.some((step) => /--apply/i.test(step)));
});

// ─── Normalize intent edge cases ─────────────────────────────────────

test('normalizeInstallIntent returns empty array for blank input', () => {
  assert.deepEqual(normalizeInstallIntent(''), []);
  assert.deepEqual(normalizeInstallIntent(null), []);
  assert.deepEqual(normalizeInstallIntent(undefined), []);
});

test('normalizeInstallIntent rejects unrecognized fragments', () => {
  assert.throws(() => normalizeInstallIntent('bogus'), /Unsupported install intent fragment/i);
});

test('normalizeInstallIntent parses semicolon-delimited directives', () => {
  const directives = normalizeInstallIntent('profile=budget; activation=active');

  assert.equal(directives.length, 2);
  assert.equal(directives[0].type, 'active_profile');
  assert.equal(directives[1].type, 'activation_state');
});

test('normalizeInstallIntent parses phase chain directives', () => {
  const directives = normalizeInstallIntent('phase.explore=google/gemini-flash, openai/gpt');

  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, 'phase_chain');
  assert.equal(directives[0].phaseName, 'explore');
  assert.deepEqual(directives[0].chain, ['google/gemini-flash', 'openai/gpt']);
});

test('normalizeInstallIntent parses metadata patch directives', () => {
  const directives = normalizeInstallIntent('metadata.installation_contract.source_of_truth=router/router.yaml');

  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, 'metadata_patch');
  assert.deepEqual(directives[0].path, ['installation_contract', 'source_of_truth']);
  assert.equal(directives[0].value, 'router/router.yaml');
});

// ─── Install and bootstrap fallback metadata coherence ───────────────

test('install on fresh repo reports runtimeContract fallback target as config (when applied)', () => {
  const tempDir = makeTempDir('fallback-applied');
  const report = installOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.runtimeContract.fallback.target, 'config');
  assert.equal(report.runtimeContract.fallback.verdict, 'minimal-fallback');
});

test('install --no-apply on fresh repo reports runtimeContract fallback target as shell', () => {
  const tempDir = makeTempDir('fallback-preview');
  const report = installOpenCodeCommand({ apply: false }, linuxContext(tempDir));

  assert.equal(report.runtimeContract.fallback.target, 'shell');
});

test('bootstrap on fresh repo reports runtimeContract fallback target as shell', () => {
  const tempDir = makeTempDir('fallback-bootstrap');
  const report = bootstrapOpenCodeCommand({}, linuxContext(tempDir));

  assert.equal(report.runtimeContract.fallback.target, 'shell');
});

// ─── Custom phases support ────────────────────────────────────────────

test('preset with non-canonical phases loads and resolves correctly', () => {
  const tempDir = makeTempDir('custom-phases');
  const customPresetYaml = `version: 4

active_preset: my-debug-workflow
activation_state: inactive
`;
  const customProfileYaml = `name: my-debug-workflow
availability: stable
complexity: medium
phases:
  investigate:
    - target: anthropic/claude-opus
      kind: lane
      phase: investigate
      role: primary
  reproduce:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: reproduce
      role: primary
  fix:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: fix
      role: primary
`;

  fs.mkdirSync(path.join(tempDir, 'router', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), customPresetYaml, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'router', 'profiles', 'my-debug-workflow.router.yaml'), customProfileYaml, 'utf8');

  const config = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  const state = resolveRouterState(config);

  assert.ok(config, 'config should load without error');
  assert.ok(state.resolvedPhases, 'resolvedPhases should exist');
  assert.ok(state.resolvedPhases.investigate, 'custom phase "investigate" should be resolved');
  assert.ok(state.resolvedPhases.reproduce, 'custom phase "reproduce" should be resolved');
  assert.ok(state.resolvedPhases.fix, 'custom phase "fix" should be resolved');
  assert.equal(Object.keys(state.resolvedPhases).length, 3);
});
