/**
 * Tests for src/core/unified-sync.js
 *
 * Covers: REQ-1 pipeline order, REQ-2 idempotency, partial failure,
 * default-only sync (REQ-10), dry-run (REQ-4), and force (REQ-5).
 *
 * Auto-wiring integration tests are in Phase 4.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { unifiedSync, ensurePluginDeps } from '../src/core/unified-sync.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal temp router directory with contracts + router.yaml.
 * Returns { routerDir, configPath, contractsDir }.
 */
function makeTempRouterDir(options = {}) {
  const {
    withCatalogs = false,
    catalogEnabled = true,
    withPresets = true,
    catalogName = 'default',
  } = options;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-us-test-'));
  const routerDir = path.join(tmpDir, 'router');
  const contractsDir = path.join(routerDir, 'contracts');

  fs.mkdirSync(path.join(contractsDir, 'roles'), { recursive: true });
  fs.mkdirSync(path.join(contractsDir, 'phases'), { recursive: true });

  // Minimal role contract
  fs.writeFileSync(
    path.join(contractsDir, 'roles', 'primary.md'),
    '# Role: Primary\n',
    'utf8'
  );

  // Minimal phase contract
  fs.writeFileSync(
    path.join(contractsDir, 'phases', 'orchestrator.md'),
    '# Phase: Orchestrator\n',
    'utf8'
  );

  // Build minimal router.yaml — use version:3 for inline catalogs (v4 requires profile files)
  let catalogsYaml = '';
  if (withCatalogs) {
    const enabledStr = catalogEnabled ? 'true' : 'false';
    const presetsYaml = withPresets
      ? `
    presets:
      testpreset:
        availability: stable
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet`
      : '';

    catalogsYaml = `
catalogs:
  ${catalogName}:
    enabled: ${enabledStr}${presetsYaml}
`;
  }

  const routerYaml = `version: 3
active_catalog: default
active_preset: balanced
activation_state: active
${catalogsYaml}`;

  const configPath = path.join(routerDir, 'router.yaml');
  fs.writeFileSync(configPath, routerYaml, 'utf8');

  return { tmpDir, routerDir, configPath, contractsDir };
}

// ── Result shape ──────────────────────────────────────────────────────────────

describe('unifiedSync — result shape', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns object with steps array', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.ok(Array.isArray(result.steps), 'steps must be an array');
    assert.ok(result.steps.length > 0, 'steps must not be empty');
  });

  test('returns status string that is ok, partial, or failed', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.ok(
      ['ok', 'partial', 'failed'].includes(result.status),
      `status must be ok|partial|failed, got: ${result.status}`
    );
  });

  test('returns warnings array', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.ok(Array.isArray(result.warnings), 'warnings must be an array');
  });

  test('returns requiresReopen boolean', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.equal(typeof result.requiresReopen, 'boolean', 'requiresReopen must be boolean');
  });

  test('each step has name and status fields', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    for (const step of result.steps) {
      assert.ok(typeof step.name === 'string', `step.name must be string, got ${typeof step.name}`);
      assert.ok(
        ['ok', 'skipped', 'failed'].includes(step.status),
        `step.status must be ok|skipped|failed, got: ${step.status}`
      );
    }
  });
});

// ── Pipeline order (REQ-1) ────────────────────────────────────────────────────

describe('unifiedSync — pipeline order (REQ-1)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('pipeline includes contracts step', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const names = result.steps.map(s => s.name);
    assert.ok(names.includes('contracts'), `expected contracts step, got: ${names.join(', ')}`);
  });

  test('pipeline includes overlay step', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const names = result.steps.map(s => s.name);
    assert.ok(names.includes('overlay'), `expected overlay step, got: ${names.join(', ')}`);
  });

  test('pipeline includes apply step', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const names = result.steps.map(s => s.name);
    assert.ok(names.includes('apply'), `expected apply step, got: ${names.join(', ')}`);
  });

  test('pipeline includes commands step', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const names = result.steps.map(s => s.name);
    assert.ok(names.includes('commands'), `expected commands step, got: ${names.join(', ')}`);
  });

  test('pipeline includes validate step', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const names = result.steps.map(s => s.name);
    assert.ok(names.includes('validate'), `expected validate step, got: ${names.join(', ')}`);
  });

  test('contracts step runs first (index 0)', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.equal(result.steps[0].name, 'contracts');
  });

  test('tui-plugin step runs last', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const last = result.steps[result.steps.length - 1];
    assert.equal(last.name, 'tui-plugin');
  });

  test('validate step runs second-to-last', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const secondToLast = result.steps[result.steps.length - 2];
    assert.equal(secondToLast.name, 'validate');
  });
});

// ── Dry-run mode (REQ-4) ─────────────────────────────────────────────────────

describe('unifiedSync — dry-run mode (REQ-4)', () => {
  let tmpDir;
  let configPath;
  let routerDir;

  beforeEach(() => {
    ({ tmpDir, configPath, routerDir } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('dry-run does not write opencode.json', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    await unifiedSync({ configPath, dryRun: true, targetPath });
    assert.equal(fs.existsSync(targetPath), false, 'opencode.json must NOT be written in dry-run');
  });

  test('dry-run does not write sync manifest', async () => {
    const manifestPath = path.join(routerDir, 'contracts', '.sync-manifest.json');
    await unifiedSync({ configPath, dryRun: true });
    assert.equal(fs.existsSync(manifestPath), false, 'manifest must NOT be written in dry-run');
  });

  test('dry-run returns status ok or partial (not failed)', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.ok(
      result.status !== 'failed',
      `dry-run should not fail on valid config, got: ${result.status}`
    );
  });
});

// ── Default-only sync (REQ-10) ────────────────────────────────────────────────

describe('unifiedSync — default-only sync (REQ-10)', () => {
  let tmpDir;
  let configPath;
  let contractsDir;

  beforeEach(() => {
    ({ tmpDir, configPath, contractsDir } = makeTempRouterDir());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns ok status with no catalogs in config', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.ok(
      ['ok', 'partial'].includes(result.status),
      `expected ok or partial, got: ${result.status}`
    );
  });

  test('contracts step succeeds and manifest data is in step.data', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const contractsStep = result.steps.find(s => s.name === 'contracts');
    assert.ok(contractsStep, 'contracts step must exist');
    assert.equal(contractsStep.status, 'ok', 'contracts step must succeed');
    assert.ok(contractsStep.data, 'contracts step must have data');
    assert.ok(typeof contractsStep.data.total === 'number', 'data.total must be number');
  });
});

// ── Partial failure (REQ-1 spec scenario) ────────────────────────────────────

describe('unifiedSync — missing contracts dir (graceful skip)', () => {
  test('returns failed status when configPath is missing', async () => {
    const result = await unifiedSync({
      configPath: '/nonexistent/path/router.yaml',
      dryRun: true,
    });
    assert.equal(result.status, 'failed', 'must return failed status for missing config');
  });

  test('skips contracts step gracefully when contracts dir is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-us-nocontracts-'));
    const routerDir = path.join(tmpDir, 'router');
    fs.mkdirSync(routerDir, { recursive: true });

    const configPath = path.join(routerDir, 'router.yaml');
    fs.writeFileSync(configPath, 'version: 4\n', 'utf8');

    try {
      const result = await unifiedSync({ configPath, dryRun: true });
      // Fix 1: contracts dir missing → skip gracefully, pipeline continues
      const contractsStep = result.steps.find(s => s.name === 'contracts');
      assert.equal(contractsStep.status, 'skipped', 'contracts step must be skipped, not failed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('pipeline continues past contracts when dir is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-us-nocontracts2-'));
    const routerDir = path.join(tmpDir, 'router');
    fs.mkdirSync(routerDir, { recursive: true });

    const configPath = path.join(routerDir, 'router.yaml');
    fs.writeFileSync(configPath, 'version: 4\n', 'utf8');

    try {
      const result = await unifiedSync({ configPath, dryRun: true });
      // overlay, apply, commands, validate steps must be present (not all skipped due to contracts)
      const stepNames = result.steps.map(s => s.name);
      assert.ok(stepNames.includes('overlay'), 'overlay step must be present');
      assert.ok(stepNames.includes('apply'), 'apply step must be present');
      assert.ok(stepNames.includes('validate'), 'validate step must be present');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('overall status is ok or partial (not failed) when contracts dir is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-us-nocontracts3-'));
    const routerDir = path.join(tmpDir, 'router');
    fs.mkdirSync(routerDir, { recursive: true });

    const configPath = path.join(routerDir, 'router.yaml');
    fs.writeFileSync(configPath, 'version: 4\n', 'utf8');

    try {
      const result = await unifiedSync({ configPath, dryRun: true });
      assert.ok(
        result.status !== 'failed',
        `pipeline should not fail when contracts dir is missing, got: ${result.status}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Force mode (REQ-5) ────────────────────────────────────────────────────────

describe('unifiedSync — force mode (REQ-5)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('force mode does not throw and returns status ok or partial', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    const result = await unifiedSync({ configPath, force: true, targetPath });
    assert.ok(
      ['ok', 'partial'].includes(result.status),
      `expected ok or partial, got: ${result.status}`
    );
  });

  test('force mode writes opencode.json', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    await unifiedSync({ configPath, force: true, targetPath });
    assert.ok(fs.existsSync(targetPath), 'opencode.json must be written in force mode');
  });
});

// ── Triangulation: step data content ─────────────────────────────────────────

describe('unifiedSync — step data content (triangulation)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('contracts step data has correct role/phase counts', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const contractsStep = result.steps.find(s => s.name === 'contracts');
    assert.equal(contractsStep.data.roles, 1, 'should have 1 role from fixture');
    assert.equal(contractsStep.data.phases, 1, 'should have 1 phase from fixture');
    assert.equal(contractsStep.data.total, 2, 'total = roles + phases');
  });

  test('skipped steps present after contracts failure', async () => {
    const result = await unifiedSync({
      configPath: '/nonexistent/router.yaml',
      dryRun: true,
    });
    assert.equal(result.status, 'failed');
    const skippedSteps = result.steps.filter(s => s.status === 'skipped');
    assert.ok(skippedSteps.length >= 4, 'should have at least 4 skipped steps after contracts failure');
  });

  test('overlay step has agent object in data', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const overlayStep = result.steps.find(s => s.name === 'overlay');
    assert.ok(overlayStep, 'overlay step must exist');
    assert.equal(overlayStep.status, 'ok', 'overlay step must succeed');
    assert.ok(typeof overlayStep.data.agent === 'object', 'overlay data must have agent object');
  });

  test('apply step in dry-run has dryRun flag in data', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const applyStep = result.steps.find(s => s.name === 'apply');
    assert.equal(applyStep.data.dryRun, true, 'apply step must report dryRun');
  });
});

// ── requiresReopen semantics ──────────────────────────────────────────────────

describe('unifiedSync — requiresReopen semantics', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('requiresReopen is false in dry-run (no file changes)', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    assert.equal(result.requiresReopen, false, 'dry-run must have requiresReopen = false');
  });

  test('requiresReopen is true when opencode.json is newly written', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    const result = await unifiedSync({ configPath, targetPath });
    // New file written means host needs to reload
    assert.equal(result.requiresReopen, true, 'writing new file should set requiresReopen = true');
  });

  test('requiresReopen is false when second sync produces identical gsr-* entries (REQ-8)', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    // First run: file created, requiresReopen = true
    const first = await unifiedSync({ configPath, targetPath });
    assert.equal(first.requiresReopen, true, 'first write must require reopen');

    // Second run: same agents, no change to gsr-* entries, requiresReopen = false
    const second = await unifiedSync({ configPath, targetPath });
    assert.equal(second.requiresReopen, false, 'second run with same agents must NOT require reopen');
  });

  test('requiresReopen is false when opencode.json has all expected gsr-* entries pre-populated (REQ-8)', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    // Run once to write the gsr-* entries
    await unifiedSync({ configPath, targetPath });

    // Run again: gsr-* entries already present — no opencode change needed
    const result = await unifiedSync({ configPath, targetPath });
    assert.equal(result.requiresReopen, false, 'manifest-only update must not require reopen');
  });
});

// ── Validation readback (REQ-8) ───────────────────────────────────────────────

describe('unifiedSync — validation readback (REQ-8)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('validate step has agentsVisible count after real write', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    const result = await unifiedSync({ configPath, targetPath });

    const validateStep = result.steps.find(s => s.name === 'validate');
    assert.ok(validateStep, 'validate step must exist');
    assert.equal(validateStep.status, 'ok', 'validate step must succeed');
    assert.ok(typeof validateStep.data.agentsVisible === 'number', 'agentsVisible must be number');
    assert.ok(typeof validateStep.data.expectedAgents === 'number', 'expectedAgents must be number');
    // At least 1 gsr-testpreset agent visible from our fixture
    assert.ok(validateStep.data.agentsVisible >= 1, 'at least 1 agent must be visible after write');
  });

  test('validate step shows 0 agentsVisible in dry-run', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });

    const validateStep = result.steps.find(s => s.name === 'validate');
    assert.equal(validateStep.data.dryRun, true, 'validate step must report dryRun');
    assert.equal(validateStep.data.agentsVisible, 0, 'dry-run must show 0 agents visible');
  });

  test('validate step requiresReopen is false in dry-run', async () => {
    const result = await unifiedSync({ configPath, dryRun: true });
    const validateStep = result.steps.find(s => s.name === 'validate');
    assert.equal(validateStep.data.requiresReopen, false, 'dry-run must not require reopen');
  });
});

// ── REQ-2: Idempotency ────────────────────────────────────────────────────────

describe('unifiedSync — idempotency (REQ-2)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('running twice produces the same opencode.json content', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');

    await unifiedSync({ configPath, targetPath });
    const firstContent = fs.readFileSync(targetPath, 'utf8');

    await unifiedSync({ configPath, targetPath });
    const secondContent = fs.readFileSync(targetPath, 'utf8');

    // Same JSON structure (generated_at may differ in manifest but opencode.json should be stable)
    const first = JSON.parse(firstContent);
    const second = JSON.parse(secondContent);

    // Agent entries should be identical (structure, not warnings)
    assert.deepEqual(
      Object.keys(first.agent ?? {}).sort(),
      Object.keys(second.agent ?? {}).sort(),
      'agent keys must be identical after second run'
    );
  });

  test('second run status is still ok (not failed)', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');

    const first = await unifiedSync({ configPath, targetPath });
    assert.ok(['ok', 'partial'].includes(first.status), 'first run must succeed');

    const second = await unifiedSync({ configPath, targetPath });
    assert.ok(['ok', 'partial'].includes(second.status), 'second run must also succeed');
  });

  test('second run with no changes reports noop (REQ-2)', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    await unifiedSync({ configPath, targetPath });

    const second = await unifiedSync({ configPath, targetPath });
    // noop must be true when nothing changed
    assert.equal(second.noop, true, 'second identical run must report noop = true');
  });

  test('first run is not noop (new file creation is a real change) (REQ-2)', async () => {
    const targetPath = path.join(tmpDir, 'opencode.json');
    const first = await unifiedSync({ configPath, targetPath });
    // First run creates new agents → not noop
    assert.equal(first.noop, false, 'first run creating new agents must not be noop');
  });
});

// ── REQ-6/REQ-7: Auto-wiring integration ─────────────────────────────────────

describe('unifiedSync — auto-wiring: catalog create triggers sync (REQ-6)', () => {
  test('calling unifiedSync after createCatalog produces opencode.json', async () => {
    // Simulate the auto-wiring flow: create catalog + run unifiedSync
    const { tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      withPresets: true,
    });

    try {
      const targetPath = path.join(tmpDir, 'opencode.json');
      const result = await unifiedSync({ configPath, targetPath });

      assert.ok(['ok', 'partial'].includes(result.status), 'auto-wiring sync must succeed');
      assert.ok(fs.existsSync(targetPath), 'opencode.json must exist after auto-wiring');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('unifiedSync — auto-wiring: enable/disable produces updated overlay', () => {
  test('enabling a catalog with presets adds gsr-* agents to opencode.json', async () => {
    // Start with catalog disabled
    const { tmpDir, configPath } = makeTempRouterDir({
      withCatalogs: true,
      catalogEnabled: false,
      withPresets: true,
    });

    const targetPath = path.join(tmpDir, 'opencode.json');

    try {
      // Run sync with disabled catalog — should have 0 gsr agents
      const disabledResult = await unifiedSync({ configPath, targetPath });
      const disabledApplyStep = disabledResult.steps.find(s => s.name === 'apply');
      const disabledGsrCount = disabledApplyStep?.data?.gsrCount ?? 0;

      // Now update config to enable the catalog
      const enabledConfig = fs.readFileSync(configPath, 'utf8')
        .replace('enabled: false', 'enabled: true');
      fs.writeFileSync(configPath, enabledConfig, 'utf8');

      // Run sync again — should now have 1 gsr agent
      const enabledResult = await unifiedSync({ configPath, targetPath });
      const enabledApplyStep = enabledResult.steps.find(s => s.name === 'apply');
      const enabledGsrCount = enabledApplyStep?.data?.gsrCount ?? 0;

      assert.equal(disabledGsrCount, 0, 'disabled catalog must produce 0 gsr agents');
      assert.equal(enabledGsrCount, 1, 'enabled catalog must produce 1 gsr agent');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── ensurePluginDeps ──────────────────────────────────────────────────────────

const EXPECTED_DEPS = [
  '@opencode-ai/plugin',
  '@opentui/core',
  '@opentui/solid',
  'solid-js',
];

describe('ensurePluginDeps — creates package.json when missing', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-epd-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates package.json with all 4 peer deps when file does not exist', () => {
    const { changed, pkgPath } = ensurePluginDeps(tmpDir);

    assert.equal(changed, true, 'changed must be true when file was created');
    assert.ok(fs.existsSync(pkgPath), 'package.json must be created');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const dep of EXPECTED_DEPS) {
      assert.ok(pkg.dependencies[dep], `${dep} must be present in dependencies`);
    }
  });

  test('all 4 peer deps are declared', () => {
    ensurePluginDeps(tmpDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
    assert.equal(EXPECTED_DEPS.length, 4, 'must have exactly 4 expected peer deps');
    for (const dep of EXPECTED_DEPS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(pkg.dependencies, dep),
        `dependency "${dep}" must be declared`
      );
    }
  });

  test('pkgPath points inside the configDir passed', () => {
    const { pkgPath } = ensurePluginDeps(tmpDir);
    assert.ok(pkgPath.startsWith(tmpDir), 'pkgPath must be inside configDir');
    assert.ok(pkgPath.endsWith('package.json'), 'pkgPath must end with package.json');
  });
});

describe('ensurePluginDeps — merges into existing package.json', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-epd-merge-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does not overwrite user-defined deps already in package.json', () => {
    const existing = {
      name: 'my-opencode-config',
      dependencies: {
        'solid-js': '1.8.0',       // user-pinned version
        'some-user-package': '^2.0.0',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(existing, null, 2) + '\n',
      'utf8'
    );

    ensurePluginDeps(tmpDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));

    // User-pinned version must be preserved
    assert.equal(pkg.dependencies['solid-js'], '1.8.0', 'user-pinned solid-js must not be overwritten');
    // User extra dep must be preserved
    assert.ok(pkg.dependencies['some-user-package'], 'user package must be preserved');
    // Missing gsr deps must be added
    assert.ok(pkg.dependencies['@opencode-ai/plugin'], '@opencode-ai/plugin must be added');
    assert.ok(pkg.dependencies['@opentui/core'], '@opentui/core must be added');
    assert.ok(pkg.dependencies['@opentui/solid'], '@opentui/solid must be added');
  });

  test('changed is true when some deps were missing', () => {
    const existing = {
      dependencies: { 'solid-js': '*' },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(existing, null, 2) + '\n',
      'utf8'
    );

    const { changed } = ensurePluginDeps(tmpDir);
    assert.equal(changed, true, 'changed must be true when deps were added');
  });

  test('preserves non-dependencies fields in package.json', () => {
    const existing = {
      name: 'opencode-cfg',
      version: '0.1.0',
      private: true,
      dependencies: {},
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(existing, null, 2) + '\n',
      'utf8'
    );

    ensurePluginDeps(tmpDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));

    assert.equal(pkg.name, 'opencode-cfg', 'name must be preserved');
    assert.equal(pkg.version, '0.1.0', 'version must be preserved');
    assert.equal(pkg.private, true, 'private must be preserved');
  });
});

describe('ensurePluginDeps — idempotency', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-epd-idem-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('running twice produces same package.json content', () => {
    ensurePluginDeps(tmpDir);
    const first = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');

    ensurePluginDeps(tmpDir);
    const second = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');

    assert.equal(first, second, 'package.json must be identical after second run');
  });

  test('changed is false on second run (no new deps to add)', () => {
    ensurePluginDeps(tmpDir); // first run creates the file

    const { changed } = ensurePluginDeps(tmpDir); // second run
    assert.equal(changed, false, 'changed must be false when all deps already present');
  });

  test('running 3 times is stable', () => {
    ensurePluginDeps(tmpDir);
    ensurePluginDeps(tmpDir);
    const { changed } = ensurePluginDeps(tmpDir);

    assert.equal(changed, false, 'third run must also report changed = false');
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
    for (const dep of EXPECTED_DEPS) {
      assert.ok(pkg.dependencies[dep], `${dep} must still be present after 3 runs`);
    }
  });
});

// ── deployGsrPluginStep integration: package.json is written ─────────────────

describe('unifiedSync — tui-plugin step writes package.json', () => {
  let tmpDir;
  let configPath;
  let pluginsDir;
  let opencodeConfigDir;

  beforeEach(() => {
    ({ tmpDir, configPath } = makeTempRouterDir());
    opencodeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-oc-cfg-'));
    pluginsDir = path.join(opencodeConfigDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(opencodeConfigDir, { recursive: true, force: true });
  });

  test('tui-plugin step creates package.json with all 4 peer deps', async () => {
    const result = await unifiedSync({
      configPath,
      pluginsDir,
      opencodeConfigDir,
    });

    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(tuiStep.status, 'ok', 'tui-plugin step must succeed');

    const pkgPath = path.join(opencodeConfigDir, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must be created in opencodeConfigDir');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const dep of EXPECTED_DEPS) {
      assert.ok(pkg.dependencies[dep], `${dep} must be in package.json after tui-plugin step`);
    }
  });

  test('tui-plugin step includes installNote when package.json was updated', async () => {
    const result = await unifiedSync({
      configPath,
      pluginsDir,
      opencodeConfigDir,
    });

    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    // On first run deps are always added, so installNote must be present
    assert.ok(
      tuiStep.data.installNote,
      'installNote must be set when package.json was modified'
    );
    assert.ok(
      tuiStep.data.installNote.includes('bun install'),
      'installNote must mention bun install'
    );
  });

  test('tui-plugin step does not set installNote on second identical run', async () => {
    // First run — populates package.json
    await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });

    // Second run — no changes expected
    const result = await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });
    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(
      tuiStep.data.installNote,
      undefined,
      'installNote must NOT be set when package.json already has all deps'
    );
  });
});
