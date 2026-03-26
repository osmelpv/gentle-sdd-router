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
