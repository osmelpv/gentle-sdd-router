import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateProfile, createProfile } from '../src/router-config.js';
import { parseYaml } from '../src/core/router.js';

function makeTempRouter() {
  const dir = mkdtempSync(join(tmpdir(), 'gsr-update-'));
  const routerDir = join(dir, 'router');
  mkdirSync(join(routerDir, 'profiles'), { recursive: true });
  return { dir, routerDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('updateProfile', () => {
  test('updates phases of an existing profile', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      createProfile('test-profile', routerDir);

      const newPhases = {
        orchestrator: [{ target: 'openai/gpt-5', role: 'primary', kind: 'lane', phase: 'orchestrator' }],
        explore: [{ target: 'google/gemini-pro', role: 'primary', kind: 'lane', phase: 'explore' }],
      };

      const result = updateProfile('test-profile', newPhases, routerDir);
      assert.equal(result.presetName, 'test-profile');

      const raw = readFileSync(result.path, 'utf8');
      const parsed = parseYaml(raw);
      assert.equal(parsed.name, 'test-profile');
      assert.equal(parsed.phases.orchestrator[0].target, 'openai/gpt-5');
      assert.equal(parsed.phases.explore[0].target, 'google/gemini-pro');
    } finally {
      cleanup();
    }
  });

  test('preserves non-phase metadata', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      // Create a profile with extra metadata
      const profilePath = join(routerDir, 'profiles', 'meta-test.router.yaml');
      const content = [
        'name: meta-test',
        'availability: experimental',
        'complexity: high',
        'hidden: true',
        'phases:',
        '  orchestrator:',
        '    - target: anthropic/claude-sonnet',
        '      role: primary',
        '      phase: orchestrator',
      ].join('\n');
      writeFileSync(profilePath, content, 'utf8');

      const newPhases = {
        orchestrator: [{ target: 'openai/gpt-5', role: 'primary', kind: 'lane', phase: 'orchestrator' }],
      };

      updateProfile('meta-test', newPhases, routerDir);

      const raw = readFileSync(profilePath, 'utf8');
      const parsed = parseYaml(raw);
      assert.equal(parsed.availability, 'experimental');
      assert.equal(parsed.complexity, 'high');
      assert.equal(parsed.hidden, true);
      assert.equal(parsed.phases.orchestrator[0].target, 'openai/gpt-5');
    } finally {
      cleanup();
    }
  });

  test('rejects invalid phases (empty object)', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      createProfile('invalid-test', routerDir);
      assert.throws(() => updateProfile('invalid-test', {}, routerDir), /phases/i);
    } finally {
      cleanup();
    }
  });

  test('throws if profile not found', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      assert.throws(
        () => updateProfile('nonexistent', { orchestrator: [{ target: 'test/m', role: 'primary', phase: 'orchestrator' }] }, routerDir),
        /not found/i,
      );
    } finally {
      cleanup();
    }
  });

  test('throws if name is empty', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      assert.throws(() => updateProfile('', {}, routerDir), /name/i);
    } finally {
      cleanup();
    }
  });

  test('does not corrupt file on validation failure', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      createProfile('safe-test', routerDir);
      const originalRaw = readFileSync(join(routerDir, 'profiles', 'safe-test.router.yaml'), 'utf8');

      // phases with empty object should fail validation
      try {
        updateProfile('safe-test', {}, routerDir);
      } catch { /* expected */ }

      const afterRaw = readFileSync(join(routerDir, 'profiles', 'safe-test.router.yaml'), 'utf8');
      assert.equal(afterRaw, originalRaw, 'File should be unchanged after failed validation');
    } finally {
      cleanup();
    }
  });

  test('supports multi-lane phases', () => {
    const { routerDir, cleanup } = makeTempRouter();
    try {
      createProfile('multi-lane', routerDir);

      const newPhases = {
        orchestrator: [
          { target: 'anthropic/claude-opus', role: 'primary', kind: 'lane', phase: 'orchestrator' },
          { target: 'openai/gpt-5', role: 'judge', kind: 'lane', phase: 'orchestrator' },
          { target: 'google/gemini-pro', role: 'radar', kind: 'lane', phase: 'orchestrator' },
        ],
        verify: [
          { target: 'openai/gpt-5', role: 'judge', kind: 'lane', phase: 'verify' },
        ],
      };

      const result = updateProfile('multi-lane', newPhases, routerDir);
      const raw = readFileSync(result.path, 'utf8');
      const parsed = parseYaml(raw);

      assert.equal(parsed.phases.orchestrator.length, 3);
      assert.equal(parsed.phases.orchestrator[0].role, 'primary');
      assert.equal(parsed.phases.orchestrator[1].role, 'judge');
      assert.equal(parsed.phases.orchestrator[2].role, 'radar');
      assert.equal(parsed.phases.verify[0].role, 'judge');
    } finally {
      cleanup();
    }
  });
});
