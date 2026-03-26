import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  discoverConfigPath,
  loadRouterConfig,
  resolveRouterState,
  saveRouterConfig,
  setActiveProfile,
} from '../src/adapters/opencode/index.js';
import { validateRouterSchemaV3 } from '../src/router-config.js';
import { runCli } from '../src/cli.js';

const fixtureYaml = `version: 1

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
activation_state: inactive

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
  assert.ok(!fs.readdirSync(path.join(tempDir, 'router')).some((name) => name.endsWith('.tmp')));
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

test('loads and resolves the v3 catalog and preset metadata', () => {
  const config = loadFixtureConfig(v3FixtureYaml);
  const state = resolveRouterState(config);

  assert.equal(state.schemaVersion, 3);
  assert.equal(state.selectedCatalogName, 'default');
  assert.equal(state.selectedPresetName, 'balanced');
  assert.match(state.compatibilityNotes.join(' '), /resolved to "balanced"/i);
  assert.equal(state.resolvedPhases.orchestrator.active.role, 'primary');
  assert.equal(state.resolvedPhases.verify.active.role, 'radar');
});

test('rejects v3 metadata that implies execution', () => {
  const invalid = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              verify: [
                {
                  kind: 'lane',
                  phase: 'verify',
                  role: 'judge',
                  target: 'openai/o3',
                  instructions: 'run it',
                  fallbacks: 'anthropic/claude-opus',
                },
              ],
            },
          },
        },
      },
    },
  };

  assert.throws(() => validateRouterSchemaV3(invalid), /execution-oriented field "instructions"/i);
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
  assert.match(output, /Installed: yes/);
  assert.match(output, /In control: Alan\/gentle-ai/);
  assert.match(output, /Activation: inactive/);
  assert.match(output, /Toggle control: gsr activate/);
  assert.match(output, /Resolved routes:/);
  assert.match(output, /orchestrator: anthropic\s*\/\s*claude-sonnet/);
  assert.doesNotMatch(output, /provider|execute/i);
});

test('help output lists the available commands', async () => {
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['--help']);
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = chunks.join('');
  assert.match(output, /Usage: gsr <command> \[args\]/);
  assert.match(output, /Router boundary: external, non-executing\./i);
  assert.match(output, /Host sync: \/gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing\./i);
  assert.match(output, /Multimodel browse\/compare expose shareable schema v3 metadata only\./i);
  assert.match(output, /Compatibility: router\.yaml version 1 and 3 are supported; v3 powers multimodel browse\/compare\./i);
  assert.match(output, /Quickstart: run gsr status, then gsr bootstrap if router\/router\.yaml is missing\./i);
  assert.match(output, /use <profile>\s+Select the active profile in router\/router\.yaml without changing who is in control\./i);
  assert.match(output, /status\s+Show who is in control, how to toggle it, the active profile, and resolved routes\./i);
  assert.match(output, /list\s+List available profiles and mark the active one\./i);
  assert.match(output, /browse \[selector\]\s+Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything\./i);
  assert.match(output, /compare <left> <right>\s+Compare two shareable multimodel projections without recommending or executing anything\./i);
  assert.match(output, /activate\s+Take control of routing without changing the active profile\./i);
  assert.match(output, /deactivate\s+Hand control back to Alan\/gentle-ai without changing the active profile\./i);
  assert.match(output, /install\s+Inspect or apply a YAML-first install intent to router\/router\.yaml\./i);
  assert.match(output, /bootstrap\s+Show or apply a step-by-step bootstrap path for adoption\./i);
  assert.match(output, /render opencode/);
  assert.match(output, /OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution\./i);
});

test('help command can explain specific commands', async () => {
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['help', 'status']);
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = chunks.join('');
  assert.match(output, /Usage: gsr status/);
  assert.match(output, /Show who is in control, how to toggle it, the active profile, and resolved routes\./i);
});

test('bootstrap command keeps a step-by-step shell path available', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-bootstrap-cli-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['bootstrap']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  const persisted = loadRouterConfig(configPath);
  assert.equal(persisted.activation_state, 'inactive');
  assert.match(output, /Command: bootstrap opencode/);
  assert.match(output, /Status: shell-ready/);
  assert.match(output, /Next steps:/);
});

test('bootstrap command stays shell-ready on a fresh repo', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-bootstrap-fresh-cli-'));

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['bootstrap']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  assert.match(output, /Command: bootstrap opencode/);
  assert.match(output, /Status: shell-ready/);
  assert.match(output, /No router\/router\.yaml exists yet/i);
});

test('install command can apply YAML intents through the entrypoint', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-install-cli-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const binPath = fileURLToPath(new URL('../bin/gsr.js', import.meta.url));
  const result = spawnSync(process.execPath, [binPath, 'install', '--intent', 'activation=active'], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Command: install opencode/);
  assert.match(result.stdout, /Status: updated/);

  const persisted = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  assert.equal(persisted.activation_state, 'active');
});

test('install command rejects invalid intents honestly through the entrypoint', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-install-invalid-cli-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['install', '--intent', 'unsupported-fragment']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  assert.match(output, /Command: install opencode/);
  assert.match(output, /Status: invalid-intent/);
  assert.match(output, /Unsupported install intent fragment/i);
});

test('activate and deactivate toggle activation without changing the active profile', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-toggle-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['activate']);
    let output = chunks.join('');
    assert.match(output, /Command: activate opencode/);
    assert.match(output, /Status: updated/);
    let persisted = loadRouterConfig(configPath);
    assert.equal(persisted.activation_state, 'active');
    assert.equal(persisted.active_profile, 'default');

    chunks.length = 0;
    await runCli(['status']);
    output = chunks.join('');
    assert.match(output, /In control: gsr/);
    assert.match(output, /Activation: active/);
    assert.match(output, /Toggle control: gsr deactivate/);

    chunks.length = 0;
    await runCli(['deactivate']);
    output = chunks.join('');
    assert.match(output, /Command: deactivate opencode/);
    assert.match(output, /Status: updated/);
    persisted = loadRouterConfig(configPath);
    assert.equal(persisted.activation_state, 'inactive');
    assert.equal(persisted.active_profile, 'default');

    chunks.length = 0;
    await runCli(['status']);
    output = chunks.join('');
    assert.match(output, /In control: Alan\/gentle-ai/);
    assert.match(output, /Activation: inactive/);
    assert.match(output, /Toggle control: gsr activate/);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
});

test('render opencode reports honest adapter output', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-render-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(tempDir);
  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['render', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  assert.match(output, /Command: render opencode/);
  assert.match(output, /Status: degraded/);
  assert.match(output, /Resolved routes:/);
  assert.match(output, /Contract status: supported/);
  assert.match(output, /Boundary mode: non-executing/);
  assert.match(output, /Handoff status: accepted/);
  assert.match(output, /Handoff compatibility: supported/);
  assert.match(output, /Handoff mode: report-only/);
  assert.match(output, /Provider execution: unsupported/);
  assert.match(output, /Runtime support: limited/);
  assert.match(output, /Runtime fallback: minimal-fallback \(config\)/);
  assert.match(output, /Runtime limits:/);
  assert.match(output, /Reason: OpenCode render is configuration-backed only/i);
});

test('status resolves config from outside the repo cwd', () => {
  const outsideCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-outside-'));
  const binPath = fileURLToPath(new URL('../bin/gsr.js', import.meta.url));
  const result = spawnSync(process.execPath, [binPath, 'status'], {
    cwd: outsideCwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Schema: v3/);
  assert.match(result.stdout, /Selected catalog: default/);
  assert.match(result.stdout, /Selected preset: balanced/);
  assert.match(result.stdout, /Active preset: balanced/);
  assert.match(result.stdout, /Activation: active/);
  assert.match(result.stdout, /In control: gsr/);
  assert.match(result.stdout, /Resolved routes:/);
});

test('status keeps working after cwd changes within the process', async () => {
  const outsideCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cwd-'));
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.chdir(outsideCwd);
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
  assert.match(output, /Schema: v3/);
  assert.match(output, /Selected catalog: default/);
  assert.match(output, /Selected preset: balanced/);
  assert.match(output, /Active preset: balanced/);
  assert.match(output, /Activation: active/);
  assert.match(output, /In control: gsr/);
  assert.match(output, /Resolved routes:/);
});

test('status reports invalid configs honestly', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-invalid-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), 'version: nope\n', 'utf8');

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
  assert.match(output, /Status: invalid/);
  assert.match(output, /version: 1|router\.yaml requires version: 1/);
});

test('config discovery returns null when no router config exists', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-missing-'));

  assert.equal(discoverConfigPath([tempDir]), null);
});

function loadFixtureConfig(yaml = fixtureYaml) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return loadRouterConfig(configPath);
}
