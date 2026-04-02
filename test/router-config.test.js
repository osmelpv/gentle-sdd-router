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
import { normalizeRouterSchemaV3, validateRouterSchemaV3 } from '../src/router-config.js';
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

test('status --verbose command renders resolved routes', async () => {
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
    await runCli(['status', '--verbose']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  // New verbose format: CONFIGURATION + PRESET + ROUTES sections
  assert.ok(
    output.includes('CONFIGURATION') || output.includes('⚠️') || output.includes('✅'),
    `Should show status header or CONFIGURATION. Got:\n${output.slice(0, 500)}`
  );
  assert.ok(output.includes('Activation'), `Should show Activation. Got:\n${output.slice(0, 500)}`);
  assert.ok(
    output.includes('ROUTES') || output.includes('orchestrator'),
    `Should show ROUTES section. Got:\n${output.slice(0, 500)}`
  );
  // orchestrator phase appears in the routes section (either with claude-sonnet or gpt-4.1)
  assert.ok(
    output.includes('orchestrator'),
    `Should show orchestrator phase. Got:\n${output.slice(0, 800)}`
  );
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
  assert.match(output, /Compatibility: router\.yaml versions 1, 3, and 4 are supported; v3 powers multimodel browse\/compare and v4 is the current multi-file format\./i);
  assert.match(output, /Quickstart: run gsr status, then gsr bootstrap if router\/router\.yaml is missing\./i);
  assert.match(output, /use <profile>\s+Select the active profile in router\/router\.yaml without changing who is in control\./i);
  assert.match(output, /status\s+Show current router status\./i);
  assert.match(output, /list\s+List available profiles and mark the active one\./i);
  assert.match(output, /browse \[selector\]\s+Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything\./i);
  assert.match(output, /compare <left> <right>\s+Compare two shareable multimodel projections without recommending or executing anything\./i);
  assert.match(output, /activate\s+Take control of routing without changing the active profile\./i);
  assert.match(output, /deactivate\s+Hand control back to (Alan\/gentle-ai|host) without changing the active profile\./i);
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

test('install command materializes a starter config on a fresh repo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-install-fresh-cli-'));

  const binPath = fileURLToPath(new URL('../bin/gsr.js', import.meta.url));
  const result = spawnSync(process.execPath, [binPath, 'install'], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Command: install opencode/);
  assert.match(result.stdout, /Status: created/);
  assert.match(result.stdout, /Created router\/router\.yaml from scratch/i);
  assert.ok(fs.existsSync(path.join(tempDir, 'router', 'router.yaml')));
});

test('install command honors activation intent on a fresh repo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-install-fresh-active-cli-'));

  const binPath = fileURLToPath(new URL('../bin/gsr.js', import.meta.url));
  const result = spawnSync(process.execPath, [binPath, 'install', '--intent', 'activation=active'], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Command: install opencode/);
  assert.match(result.stdout, /Status: created/);

  const persisted = loadRouterConfig(path.join(tempDir, 'router', 'router.yaml'));
  assert.equal(persisted.activation_state, 'active');
  // v4 fresh install uses 'multivendor' as the default active preset
  assert.equal(persisted.active_preset, 'multivendor');
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
    await runCli(['status', '--verbose']);
    output = chunks.join('');
    // New verbose: Controller field shows gsr when active; Activation shows state
    assert.ok(
      output.includes('Controller') && output.includes('gsr'),
      `Should show gsr controller. Got:\n${output.slice(0, 500)}`
    );
    assert.match(output, /Activation\s+active/);

    chunks.length = 0;
    await runCli(['deactivate']);
    output = chunks.join('');
    assert.match(output, /Command: deactivate opencode/);
    assert.match(output, /Status: updated/);
    persisted = loadRouterConfig(configPath);
    assert.equal(persisted.activation_state, 'inactive');
    assert.equal(persisted.active_profile, 'default');

    chunks.length = 0;
    await runCli(['status', '--verbose']);
    output = chunks.join('');
    assert.match(output, /Activation\s+inactive/);
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

test('status --verbose resolves config from outside the repo cwd', () => {
  const outsideCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-outside-'));
  const binPath = fileURLToPath(new URL('../bin/gsr.js', import.meta.url));
  const result = spawnSync(process.execPath, [binPath, 'status', '--verbose'], {
    cwd: outsideCwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  // The project's router/router.yaml is a v4 multi-file config; status must show v4.
  // New verbose format: CONFIGURATION section with Schema, PRESET section, ROUTES section.
  assert.ok(
    result.stdout.includes('v4') || result.stdout.includes('Schema'),
    `Should show v4 schema. Got:\n${result.stdout.slice(0, 500)}`
  );
  assert.ok(
    result.stdout.includes('multivendor'),
    `Should show multivendor preset. Got:\n${result.stdout.slice(0, 500)}`
  );
  assert.ok(
    result.stdout.includes('Activation') && result.stdout.includes('active'),
    `Should show active activation. Got:\n${result.stdout.slice(0, 500)}`
  );
  assert.ok(
    result.stdout.includes('ROUTES') || result.stdout.includes('orchestrator'),
    `Should show routes. Got:\n${result.stdout.slice(0, 500)}`
  );
});

test('status --verbose keeps working after cwd changes within the process', async () => {
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
    await runCli(['status', '--verbose']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  // The project's router/router.yaml is a v4 multi-file config; status must show v4 not v3.
  // New verbose format uses CONFIGURATION, PRESET, ROUTES sections.
  assert.ok(
    output.includes('v4') || output.includes('Schema'),
    `Should show v4 schema. Got:\n${output.slice(0, 500)}`
  );
  assert.ok(
    output.includes('multivendor'),
    `Should show multivendor preset. Got:\n${output.slice(0, 500)}`
  );
  assert.ok(
    output.includes('Activation') && output.includes('active'),
    `Should show active activation. Got:\n${output.slice(0, 500)}`
  );
  assert.ok(
    output.includes('ROUTES') || output.includes('orchestrator'),
    `Should show routes. Got:\n${output.slice(0, 500)}`
  );
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
    // Default (simple) status shows simplified error message
    await runCli(['status']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  // Simple mode shows a user-friendly error indicator
  assert.ok(
    output.includes('❌') || output.includes('error') || output.includes('invalid'),
    `Status should report an error indicator. Got: ${output}`
  );
  // Should still mention the config issue in some form
  assert.ok(
    output.includes('version') || output.includes('router.yaml') || output.includes('Configuration'),
    `Status should mention configuration issue. Got: ${output}`
  );
});

test('config discovery returns null when no router config exists', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-missing-'));

  assert.equal(discoverConfigPath([tempDir]), null);
});

// ── v4 multi-file tests ──────────────────────────────────────────────────────

const v4CoreYaml = `version: 4
active_catalog: default
active_preset: balanced
activation_state: active
`;

const v4BalancedProfileYaml = `name: balanced
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
  verify:
    - target: openai/o3
      phase: verify
      role: judge
`;

const v4SafetyProfileYaml = `name: safety
phases:
  orchestrator:
    - target: anthropic/claude-opus
      phase: orchestrator
      role: primary
`;

const v4TurboProfileYaml = `name: turbo
phases:
  orchestrator:
    - target: openai/gpt-4o
      phase: orchestrator
      role: primary
`;

function makeV4TempDir({ extraProfiles = [], subdirProfiles = [] } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-v4-'));
  const routerDir = path.join(tempDir, 'router');
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  fs.writeFileSync(path.join(routerDir, 'router.yaml'), v4CoreYaml, 'utf8');
  fs.writeFileSync(path.join(profilesDir, 'balanced.router.yaml'), v4BalancedProfileYaml, 'utf8');

  for (const { filename, yaml } of extraProfiles) {
    fs.writeFileSync(path.join(profilesDir, filename), yaml, 'utf8');
  }

  for (const { subdir, filename, yaml } of subdirProfiles) {
    const subdirPath = path.join(profilesDir, subdir);
    fs.mkdirSync(subdirPath, { recursive: true });
    fs.writeFileSync(path.join(subdirPath, filename), yaml, 'utf8');
  }

  return { tempDir, routerDir, configPath: path.join(routerDir, 'router.yaml') };
}

test('v4 load round-trip: assembles multi-file config with correct catalogs and presets', () => {
  const { tempDir, configPath } = makeV4TempDir({
    extraProfiles: [{ filename: 'safety.router.yaml', yaml: v4SafetyProfileYaml }],
  });

  try {
    const config = loadRouterConfig(configPath);

    // Assembled config is v3-shaped
    assert.equal(config.version, 3);
    assert.equal(config.active_catalog, 'default');
    assert.equal(config.active_preset, 'balanced');
    assert.equal(config.activation_state, 'active');

    // Both profiles land in the default catalog
    assert.ok(config.catalogs.default, 'default catalog exists');
    assert.ok(config.catalogs.default.presets.balanced, 'balanced preset exists');
    assert.ok(config.catalogs.default.presets.safety, 'safety preset exists');

    // Phases are preserved
    assert.ok(config.catalogs.default.presets.balanced.phases.orchestrator, 'orchestrator phase in balanced');
    assert.ok(config.catalogs.default.presets.balanced.phases.verify, 'verify phase in balanced');

    // _v4Source is non-enumerable and routerDir is set
    assert.ok(config._v4Source, '_v4Source exists');
    assert.equal(config._v4Source.routerDir, path.dirname(configPath));
    assert.ok(!Object.keys(config).includes('_v4Source'), '_v4Source is non-enumerable');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('v4 with subdirectory catalog: infers catalog name from subdir', () => {
  const { tempDir, configPath } = makeV4TempDir({
    subdirProfiles: [{ subdir: 'experimental', filename: 'turbo.router.yaml', yaml: v4TurboProfileYaml }],
  });

  try {
    const config = loadRouterConfig(configPath);

    assert.equal(config.version, 3);
    assert.ok(config.catalogs.default, 'default catalog exists for root profiles');
    assert.ok(config.catalogs.experimental, 'experimental catalog inferred from subdir');
    assert.ok(config.catalogs.experimental.presets.turbo, 'turbo preset in experimental catalog');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('v4 save round-trip: modify active_preset then reload matches', () => {
  const { tempDir, configPath } = makeV4TempDir({
    extraProfiles: [{ filename: 'safety.router.yaml', yaml: v4SafetyProfileYaml }],
  });

  try {
    const loaded = loadRouterConfig(configPath);

    // Switch active preset to 'safety'
    const updated = setActiveProfile(loaded, 'safety');
    assert.equal(updated.active_preset, 'safety');

    saveRouterConfig(updated, configPath, loaded);

    // Reload and verify
    const reloaded = loadRouterConfig(configPath);
    assert.equal(reloaded.version, 3);
    assert.equal(reloaded.active_preset, 'safety');
    assert.equal(reloaded.active_catalog, 'default');

    // Profile files are still present
    const profilesDir = path.join(path.dirname(configPath), 'profiles');
    assert.ok(fs.existsSync(path.join(profilesDir, 'balanced.router.yaml')));
    assert.ok(fs.existsSync(path.join(profilesDir, 'safety.router.yaml')));

    // No leftover .tmp files
    const allFiles = fs.readdirSync(path.dirname(configPath));
    assert.ok(!allFiles.some((name) => name.endsWith('.tmp')), 'no leftover .tmp files');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('v4 save round-trip without previousConfig: setActiveProfile preserves _v4Source so v4 structure is not destroyed', () => {
  // This is the regression test for the bug where `gsr use <profile>` would destroy
  // the v4 multi-file structure because saveRouterConfig was called without previousConfig.
  // The fix: setActiveProfile now preserves the non-enumerable _v4Source property.
  const { tempDir, configPath } = makeV4TempDir({
    extraProfiles: [{ filename: 'safety.router.yaml', yaml: v4SafetyProfileYaml }],
  });

  try {
    const loaded = loadRouterConfig(configPath);

    // Confirm it's a v4 assembled config
    assert.ok(Object.getOwnPropertyDescriptor(loaded, '_v4Source'), '_v4Source present on loaded config');

    // Switch active preset — this is what runUse does
    const updated = setActiveProfile(loaded, 'safety');

    // _v4Source must survive the spread inside setActiveProfile
    assert.ok(
      Object.getOwnPropertyDescriptor(updated, '_v4Source'),
      '_v4Source still present after setActiveProfile'
    );

    // Save WITHOUT passing previousConfig (simulates the original runUse bug path,
    // now fixed by setActiveProfile preserving _v4Source)
    saveRouterConfig(updated, configPath);

    // The core router.yaml must still be a v4 core file (small, version: 4)
    const coreRaw = fs.readFileSync(configPath, 'utf8');
    assert.match(coreRaw, /^version: 4/m, 'core router.yaml still has version: 4');
    assert.doesNotMatch(coreRaw, /catalogs:/, 'core router.yaml must not contain catalogs (that would be a v3 monolith)');

    // Profile files must still exist
    const profilesDir = path.join(path.dirname(configPath), 'profiles');
    assert.ok(fs.existsSync(path.join(profilesDir, 'balanced.router.yaml')), 'balanced profile file still exists');
    assert.ok(fs.existsSync(path.join(profilesDir, 'safety.router.yaml')), 'safety profile file still exists');

    // Reload must give the new preset
    const reloaded = loadRouterConfig(configPath);
    assert.equal(reloaded.active_preset, 'safety', 'active_preset updated to safety');
    assert.equal(reloaded.version, 3, 'reloaded config is assembled as v3-shaped');
    assert.ok(Object.getOwnPropertyDescriptor(reloaded, '_v4Source'), '_v4Source present after reload');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('v3 backward compat: monolith loads and resolves correctly', () => {
  const config = loadFixtureConfig(v3FixtureYaml);
  const state = resolveRouterState(config);

  // Explicit version assertion
  assert.equal(config.version, 3);
  assert.ok(config.catalogs, 'catalogs present');
  assert.ok(config.catalogs.default, 'default catalog present');
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.selectedCatalogName, 'default');
  assert.equal(state.selectedPresetName, 'balanced');

  // No _v4Source on v3 monolith
  assert.equal(config._v4Source, undefined);
});

test('v3 with profiles dir ignored: version field is authoritative', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-v3-profiles-'));

  try {
    const routerDir = path.join(tempDir, 'router');
    const profilesDir = path.join(routerDir, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });

    // Write a v3 monolith
    fs.writeFileSync(path.join(routerDir, 'router.yaml'), v3FixtureYaml, 'utf8');

    // Also write a stale v4-style profile file (should be ignored)
    fs.writeFileSync(
      path.join(profilesDir, 'balanced.router.yaml'),
      v4BalancedProfileYaml,
      'utf8'
    );

    const config = loadRouterConfig(path.join(routerDir, 'router.yaml'));

    // Should load as v3 monolith, not v4 multi-file
    assert.equal(config.version, 3);
    assert.ok(!config._v4Source, 'no _v4Source for v3 monolith');

    // The monolith catalogs should be used, not inferred from the profiles dir
    assert.ok(config.catalogs.default.presets.balanced, 'balanced preset from monolith');
    assert.ok(config.catalogs.default.presets.unavailable, 'unavailable preset from monolith (not in profiles dir)');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('v4 normalized equivalence: v4 multi-file produces same normalized output as equivalent v3 monolith', () => {
  // Equivalent v3 monolith for the v4 fixture above (balanced profile only)
  const equivalentV3Yaml = `version: 3
active_catalog: default
active_preset: balanced
active_profile: balanced
activation_state: active

catalogs:
  default:
    availability: stable
    presets:
      balanced:
        phases:
          orchestrator:
            - target: anthropic/claude-sonnet
              phase: orchestrator
              role: primary
          verify:
            - target: openai/o3
              phase: verify
              role: judge
`;

  const { tempDir: v4TempDir, configPath: v4ConfigPath } = makeV4TempDir();

  const v3TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-v3-equiv-'));

  try {
    // Load v4 multi-file
    const v4Config = loadRouterConfig(v4ConfigPath);

    // Load equivalent v3 monolith
    fs.mkdirSync(path.join(v3TempDir, 'router'), { recursive: true });
    fs.writeFileSync(path.join(v3TempDir, 'router', 'router.yaml'), equivalentV3Yaml, 'utf8');
    const v3Config = loadRouterConfig(path.join(v3TempDir, 'router', 'router.yaml'));

    // Both normalize to the same output
    const v4Normalized = normalizeRouterSchemaV3(v4Config);
    const v3Normalized = normalizeRouterSchemaV3(v3Config);

    assert.equal(v4Normalized.activeCatalogName, v3Normalized.activeCatalogName);
    assert.equal(v4Normalized.activePresetName, v3Normalized.activePresetName);
    assert.equal(v4Normalized.activationState, v3Normalized.activationState);
    assert.equal(v4Normalized.catalogs.length, v3Normalized.catalogs.length);

    const v4DefaultCatalog = v4Normalized.catalogs.find((c) => c.name === 'default');
    const v3DefaultCatalog = v3Normalized.catalogs.find((c) => c.name === 'default');

    assert.ok(v4DefaultCatalog, 'default catalog in v4 normalized output');
    assert.ok(v3DefaultCatalog, 'default catalog in v3 normalized output');

    const v4BalancedPreset = v4DefaultCatalog.presets.find((p) => p.name === 'balanced');
    const v3BalancedPreset = v3DefaultCatalog.presets.find((p) => p.name === 'balanced');

    assert.ok(v4BalancedPreset, 'balanced preset in v4 normalized output');
    assert.ok(v3BalancedPreset, 'balanced preset in v3 normalized output');

    // Phases should normalize to the same resolved routes
    assert.deepEqual(
      v4Normalized.resolvedPhases.orchestrator?.active,
      v3Normalized.resolvedPhases.orchestrator?.active
    );
  } finally {
    fs.rmSync(v4TempDir, { recursive: true });
    fs.rmSync(v3TempDir, { recursive: true });
  }
});

function loadFixtureConfig(yaml = fixtureYaml) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  const configPath = path.join(tempDir, 'router', 'router.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return loadRouterConfig(configPath);
}
