/**
 * Tests for ensureTuiJsonPlugin() and its integration with deployGsrPluginStep
 * via unifiedSync's tui-plugin step.
 *
 * Covers:
 *   - creates plugin entry when tui.json has no plugin array
 *   - idempotent: running twice doesn't add duplicate
 *   - merges without removing other plugin entries
 *   - tuiJsonUpdated flag in tui-plugin step result
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { ensureTuiJsonPlugin, unifiedSync } from '../src/core/unified-sync.js';

// ── ensureTuiJsonPlugin unit tests ───────────────────────────────────────────

describe('ensureTuiJsonPlugin — creates plugin entry when tui.json has no plugin array', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tuijson-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates tui.json with plugin array when file does not exist', () => {
    const pluginPath = '/fake/path/gsr-plugin.tsx';
    const changed = ensureTuiJsonPlugin(tmpDir, pluginPath);

    assert.equal(changed, true, 'must return true (changed) on first run');
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    assert.ok(fs.existsSync(tuiJsonPath), 'tui.json must be created');

    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
    assert.ok(Array.isArray(cfg.plugin), 'cfg.plugin must be an array');
    assert.equal(cfg.plugin.length, 1, 'plugin array must have one entry');
    assert.deepEqual(cfg.plugin[0], [pluginPath, { enabled: true }]);
  });

  test('creates tui.json with plugin entry when file exists but has no plugin field', () => {
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    fs.writeFileSync(tuiJsonPath, JSON.stringify({ theme: 'dark' }, null, 2) + '\n', 'utf8');

    const pluginPath = '/fake/path/gsr-plugin.tsx';
    const changed = ensureTuiJsonPlugin(tmpDir, pluginPath);

    assert.equal(changed, true, 'must return true (changed)');
    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));

    // Other fields must be preserved
    assert.equal(cfg.theme, 'dark', 'existing fields must be preserved');
    assert.ok(Array.isArray(cfg.plugin), 'cfg.plugin must be an array');
    assert.equal(cfg.plugin.length, 1, 'plugin array must have one entry');
    assert.deepEqual(cfg.plugin[0], [pluginPath, { enabled: true }]);
  });

  test('creates tui.json with plugin entry when plugin field is not an array', () => {
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    // Malformed: plugin is a string, not an array
    fs.writeFileSync(tuiJsonPath, JSON.stringify({ plugin: 'bad-value' }, null, 2) + '\n', 'utf8');

    const pluginPath = '/fake/path/gsr-plugin.tsx';
    const changed = ensureTuiJsonPlugin(tmpDir, pluginPath);

    assert.equal(changed, true, 'must return true (changed)');
    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
    assert.ok(Array.isArray(cfg.plugin), 'cfg.plugin must be converted to an array');
    assert.equal(cfg.plugin.length, 1, 'plugin array must have one entry');
  });
});

// ── ensureTuiJsonPlugin — idempotency ────────────────────────────────────────

describe('ensureTuiJsonPlugin — idempotent: running twice does not add duplicate', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tuijson-idem-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('second call returns false (no-op) and does not duplicate entry', () => {
    const pluginPath = '/fake/path/gsr-plugin.tsx';

    const firstChanged = ensureTuiJsonPlugin(tmpDir, pluginPath);
    assert.equal(firstChanged, true, 'first call must return true (changed)');

    const secondChanged = ensureTuiJsonPlugin(tmpDir, pluginPath);
    assert.equal(secondChanged, false, 'second call must return false (no-op)');

    const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tui.json'), 'utf8'));
    assert.equal(cfg.plugin.length, 1, 'plugin array must still have exactly one entry');
  });

  test('running three times is stable', () => {
    const pluginPath = '/fake/path/gsr-plugin.tsx';
    ensureTuiJsonPlugin(tmpDir, pluginPath);
    ensureTuiJsonPlugin(tmpDir, pluginPath);
    const changed = ensureTuiJsonPlugin(tmpDir, pluginPath);

    assert.equal(changed, false, 'third call must return false (no-op)');
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tui.json'), 'utf8'));
    assert.equal(cfg.plugin.length, 1, 'plugin array must still have exactly one entry after 3 runs');
  });

  test('tui.json content is identical after first and second call', () => {
    const pluginPath = '/fake/path/gsr-plugin.tsx';
    ensureTuiJsonPlugin(tmpDir, pluginPath);
    const firstContent = fs.readFileSync(path.join(tmpDir, 'tui.json'), 'utf8');

    ensureTuiJsonPlugin(tmpDir, pluginPath);
    const secondContent = fs.readFileSync(path.join(tmpDir, 'tui.json'), 'utf8');

    assert.equal(firstContent, secondContent, 'tui.json must not change on second run');
  });
});

// ── ensureTuiJsonPlugin — merges without removing other entries ───────────────

describe('ensureTuiJsonPlugin — merges without removing other plugin entries', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tuijson-merge-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('preserves existing plugin entries when adding gsr plugin', () => {
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    const existingPlugin = ['/some/other/plugin.tsx', { enabled: true }];
    fs.writeFileSync(
      tuiJsonPath,
      JSON.stringify({ plugin: [existingPlugin] }, null, 2) + '\n',
      'utf8'
    );

    const gsrPluginPath = '/fake/path/gsr-plugin.tsx';
    const changed = ensureTuiJsonPlugin(tmpDir, gsrPluginPath);

    assert.equal(changed, true, 'must return true (changed)');
    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));

    assert.equal(cfg.plugin.length, 2, 'must have 2 plugin entries');
    // Original entry preserved
    assert.deepEqual(cfg.plugin[0], existingPlugin, 'existing plugin entry must be preserved');
    // New entry added
    assert.deepEqual(cfg.plugin[1], [gsrPluginPath, { enabled: true }], 'gsr plugin entry must be added');
  });

  test('does not register gsr plugin twice even when other plugins are present', () => {
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    const existingPlugin = ['/some/other/plugin.tsx', { enabled: true }];
    const gsrPluginPath = '/fake/path/gsr-plugin.tsx';

    // Pre-populate with other plugin + gsr already registered
    fs.writeFileSync(
      tuiJsonPath,
      JSON.stringify({
        plugin: [existingPlugin, [gsrPluginPath, { enabled: true }]],
      }, null, 2) + '\n',
      'utf8'
    );

    const changed = ensureTuiJsonPlugin(tmpDir, gsrPluginPath);

    assert.equal(changed, false, 'must return false (already registered)');
    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
    assert.equal(cfg.plugin.length, 2, 'plugin array length must not change');
  });

  test('preserves non-plugin fields in tui.json', () => {
    const tuiJsonPath = path.join(tmpDir, 'tui.json');
    fs.writeFileSync(
      tuiJsonPath,
      JSON.stringify({ theme: 'monokai', fontSize: 14, plugin: [] }, null, 2) + '\n',
      'utf8'
    );

    ensureTuiJsonPlugin(tmpDir, '/fake/path/gsr-plugin.tsx');
    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));

    assert.equal(cfg.theme, 'monokai', 'theme must be preserved');
    assert.equal(cfg.fontSize, 14, 'fontSize must be preserved');
  });
});

// ── Integration: tui-plugin step via unifiedSync ──────────────────────────────

describe('unifiedSync — tui-plugin step registers plugin in tui.json', () => {
  let tmpDir;
  let configPath;
  let opencodeConfigDir;
  let projectDir;

  beforeEach(() => {
    // Minimal router dir
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tuijson-int-'));
    const routerDir = path.join(tmpDir, 'router');
    const contractsDir = path.join(routerDir, 'contracts');
    fs.mkdirSync(path.join(contractsDir, 'roles'), { recursive: true });
    fs.mkdirSync(path.join(contractsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(contractsDir, 'roles', 'primary.md'), '# Role: Primary\n', 'utf8');
    fs.writeFileSync(path.join(contractsDir, 'phases', 'orchestrator.md'), '# Phase: Orchestrator\n', 'utf8');
    fs.writeFileSync(path.join(routerDir, 'router.yaml'), 'version: 3\nactive_catalog: default\n', 'utf8');
    configPath = path.join(routerDir, 'router.yaml');

    // Isolated opencode config dir
    opencodeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tuijson-oc-'));
    // projectDir is the tmpDir (simulates the gsr project root)
    projectDir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(opencodeConfigDir, { recursive: true, force: true });
  });

  test('tui-plugin step creates tui.json with plugin entry on first run', async () => {
    const result = await unifiedSync({ configPath, projectDir, opencodeConfigDir });

    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(tuiStep.status, 'ok', 'tui-plugin step must succeed');
    assert.equal(tuiStep.data.registered, true, 'registered must be true on first run');

    const tuiJsonPath = path.join(opencodeConfigDir, 'tui.json');
    assert.ok(fs.existsSync(tuiJsonPath), 'tui.json must be created');

    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
    assert.ok(Array.isArray(cfg.plugin), 'cfg.plugin must be an array');
    assert.equal(cfg.plugin.length, 1, 'plugin array must have one entry');
    // The registered path is the project directory (where tui.tsx lives)
    assert.equal(cfg.plugin[0][0], projectDir, 'plugin path must be the project directory');
    assert.deepEqual(cfg.plugin[0][1], { enabled: true }, 'plugin must have enabled:true');
  });

  test('tui-plugin step reports registered=false on second identical run', async () => {
    await unifiedSync({ configPath, projectDir, opencodeConfigDir });

    const result = await unifiedSync({ configPath, projectDir, opencodeConfigDir });
    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.equal(tuiStep.data.registered, false, 'registered must be false on second run (no-op)');

    const cfg = JSON.parse(fs.readFileSync(path.join(opencodeConfigDir, 'tui.json'), 'utf8'));
    assert.equal(cfg.plugin.length, 1, 'plugin array must still have exactly one entry after second run');
  });

  test('tui-plugin step result always has registered boolean field', async () => {
    const result = await unifiedSync({ configPath, projectDir, opencodeConfigDir });
    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(typeof tuiStep.data.registered, 'boolean', 'registered must be a boolean');
  });
});

// ── Regression: /tmp dirs must NEVER pollute the global tui.json ─────────────
// Root cause of the Bun 1.3.11 segfault (920 /tmp plugin entries in tui.json).

describe('REGRESSION — temp project dirs must not contaminate global tui.json', () => {
  let globalTuiJsonPath;
  let globalTuiJsonBackup;

  beforeEach(() => {
    globalTuiJsonPath = path.join(os.homedir(), '.config', 'opencode', 'tui.json');
    try {
      globalTuiJsonBackup = fs.readFileSync(globalTuiJsonPath, 'utf8');
    } catch {
      globalTuiJsonBackup = null;
    }
  });

  afterEach(() => {
    // Restore global tui.json exactly as it was
    if (globalTuiJsonBackup !== null) {
      fs.writeFileSync(globalTuiJsonPath, globalTuiJsonBackup, 'utf8');
    }
  });

  test('unifiedSync with /tmp projectDir does NOT add entry to global tui.json', async () => {
    // Parse global tui.json plugin count BEFORE
    let pluginsBefore = 0;
    try {
      const cfg = JSON.parse(fs.readFileSync(globalTuiJsonPath, 'utf8'));
      pluginsBefore = (cfg.plugin || []).length;
    } catch { /* file may not exist */ }

    // Create a temp project with valid router config
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-tui-regression-'));
    const routerDir = path.join(tmpDir, 'router');
    fs.mkdirSync(routerDir, { recursive: true });
    fs.writeFileSync(
      path.join(routerDir, 'router.yaml'),
      'schema_version: 4\nactive_preset: test\n',
      'utf8',
    );
    // Write a fake tui.tsx so the plugin step has something to register
    fs.writeFileSync(path.join(tmpDir, 'tui.tsx'), '// fake', 'utf8');

    try {
      // Run sync WITHOUT passing opencodeConfigDir — the safety guard must catch /tmp
      await unifiedSync({
        configPath: path.join(routerDir, 'router.yaml'),
        projectDir: tmpDir,
        // NO opencodeConfigDir — tests the safety guard in deployGsrPluginStep
      });

      // Parse global tui.json plugin count AFTER
      let pluginsAfter = 0;
      try {
        const cfg = JSON.parse(fs.readFileSync(globalTuiJsonPath, 'utf8'));
        pluginsAfter = (cfg.plugin || []).length;
      } catch { /* file may not exist */ }

      assert.equal(
        pluginsAfter,
        pluginsBefore,
        `Global tui.json must NOT gain entries from /tmp project (before: ${pluginsBefore}, after: ${pluginsAfter})`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
