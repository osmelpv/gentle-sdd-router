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
  let pluginsDir;

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
    pluginsDir = path.join(opencodeConfigDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(opencodeConfigDir, { recursive: true, force: true });
  });

  test('tui-plugin step creates tui.json with plugin entry on first run', async () => {
    const result = await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });

    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(tuiStep.status, 'ok', 'tui-plugin step must succeed');
    assert.equal(tuiStep.data.tuiJsonUpdated, true, 'tuiJsonUpdated must be true on first run');

    const tuiJsonPath = path.join(opencodeConfigDir, 'tui.json');
    assert.ok(fs.existsSync(tuiJsonPath), 'tui.json must be created');

    const cfg = JSON.parse(fs.readFileSync(tuiJsonPath, 'utf8'));
    assert.ok(Array.isArray(cfg.plugin), 'cfg.plugin must be an array');
    assert.equal(cfg.plugin.length, 1, 'plugin array must have one entry');
    // The registered path must end with gsr-plugin.tsx
    assert.ok(cfg.plugin[0][0].endsWith('gsr-plugin.tsx'), 'plugin path must end with gsr-plugin.tsx');
    assert.deepEqual(cfg.plugin[0][1], { enabled: true }, 'plugin must have enabled:true');
  });

  test('tui-plugin step reports tuiJsonUpdated=false on second identical run', async () => {
    await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });

    const result = await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });
    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.equal(tuiStep.data.tuiJsonUpdated, false, 'tuiJsonUpdated must be false on second run (no-op)');

    const cfg = JSON.parse(fs.readFileSync(path.join(opencodeConfigDir, 'tui.json'), 'utf8'));
    assert.equal(cfg.plugin.length, 1, 'plugin array must still have exactly one entry after second run');
  });

  test('tui-plugin step result always has tuiJsonUpdated boolean field', async () => {
    const result = await unifiedSync({ configPath, pluginsDir, opencodeConfigDir });
    const tuiStep = result.steps.find(s => s.name === 'tui-plugin');
    assert.ok(tuiStep, 'tui-plugin step must exist');
    assert.equal(typeof tuiStep.data.tuiJsonUpdated, 'boolean', 'tuiJsonUpdated must be a boolean');
  });
});
