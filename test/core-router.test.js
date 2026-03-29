import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  applyInstallIntent,
  describeInstallBootstrap,
  listProfiles,
  normalizeInstallIntent,
  resolveActivationState,
  resolveRouterState,
  setActivationState,
  setActiveProfile,
  validateRouterConfig,
} from '../src/core/router.js';
import { assembleV4Config } from '../src/core/router-v4-io.js';

const fixtureConfig = {
  version: 1,
  active_profile: 'default',
  activation_state: 'inactive',
  profiles: {
    default: {
      phases: {
        orchestrator: ['anthropic/claude-sonnet', 'openai/gpt'],
        explore: ['google/gemini-flash', 'openai/gpt'],
      },
      rules: {
        fallback_enabled: true,
        retry_count: 2,
        timeout_seconds: 30,
      },
    },
    budget: {
      phases: {
        orchestrator: ['openai/gpt'],
      },
      rules: {
        fallback_enabled: false,
        retry_count: 0,
        timeout_seconds: 10,
      },
    },
  },
};

test('core module stays free of environment and filesystem concerns', () => {
  const source = fs.readFileSync(path.resolve('src/core/router.js'), 'utf8');

  assert.doesNotMatch(source, /node:fs|node:path|node:url|process\.|fileURLToPath|existsSync|readFileSync|writeFileSync|renameSync/);
});

test('core validates and resolves profiles without I/O', () => {
  assert.equal(validateRouterConfig(fixtureConfig), true);

  const state = resolveRouterState(fixtureConfig);
  assert.equal(state.activeProfileName, 'default');
  assert.equal(state.activationState, 'inactive');
  assert.equal(state.effectiveController, 'Alan/gentle-ai');
  assert.equal(state.resolvedPhases.orchestrator.active, 'anthropic/claude-sonnet');
  assert.deepEqual(state.resolvedPhases.explore.candidates, ['google/gemini-flash', 'openai/gpt']);
});

test('core can switch active profiles and list them', () => {
  const updated = setActiveProfile(fixtureConfig, 'budget');

  assert.equal(updated.active_profile, 'budget');
  assert.equal(listProfiles(updated)[0].active, false);
  assert.equal(listProfiles(updated)[1].active, true);
  assert.equal(updated.activation_state, 'inactive');
});

test('core can switch activation without touching profile selection', () => {
  const updated = setActivationState(fixtureConfig, 'active');

  assert.equal(updated.activation_state, 'active');
  assert.equal(updated.active_profile, 'default');
  assert.equal(resolveActivationState(updated).effectiveController, 'gsr');
});

test('core normalizes install intents and applies YAML updates', () => {
  const intent = 'profile=budget; activation=active; phase.explore=openai/gpt, anthropic/claude-sonnet; rule.retry_count=5; metadata.installation_contract.shell_fallback=gsr bootstrap --no-apply';
  const normalized = normalizeInstallIntent(intent);
  const updated = applyInstallIntent(fixtureConfig, intent);

  assert.equal(normalized.length, 5);
  assert.equal(updated.active_profile, 'budget');
  assert.equal(updated.activation_state, 'active');
  assert.deepEqual(updated.profiles.budget.phases.explore, ['openai/gpt', 'anthropic/claude-sonnet']);
  assert.equal(updated.profiles.budget.rules.retry_count, 5);
  assert.equal(updated.metadata.installation_contract.shell_fallback, 'gsr bootstrap --no-apply');
});

test('core keeps shell bootstrap available when no intent is provided', () => {
  const guidance = describeInstallBootstrap(fixtureConfig, '');

  assert.equal(guidance.status, 'shell-ready');
  assert.match(guidance.reason, /shell bootstrap/i);
  assert.ok(Array.isArray(guidance.nextSteps));
  assert.ok(guidance.nextSteps.length > 0);
});

// ─── v4 assembled config fixtures ────────────────────────────────────────────
// Lanes must be v3-style objects: { kind: 'lane', phase, role, target, ... }

const v4CoreConfig = {
  version: 4,
  active_catalog: 'default',
  active_preset: 'default',
  activation_state: 'inactive',
};

const v4Profiles = [
  {
    filePath: '/fake/profiles/default.router.yaml',
    fileName: 'default.router.yaml',
    catalogName: 'default',
    content: {
      name: 'default',
      phases: {
        orchestrator: [
          { kind: 'lane', phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-sonnet' },
          { kind: 'lane', phase: 'orchestrator', role: 'judge', target: 'openai/gpt' },
        ],
        explore: [
          { kind: 'lane', phase: 'explore', role: 'primary', target: 'google/gemini-flash' },
          { kind: 'lane', phase: 'explore', role: 'judge', target: 'openai/gpt' },
        ],
      },
    },
  },
  {
    filePath: '/fake/profiles/budget.router.yaml',
    fileName: 'budget.router.yaml',
    catalogName: 'default',
    content: {
      name: 'budget',
      phases: {
        orchestrator: [
          { kind: 'lane', phase: 'orchestrator', role: 'primary', target: 'openai/gpt' },
        ],
        explore: [
          { kind: 'lane', phase: 'explore', role: 'primary', target: 'openai/gpt' },
        ],
      },
    },
  },
];

test('setActiveProfile works with a v4 assembled (v3-shaped) config', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);

  assert.equal(assembled.version, 3);
  assert.equal(assembled.active_preset, 'default');

  const updated = setActiveProfile(assembled, 'default/budget');

  assert.equal(updated.active_catalog, 'default');
  assert.equal(updated.active_preset, 'budget');
  assert.equal(updated.active_profile, 'budget');
  assert.equal(updated.activation_state, 'inactive');
});

test('setActiveProfile with v4 assembled config using short preset name (implicit catalog)', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);

  const updated = setActiveProfile(assembled, 'budget');

  assert.equal(updated.active_catalog, 'default');
  assert.equal(updated.active_preset, 'budget');
  assert.equal(updated.active_profile, 'budget');
});

test('listProfiles with a v4 assembled (v3-shaped) config lists all presets', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);
  const profiles = listProfiles(assembled);

  assert.equal(profiles.length, 2);

  const names = profiles.map((p) => p.name);
  assert.ok(names.includes('default/default'));
  assert.ok(names.includes('default/budget'));

  const activeProfile = profiles.find((p) => p.active);
  assert.ok(activeProfile);
  assert.equal(activeProfile.name, 'default/default');
});

test('listProfiles with v4 assembled config reflects switched preset as active', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);
  const switched = setActiveProfile(assembled, 'default/budget');
  const profiles = listProfiles(switched);

  const activeProfile = profiles.find((p) => p.active);
  assert.ok(activeProfile);
  assert.equal(activeProfile.name, 'default/budget');

  const inactiveProfile = profiles.find((p) => !p.active);
  assert.equal(inactiveProfile.name, 'default/default');
});

test('resolveRouterState works with a v4 assembled (v3-shaped) config', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);
  const state = resolveRouterState(assembled);

  assert.equal(state.version, 3);
  assert.equal(state.activeProfileName, 'default');
  assert.equal(state.selectedCatalogName, 'default');
  assert.equal(state.selectedPresetName, 'default');
  assert.equal(state.activationState, 'inactive');
  assert.equal(state.effectiveController, 'Alan/gentle-ai');
  assert.ok(Array.isArray(state.profiles));
  assert.equal(state.profiles.length, 2);
  // v3 resolved phases contain lane objects
  assert.equal(state.resolvedPhases.orchestrator.active.role, 'primary');
  assert.equal(state.resolvedPhases.orchestrator.active.target, 'anthropic/claude-sonnet');
  assert.equal(state.resolvedPhases.explore.active.role, 'primary');
  assert.equal(state.resolvedPhases.explore.active.target, 'google/gemini-flash');
  assert.equal(state.resolvedPhases.explore.candidates.length, 2);
});

test('validateRouterConfig accepts a v4 assembled (v3-shaped) config', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);

  assert.equal(validateRouterConfig(assembled), true);
});

test('validateRouterConfig rejects a raw v4 config (must assemble first)', () => {
  const rawV4 = { version: 4, active_preset: 'default', active_catalog: 'default' };

  assert.throws(
    () => validateRouterConfig(rawV4),
    /raw v4 config.*version: 4.*cannot be validated directly/i
  );
});

test('setActiveProfile preserves _v4Source non-enumerable property on v4 assembled config', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);

  // Confirm _v4Source is present before the call
  const beforeDescriptor = Object.getOwnPropertyDescriptor(assembled, '_v4Source');
  assert.ok(beforeDescriptor, '_v4Source exists before setActiveProfile');
  assert.equal(beforeDescriptor.enumerable, false, '_v4Source is non-enumerable before call');

  const updated = setActiveProfile(assembled, 'default/budget');

  // _v4Source must survive the object spread inside setActiveProfile
  const afterDescriptor = Object.getOwnPropertyDescriptor(updated, '_v4Source');
  assert.ok(afterDescriptor, '_v4Source still exists after setActiveProfile');
  assert.equal(afterDescriptor.enumerable, false, '_v4Source is still non-enumerable after setActiveProfile');
  assert.ok(updated._v4Source, '_v4Source value is accessible');

  // The profile switch itself must still work
  assert.equal(updated.active_preset, 'budget');
  assert.equal(updated.active_profile, 'budget');
  assert.equal(updated.active_catalog, 'default');
});

test('setActiveProfile _v4Source coreConfig is updated with new active_preset', () => {
  const assembled = assembleV4Config(v4CoreConfig, v4Profiles);

  const updated = setActiveProfile(assembled, 'default/budget');

  // _v4Source.coreConfig must reflect the new active_preset so buildV4WritePlan writes correctly
  assert.equal(updated._v4Source.coreConfig.active_preset, 'budget', 'coreConfig.active_preset updated');
  assert.equal(updated._v4Source.coreConfig.active_catalog, 'default', 'coreConfig.active_catalog updated');

  // profileMap and routerDir must be preserved from the original source
  assert.ok(updated._v4Source.profileMap, 'profileMap is preserved');
  assert.strictEqual(updated._v4Source.routerDir, assembled._v4Source.routerDir, 'routerDir is preserved');
});
