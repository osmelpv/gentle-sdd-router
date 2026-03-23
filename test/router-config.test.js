import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {
  loadRouterConfig,
  resolveRouterState,
  saveRouterConfig,
  setActiveProfile,
} from '../src/router-config.js';
import { runCli } from '../src/cli.js';

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
  budget:
    phases:
      orchestrator:
        - openai/gpt
      explore:
        - openai/gpt
    rules:
      fallback_enabled: false
      retry_count: 0
      timeout_seconds: 10
`;

const routeObjectFixtureYaml = `version: 1

active_profile: objected

profiles:
  objected:
    phases:
      orchestrator:
        - kind: judge
          target: openai/gpt-4.1
          metadata:
            role: verifier
        - kind: runner
          target: anthropic/claude-sonnet
          metadata:
            tier: primary
      explore:
        - kind: runner
          target: google/gemini-flash
          metadata:
            tier: fallback
    rules:
      fallback_enabled: true
      retry_count: 1
      timeout_seconds: 15
`;

test('loads and resolves the active profile', () => {
  const config = loadFixtureConfig();
  const state = resolveRouterState(config);

  assert.equal(state.activeProfileName, 'default');
  assert.equal(state.resolvedPhases.orchestrator.active, 'anthropic/claude-sonnet');
  assert.deepEqual(state.resolvedPhases.explore.candidates, ['google/gemini-flash', 'openai/gpt']);
});

test('accepts route objects and still resolves a single runner route', () => {
  const config = loadFixtureConfig(routeObjectFixtureYaml);
  const state = resolveRouterState(config);

  const orchestrator = state.resolvedPhases.orchestrator;
  assert.equal(orchestrator.active.kind, 'runner');
  assert.equal(orchestrator.active.target, 'anthropic/claude-sonnet');
  assert.equal(orchestrator.candidates.length, 2);
  assert.equal(orchestrator.candidates[0].kind, 'judge');
  assert.equal(orchestrator.candidates[1].kind, 'runner');
  assert.equal(orchestrator.candidates[0].metadata.role, 'verifier');
});

test('switches the active profile and persists it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const loaded = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  const updated = setActiveProfile(loaded, 'budget');
  saveRouterConfig(updated, path.join(tempDir, 'router', 'router.yaml'));

  const persisted = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  assert.equal(persisted.active_profile, 'budget');
});

test('saves and reloads route objects without losing their shape', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, routeObjectFixtureYaml, 'utf8');

  const loaded = loadRouterConfig(configPath);
  saveRouterConfig(loaded, configPath);

  const persisted = loadRouterConfig(configPath);
  assert.equal(persisted.profiles.objected.phases.orchestrator[1].kind, 'runner');
  assert.equal(persisted.profiles.objected.phases.orchestrator[1].target, 'anthropic/claude-sonnet');
});

test('status command only renders resolved routes', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), routeObjectFixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['status']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  assert.match(output, /Resolved routes:/);
  assert.match(output, /orchestrator: anthropic\/claude-sonnet/);
  assert.doesNotMatch(output, /provider|execute/i);
});

function loadFixtureConfig(yaml = fixtureYaml) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return loadRouterConfig(configPath);
}
