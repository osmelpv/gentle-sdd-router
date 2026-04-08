import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, after } from 'node:test';
import { toggleProfileVisibility, setProfileVisibility } from '../src/core/profile-io.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-vis-test-'));
}

function writeProfile(routerDir, name, content) {
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });
  const filePath = path.join(profilesDir, `${name}.router.yaml`);
  // Build minimal YAML manually (no dep on stringifyYaml so the test stays standalone)
  const lines = [`name: ${name}`];
  if (content.visible !== undefined) lines.push(`visible: ${content.visible}`);
  if (content.phases) {
    lines.push('phases:');
    for (const [k, v] of Object.entries(content.phases)) {
      lines.push(`  ${k}:`);
      if (v.model) lines.push(`    model: ${v.model}`);
    }
  }
  if (content.sdd) lines.push(`sdd: ${content.sdd}`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
}

function readProfileRaw(routerDir, name) {
  const filePath = path.join(routerDir, 'profiles', `${name}.router.yaml`);
  return fs.readFileSync(filePath, 'utf8');
}

// ─── static analysis ─────────────────────────────────────────────────────────

describe('TUI preset visibility flow', () => {
  test('presets list does not update parent state during render', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profiles-list.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.equal(
      source.includes('useState(() => {'),
      false,
      'profiles-list.js should use effects, not useState initializers, for render-adjacent updates'
    );
  });

  test('presets list reloads config after toggling visibility', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profiles-list.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(
      source.includes('mod.loadRouterConfig(configPath)'),
      'profiles-list.js must reload the exact current configPath after toggling visibility'
    );
  });

  test('profile detail uses router-config module consistently', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profile-detail.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.equal(
      source.includes('router-localConfig.js'),
      false,
      'profile-detail.js must not reference the non-existent router-localConfig.js module'
    );
    assert.ok(
      source.includes('router-config.js'),
      'profile-detail.js should use router-config.js for config operations'
    );
  });

  test('profiles-list uses toggleProfileVisibility (not setPresetMetadata) for toggle', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profiles-list.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(
      source.includes('toggleProfileVisibility'),
      'profiles-list.js handleToggleVisibility must call toggleProfileVisibility'
    );
    assert.equal(
      source.includes('setPresetMetadata'),
      false,
      'profiles-list.js must not use setPresetMetadata (v3-only) for toggle'
    );
  });

  test('profile-detail uses toggleProfileVisibility (not setPresetMetadata) for toggle', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profile-detail.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(
      source.includes('toggleProfileVisibility'),
      'profile-detail.js toggle-visibility must call toggleProfileVisibility'
    );
    assert.equal(
      source.includes('setPresetMetadata'),
      false,
      'profile-detail.js must not use setPresetMetadata (v3-only) for toggle'
    );
  });
});

// ─── toggleProfileVisibility unit tests ─────────────────────────────────────

describe('toggleProfileVisibility', () => {
  const dirs = [];
  after(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('toggles visible:true → visible:false', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'my-profile', { visible: true, sdd: 'agent-orchestrator' });

    const result = toggleProfileVisibility('my-profile', routerDir);

    assert.equal(result.visible, false, 'should return visible:false');
    const raw = readProfileRaw(routerDir, 'my-profile');
    assert.ok(raw.includes('visible: false'), 'YAML file must contain visible: false');
  });

  test('toggles visible:false → visible:true', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'my-profile', { visible: false, sdd: 'agent-orchestrator' });

    const result = toggleProfileVisibility('my-profile', routerDir);

    assert.equal(result.visible, true, 'should return visible:true');
    const raw = readProfileRaw(routerDir, 'my-profile');
    assert.ok(raw.includes('visible: true'), 'YAML file must contain visible: true');
  });

  test('sets visible:true when field is missing', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'my-profile', { sdd: 'agent-orchestrator' }); // no visible field

    const result = toggleProfileVisibility('my-profile', routerDir);

    assert.equal(result.visible, true, 'missing visible should be treated as false → toggles to true');
    const raw = readProfileRaw(routerDir, 'my-profile');
    assert.ok(raw.includes('visible: true'), 'YAML file must contain visible: true');
  });

  test('throws when profile file does not exist', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });

    assert.throws(
      () => toggleProfileVisibility('nonexistent', routerDir),
      /Profile file not found/,
      'should throw with "Profile file not found" message'
    );
  });

  test('preserves other fields (phases, sdd, name) after toggle', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'rich-profile', {
      visible: true,
      sdd: 'agent-orchestrator',
      phases: { orchestrator: { model: 'anthropic/claude-sonnet' } },
    });

    toggleProfileVisibility('rich-profile', routerDir);

    const raw = readProfileRaw(routerDir, 'rich-profile');
    assert.ok(raw.includes('name: rich-profile'), 'name field must be preserved');
    assert.ok(raw.includes('sdd: agent-orchestrator'), 'sdd field must be preserved');
    assert.ok(raw.includes('orchestrator:'), 'phases must be preserved');
    assert.ok(raw.includes('model: anthropic/claude-sonnet'), 'model inside phases must be preserved');
  });
});

// ─── setProfileVisibility unit tests ─────────────────────────────────────────

describe('setProfileVisibility', () => {
  const dirs = [];
  after(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('sets explicit visible:true', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'my-profile', { visible: false });

    const result = setProfileVisibility('my-profile', true, routerDir);

    assert.equal(result.visible, true);
    const raw = readProfileRaw(routerDir, 'my-profile');
    assert.ok(raw.includes('visible: true'));
  });

  test('sets explicit visible:false', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    writeProfile(routerDir, 'my-profile', { visible: true });

    const result = setProfileVisibility('my-profile', false, routerDir);

    assert.equal(result.visible, false);
    const raw = readProfileRaw(routerDir, 'my-profile');
    assert.ok(raw.includes('visible: false'));
  });

  test('throws when profile file does not exist', () => {
    const routerDir = makeTmpDir();
    dirs.push(routerDir);
    fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });

    assert.throws(
      () => setProfileVisibility('ghost', true, routerDir),
      /Profile file not found/
    );
  });
});
