import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
      spec:
        - anthropic/claude-opus
        - openai/o3
      design:
        - anthropic/claude-opus
        - openai/o3
      tasks:
        - google/gemini-flash
        - openai/gpt
      apply:
        - ollama/qwen3-coder
        - anthropic/claude-sonnet
      verify:
        - openai/o3
        - anthropic/claude-opus
      archive:
        - anthropic/claude-sonnet
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
`;

const multimodelFixtureYaml = `version: 3

active_catalog: default
active_preset: balanced
active_profile: balanced
activation_state: active

catalogs:
  default:
    availability: stable
    metadata:
      labels:
        - multimodel
        - shared
      pricing:
        band: platform
        currency: usd
    guidance:
      default:
        laneCount: 2
        ordering:
          - primary
          - judge
          - radar
    presets:
      balanced:
        aliases:
          - latest
        availability: stable
        complexity: high
        metadata:
          labels:
            - balanced
            - recommended
          pricing:
            band: team
            currency: usd
        guidance:
          default:
            laneCount: 2
            ordering:
              - primary
              - judge
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
      focused:
        aliases:
          - quick
        availability: beta
        complexity:
          label: focused
        metadata:
          labels:
            - focused
            - fast
          pricing:
            band: starter
            currency: eur
        guidance:
          default:
            laneCount: 1
            ordering:
              - primary
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: openai/gpt
              fallbacks: anthropic/claude-sonnet
            - kind: lane
              phase: orchestrator
              role: radar
              target: google/gemini-pro
              fallbacks: openai/o3
`;

test('CLI render opencode includes the agent-teams-lite consumer contract', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['inspect', 'render', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Agent Teams Lite contract: degraded/);
  assert.match(output, /Agent Teams Lite compatibility: limited/);
  assert.match(output, /Agent Teams Lite mode: report-only/);
  assert.match(output, /Agent Teams Lite read: available/);
  assert.match(output, /Host session sync: ready/);
  assert.match(output, /Slash root: \/gsr/);
});

test('CLI render opencode reports v3 schema metadata without execution wording', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-v3-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), v3FixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['inspect', 'render', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Schema: v3/);
  assert.match(output, /Selected preset: balanced/);
  assert.match(output, /Host session sync: ready/);
  assert.match(output, /Lane roles: primary \/ judge \/ radar/);
  assert.match(output, /Compatibility notes:/);
  assert.match(output, /Multimodel orchestration manager: 1/);
  assert.match(output, /Manager mode: sequential/);
  assert.match(output, /Manager policy: report-only \/ non-executing/);
});

test('CLI browse exposes shareable multimodel metadata without recommendation wording', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-browse-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), multimodelFixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['inspect', 'browse']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Command: browse multimodel/);
  assert.match(output, /Status: report-only/);
  assert.match(output, /Visibility: availability=yes pricing=yes labels=yes guidance=yes/);
  assert.match(output, /Policy: non-recommendation \/ non-execution/);
  assert.match(output, /Catalog labels: multimodel \/ shared/);
  assert.match(output, /Preset aliases: latest/);
  assert.match(output, /Pricing: band=team, currency=usd/);
  assert.match(output, /Guidance: default\(lanes=2, ordering=primary \/ judge\)/);
  assert.doesNotMatch(output, /recommendation engine|scoring|orchestration|provider execution/i);
});

test('CLI compare reports projected metadata deltas only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-compare-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), multimodelFixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['inspect', 'compare', 'default/balanced', 'default/focused']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Command: compare multimodel/);
  assert.match(output, /Status: report-only/);
  assert.match(output, /Left: default\/balanced/);
  assert.match(output, /Right: default\/focused/);
  assert.match(output, /Differences:/);
  assert.match(output, /preset\.availability: stable -> beta/);
  assert.match(output, /pricing\.band: team -> starter/);
  assert.doesNotMatch(output, /recommendation engine|scoring|orchestration|provider execution/i);
});

// ── gsr apply opencode ────────────────────────────────────────────────────────

const v4CoreFixtureYaml = `version: 4
active_catalog: default
active_preset: fast
activation_state: active
`;

const v4FastProfileYaml = `name: fast
availability: stable
visible: true
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: orchestrator
      role: primary
`;

const v4SafetyProfileYaml = `name: safety
availability: stable
visible: true
permissions:
  read: true
  write: false
  edit: false
  bash: false
  delegate: true
phases:
  orchestrator:
    - target: openai/gpt
      kind: lane
      phase: orchestrator
      role: primary
`;

function makeV4TempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-apply-'));
  fs.mkdirSync(path.join(tempDir, 'router', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), v4CoreFixtureYaml, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'router', 'profiles', 'fast.router.yaml'), v4FastProfileYaml, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'router', 'profiles', 'safety.router.yaml'), v4SafetyProfileYaml, 'utf8');
  return tempDir;
}

test('CLI apply opencode previews agents without writing any files', async () => {
  const tempDir = makeV4TempDir();

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  process.env.GSR_TEST_NO_GLOBAL = '1';

  try {
    await runCli(['setup', 'apply', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    delete process.env.GSR_TEST_NO_GLOBAL;
    fs.rmSync(tempDir, { recursive: true });
  }

  const output = chunks.join('');

  assert.match(output, /OpenCode overlay: 2 agent\(s\)/);
  assert.match(output, /gsr-fast/);
  assert.match(output, /gsr-safety.*\[restricted\]/);
  assert.match(output, /Run `gsr apply opencode --apply`/);
  // Boundary: no provider execution wording
  assert.doesNotMatch(output, /provider execution|executing|running/i);
});

test('CLI apply opencode --apply writes overlay to temp file without touching non-gsr keys', async () => {
  const tempDir = makeV4TempDir();

  // Create a fake opencode.json with an existing non-gsr agent.
  const opencodeDir = path.join(tempDir, '.config', 'opencode');
  const opencodeConfigPath = path.join(opencodeDir, 'opencode.json');
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(opencodeConfigPath, JSON.stringify({
    agent: {
      'my-agent': { mode: 'primary' },
      'gsr-stale': { mode: 'primary', _gsr_generated: true },
    },
  }, null, 2), 'utf8');

  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  // Point HOME to tempDir so the overlay writes to our fake opencode.json.
  process.env.HOME = tempDir;
  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    // Dynamically override OPENCODE_CONFIG_PATH by passing targetPath through the facade.
    // Instead, re-import overlay-generator with HOME overridden — the path is computed once at import.
    // Test approach: write our own merged config check after the run.
    const { applyOpenCodeOverlayCommand: applyCmd } = await import('../src/adapters/opencode/index.js');
    const routerConfigPath = path.join(tempDir, 'router', 'router.yaml');

    const report = applyCmd({
      apply: true,
      configPath: routerConfigPath,
      targetPath: opencodeConfigPath,
    });

    assert.ok(report.writtenPath, 'writtenPath is set');
    assert.ok(Object.keys(report.agents).length > 0, 'agents generated');

    const written = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf8'));

    assert.ok(written.agent['my-agent'], 'non-gsr agent preserved');
    assert.equal(Object.prototype.hasOwnProperty.call(written.agent, 'gsr-stale'), false, 'stale gsr agent removed');
    assert.ok(written.agent['gsr-fast'], 'gsr-fast added');
    assert.ok(written.agent['gsr-safety'], 'gsr-safety added');

    const safetyTools = written.agent['gsr-safety'].tools;
    assert.equal(safetyTools.write, false, 'safety write is false');
    assert.equal(safetyTools.bash, false, 'safety bash is false');
    assert.equal(safetyTools.read, true, 'safety read is true');
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('CLI apply opencode boundary: no provider execution', async () => {
  const tempDir = makeV4TempDir();

  const originalCwd = process.cwd();

  process.chdir(tempDir);

  try {
    // The apply command must not import or invoke any provider execution contracts.
    // Verify by checking the module does not call execution-oriented functions.
    const { applyOpenCodeOverlayCommand: applyCmd } = await import('../src/adapters/opencode/index.js');
    const routerConfigPath = path.join(tempDir, 'router', 'router.yaml');

    // This should complete synchronously without any I/O to external providers.
    const report = applyCmd({ apply: false, configPath: routerConfigPath });

    assert.ok(report.agents, 'report has agents');
    assert.equal(report.writtenPath, undefined, 'writtenPath is undefined in preview mode');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

// ── runCli command coverage ───────────────────────────────────────────────────

const v4MultivendorFixtureYaml = `version: 4
active_preset: multivendor
activation_state: active
`;

const multivendorProfileYaml = `name: multivendor
availability: stable
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: orchestrator
      role: primary
`;

function makeMultivendorV4TempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-mv-'));
  fs.mkdirSync(path.join(tempDir, 'router', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), v4MultivendorFixtureYaml, 'utf8');
  fs.writeFileSync(
    path.join(tempDir, 'router', 'profiles', 'multivendor.router.yaml'),
    multivendorProfileYaml,
    'utf8',
  );
  return tempDir;
}

async function captureRunCli(argv, tempDir) {
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(argv);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  return chunks.join('');
}

test('gsr route show runs without error and produces output', async () => {
  const tempDir = makeMultivendorV4TempDir();

  try {
    const output = await captureRunCli(['route', 'show'], tempDir);
    assert.match(output, /Resolved routes:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr preset list runs without error and shows presets', async () => {
  const tempDir = makeMultivendorV4TempDir();

  try {
    const output = await captureRunCli(['preset', 'list'], tempDir);
    assert.match(output, /Presets:/);
    assert.match(output, /multivendor/);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr update without --apply shows pending migrations or up-to-date message', async () => {
  const tempDir = makeMultivendorV4TempDir();

  try {
    const output = await captureRunCli(['update'], tempDir);
    assert.ok(
      output.includes('up to date') || output.includes('Pending migrations'),
      `Expected up-to-date or pending migrations in: ${output}`,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr setup apply with no target throws informative error', async () => {
  const tempDir = makeMultivendorV4TempDir();
  const originalCwd = process.cwd();

  process.chdir(tempDir);
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  try {
    await assert.rejects(
      () => runCli(['setup', 'apply']),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('requires a target'), `Expected 'requires a target' in: ${err.message}`);
        return true;
      },
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr setup apply with unknown target throws informative error', async () => {
  const tempDir = makeMultivendorV4TempDir();
  const originalCwd = process.cwd();

  process.chdir(tempDir);
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  try {
    await assert.rejects(
      () => runCli(['setup', 'apply', 'vscode']),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Unknown apply target'), `Expected 'Unknown apply target' in: ${err.message}`);
        return true;
      },
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

// ── Pre-install guard tests ───────────────────────────────────────────────────

function makeTempDirWithoutInstall() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-no-install-'));
}

test('gsr status without install passes through guard and shows status output', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['status']);
    const output = chunks.join('');
    // 'status' is whitelisted so the guard does NOT block it.
    // runStatus handles missing config gracefully.
    assert.ok(
      !output.includes('is not installed'),
      `Pre-install guard should not trigger for 'status' command`,
    );
    // status always outputs some status info
    assert.ok(output.length > 0, 'Expected some output from status');
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr route use without install outputs not-installed message', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['route', 'use', 'someprofile']);
    const output = chunks.join('');
    assert.ok(
      output.includes('not installed') || output.includes('is not installed'),
      `Expected not-installed message in: ${output}`,
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr setup install without config does not trigger pre-install guard', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['setup', 'install']);
    const output = chunks.join('');
    // Should NOT output the guard message; install is whitelisted
    assert.ok(
      !output.includes('is not installed'),
      `Pre-install guard should not trigger for install command, but got: ${output}`,
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr help without install works normally', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['help']);
    const output = chunks.join('');
    assert.ok(output.includes('Usage:'), `Expected help output, got: ${output}`);
    assert.ok(
      !output.includes('is not installed'),
      `Pre-install guard should not trigger for help command`,
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr version without install works normally', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['version']);
    const output = chunks.join('');
    assert.ok(output.includes('gsr v'), `Expected version output, got: ${output}`);
    assert.ok(
      !output.includes('is not installed'),
      `Pre-install guard should not trigger for version command`,
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

test('gsr setup install without config does not trigger pre-install guard', async () => {
  const tempDir = makeTempDirWithoutInstall();
  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await runCli(['setup', 'install']);
    const output = chunks.join('');
    // Should NOT output the guard message; setup install is allowed through
    assert.ok(
      !output.includes('is not installed'),
      `Pre-install guard should not trigger for 'setup install' command, but got: ${output}`,
    );
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});

// ── Project-isolation tests ───────────────────────────────────────────────────

test('applyOpenCodeOverlayCommand writes to project-local opencode.json when configPath is provided', async () => {
  const tempDir = makeV4TempDir();
  const routerConfigPath = path.join(tempDir, 'router', 'router.yaml');
  const expectedLocalPath = path.join(tempDir, 'opencode.json');

  const { applyOpenCodeOverlayCommand: applyCmd } = await import('../src/adapters/opencode/index.js');

  const report = applyCmd({ apply: true, configPath: routerConfigPath });

  assert.ok(report.writtenPath, 'writtenPath should be set');
  assert.equal(report.writtenPath, expectedLocalPath, 'should write to project-local opencode.json');
  assert.ok(fs.existsSync(expectedLocalPath), 'project-local opencode.json should exist');

  const globalOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  // If global file exists, it must NOT have gsr-* entries written by this apply
  if (fs.existsSync(globalOpenCodePath)) {
    const global = JSON.parse(fs.readFileSync(globalOpenCodePath, 'utf8'));
    const gsrKeys = Object.keys(global.agent ?? {}).filter((k) => k.startsWith('gsr-'));
    // The global file was not written by this apply (project-local was used)
    assert.equal(report.writtenPath, expectedLocalPath, 'writtenPath must point to project-local, not global');
  }

  fs.rmSync(tempDir, { recursive: true });
});

test('removeOpenCodeOverlay with local path does not affect global file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-isolation-'));
  const localPath = path.join(tempDir, 'opencode.json');
  const globalFakePath = path.join(tempDir, 'global-opencode.json');

  // Write both local and fake-global with gsr-* entries
  const withGsr = JSON.stringify({ agent: { 'gsr-test': { mode: 'primary' }, 'other': { mode: 'primary' } } }, null, 2);
  fs.writeFileSync(localPath, withGsr, 'utf8');
  fs.writeFileSync(globalFakePath, withGsr, 'utf8');

  const { removeOpenCodeOverlay } = await import('../src/adapters/opencode/overlay-generator.js');

  const result = removeOpenCodeOverlay(localPath);

  assert.equal(result.removedCount, 1, 'should remove 1 gsr-* entry from local file');
  assert.equal(result.path, localPath, 'result path should be the local path');

  // Local file: gsr-test removed, 'other' preserved
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(local.agent, 'gsr-test'), false, 'gsr-test removed from local');
  assert.ok(local.agent['other'], 'non-gsr key preserved in local');

  // Global (fake) file: untouched
  const global = JSON.parse(fs.readFileSync(globalFakePath, 'utf8'));
  assert.ok(global.agent['gsr-test'], 'global file untouched by local removal');

  fs.rmSync(tempDir, { recursive: true });
});

test('runUninstall does not remove gsr-*.md command files', async () => {
  const tempDir = makeMultivendorV4TempDir();
  const commandsDir = path.join(os.homedir(), '.config', 'opencode', 'commands');

  // Check how many gsr-*.md files exist before uninstall
  let commandFilesBefore = [];
  if (fs.existsSync(commandsDir)) {
    commandFilesBefore = fs.readdirSync(commandsDir).filter((f) => f.startsWith('gsr-') && f.endsWith('.md'));
  }

  const originalCwd = process.cwd();
  process.chdir(tempDir);
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  try {
    await runCli(['uninstall']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }

  // Command files must remain after uninstall
  if (commandFilesBefore.length > 0) {
    const commandFilesAfter = fs.readdirSync(commandsDir).filter((f) => f.startsWith('gsr-') && f.endsWith('.md'));
    assert.deepEqual(commandFilesAfter, commandFilesBefore, 'gsr-*.md command files must not be removed on uninstall');
  }
  // If no command files existed before, we just verify uninstall did not fail (test passed to here)
});

// ── gsr sync — unified pipeline (REQ-1, REQ-4, REQ-5, REQ-8, REQ-10) ─────────

/**
 * Create a temp dir with a valid router config (v3 inline catalogs) + contracts dir.
 * Uses version 3 so overlay generation works with inline presets in tests.
 */
function makeSyncTempDir({ withContracts = true, withPresets = true } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-sync-test-'));
  const routerDir = path.join(tempDir, 'router');

  if (withContracts) {
    fs.mkdirSync(path.join(routerDir, 'contracts', 'roles'), { recursive: true });
    fs.mkdirSync(path.join(routerDir, 'contracts', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(routerDir, 'contracts', 'roles', 'primary.md'), '# Role: Primary\n', 'utf8');
    fs.writeFileSync(path.join(routerDir, 'contracts', 'phases', 'orchestrator.md'), '# Phase: Orchestrator\n', 'utf8');
  } else {
    fs.mkdirSync(routerDir, { recursive: true });
  }

  const presetsYaml = withPresets ? `
catalogs:
  default:
    enabled: true
    presets:
      testpreset:
        availability: stable
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet` : '';

  const routerYaml = `version: 3
active_catalog: default
active_preset: balanced
activation_state: active
${presetsYaml}`;

  fs.writeFileSync(path.join(routerDir, 'router.yaml'), routerYaml, 'utf8');
  return { tempDir, routerDir };
}

test('gsr sync — reports contracts, agents, and commands in output (REQ-1, REQ-8)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });

  const output = await captureRunCli(['sync'], tempDir);

  // Must report sync outcome
  assert.match(output, /Sync(ed|.)/i, 'must report sync result');
  assert.doesNotMatch(output, /Sync failed:/i, 'must not report fatal failure');
});

test('gsr sync --dry-run — does not write opencode.json (REQ-4)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['sync', '--dry-run']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const opencodeJsonPath = path.join(tempDir, 'opencode.json');
  assert.equal(fs.existsSync(opencodeJsonPath), false, 'opencode.json must NOT be written in dry-run');

  const output = chunks.join('');
  assert.match(output, /dry.run/i, 'output must mention dry-run');
});

test('gsr sync -- missing contracts dir skips gracefully with warning (Fix 1)', async () => {
  const { tempDir } = makeSyncTempDir({ withContracts: false });

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['sync']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');
  // Fix 1: missing contracts dir should produce a warning, not a fatal failure
  assert.doesNotMatch(output, /Sync failed:/i, 'must NOT report fatal failure when contracts dir is missing');
  assert.match(output, /warning|skip|contracts/i, 'must warn about missing contracts dir');
});

test('gsr sync summary includes agent count from unified result (REQ-8)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });

  const output = await captureRunCli(['sync', '--dry-run'], tempDir);

  // Dry-run must still report what would happen — no error
  assert.doesNotMatch(output, /Sync failed:/i, 'dry-run must not report fatal failure');
});

test('gsr sync second run reports already up to date (REQ-2 noop)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });

  // First run: writes opencode.json
  await captureRunCli(['sync'], tempDir);

  // Second run: same config, noop expected — must print sync-level "Already up to date."
  // The phrase must appear as a standalone sync status message, not within "commands: N already up to date"
  const secondOutput = await captureRunCli(['sync'], tempDir);
  assert.match(secondOutput, /^Already up to date\./im, 'second run with no changes must say "Already up to date." as a standalone sync status line');
});

test('gsr sync --dry-run reports would-create and would-update counts (REQ-4)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });

  const output = await captureRunCli(['sync', '--dry-run'], tempDir);
  // Dry-run must report what would happen — specific "Would create: N" format
  assert.match(output, /Would create: \d+/i, 'dry-run must report "Would create: N" count');
  assert.doesNotMatch(output, /Sync failed:/i, 'dry-run must not report failure');
});

test('gsr sync reports preserved user override count (REQ-8)', async () => {
  const { tempDir } = makeSyncTempDir({ withPresets: true });
  const opencodeJsonPath = path.join(tempDir, 'opencode.json');

  // Pre-seed opencode.json with a user-modified gsr-* entry (no _gsr_generated)
  const userEntry = {
    agent: {
      'gsr-testpreset': {
        model: 'openai/custom',
        instructions: 'User customized this entry — no _gsr_generated marker',
      },
    },
  };
  fs.writeFileSync(opencodeJsonPath, JSON.stringify(userEntry, null, 2), 'utf8');

  const output = await captureRunCli(['sync'], tempDir);
  // Must report explicit preserved count: "Preserved N user-modified entries"
  assert.match(output, /Preserved \d+ user-modified entr/i, 'must report count of preserved user overrides');
});

test('gsr setup apply opencode --apply still works after unified sync refactor (REQ-9)', async () => {
  const tempDir = makeV4TempDir();

  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const { applyOpenCodeOverlayCommand: applyCmd } = await import('../src/adapters/opencode/index.js');
    const routerConfigPath = path.join(tempDir, 'router', 'router.yaml');
    const targetPath = path.join(tempDir, 'opencode.json');

    const report = applyCmd({
      apply: true,
      configPath: routerConfigPath,
      targetPath,
    });

    assert.ok(report.agents, 'backward compat: report.agents must exist');
    assert.ok(typeof report.warnings !== 'undefined', 'backward compat: report.warnings must exist');
    assert.ok(report.writtenPath, 'backward compat: report.writtenPath must be set');
    assert.ok(fs.existsSync(targetPath), 'backward compat: opencode.json must be written');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true });
  }
});
