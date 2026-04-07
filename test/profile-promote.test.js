import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { promoteProfile, demoteProfile } from '../src/core/profile-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-promote-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeProfile(dir, name, content = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.router.yaml`);
  const yaml = [
    `name: ${name}`,
    `sdd: agent-orchestrator`,
    `visible: false`,
    `builtin: ${content.builtin === true ? 'true' : 'false'}`,
    `phases:`,
    `  orchestrator:`,
    `    model: anthropic/claude-sonnet`,
    `    fallbacks: []`,
    ...Object.entries(content).filter(([k]) => !['builtin'].includes(k)).map(([k, v]) => `# extra: ${k}=${v}`),
  ].join('\n') + '\n';
  fs.writeFileSync(filePath, yaml, 'utf8');
  return filePath;
}

// ─── promoteProfile tests ─────────────────────────────────────────────────────

describe('promoteProfile', () => {
  test('moves file from project profiles/ to global dir', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      const projectProfilesDir = path.join(routerDir, 'profiles');
      writeProfile(projectProfilesDir, 'my-profile');

      const result = promoteProfile('my-profile', routerDir, tmpGlobal);

      // File moved to global
      assert.ok(fs.existsSync(result.to), 'File should exist in global dir');
      assert.ok(result.to.startsWith(tmpGlobal), 'to should be under global dir');

      // File removed from project
      assert.ok(!fs.existsSync(result.from), 'File should be removed from project profiles');

      // Return value
      assert.equal(result.profileName, 'my-profile');
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });

  test('throws if profile not found in project', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });

      assert.throws(
        () => promoteProfile('nonexistent', routerDir, tmpGlobal),
        /not found in project profiles/,
      );
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });

  test('throws if profile has builtin: true', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      const projectProfilesDir = path.join(routerDir, 'profiles');
      writeProfile(projectProfilesDir, 'builtin-profile', { builtin: true });

      assert.throws(
        () => promoteProfile('builtin-profile', routerDir, tmpGlobal),
        /Cannot promote builtin profile/,
      );
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });

  test('throws if profile already exists in global dir', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      const projectProfilesDir = path.join(routerDir, 'profiles');
      writeProfile(projectProfilesDir, 'my-profile');
      // Pre-create in global
      writeProfile(tmpGlobal, 'my-profile');

      assert.throws(
        () => promoteProfile('my-profile', routerDir, tmpGlobal),
        /already exists in global profiles/,
      );
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });
});

// ─── demoteProfile tests ──────────────────────────────────────────────────────

describe('demoteProfile', () => {
  test('moves file from global to project profiles/', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });
      writeProfile(tmpGlobal, 'global-profile');

      const result = demoteProfile('global-profile', routerDir, tmpGlobal);

      // File moved to project
      assert.ok(fs.existsSync(result.to), 'File should exist in project profiles');
      assert.ok(result.to.includes(path.join(routerDir, 'profiles')), 'to should be under project profiles');

      // File removed from global
      assert.ok(!fs.existsSync(result.from), 'File should be removed from global dir');

      // Return value
      assert.equal(result.profileName, 'global-profile');
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });

  test('throws if profile not found in global dir', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });

      assert.throws(
        () => demoteProfile('nonexistent', routerDir, tmpGlobal),
        /not found in global profiles/,
      );
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });

  test('throws if profile already exists in project', () => {
    const tmpProject = makeTempDir();
    const tmpGlobal = makeTempDir();
    try {
      const routerDir = path.join(tmpProject, 'router');
      const projectProfilesDir = path.join(routerDir, 'profiles');
      // Profile already in project
      writeProfile(projectProfilesDir, 'my-profile');
      // Also in global
      writeProfile(tmpGlobal, 'my-profile');

      assert.throws(
        () => demoteProfile('my-profile', routerDir, tmpGlobal),
        /already exists in project profiles/,
      );
    } finally {
      cleanup(tmpProject);
      cleanup(tmpGlobal);
    }
  });
});
