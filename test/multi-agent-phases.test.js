import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CANONICAL_PHASES, PHASE_METADATA } from '../src/core/phases.js';
import { findContractsDir, readContracts, generateSyncManifest } from '../src/core/sync.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('CANONICAL_PHASES', () => {
  test('has 10 phases', () => {
    assert.equal(CANONICAL_PHASES.length, 10);
  });

  test('includes propose and debug', () => {
    assert.ok(CANONICAL_PHASES.includes('propose'));
    assert.ok(CANONICAL_PHASES.includes('debug'));
  });

  test('propose comes after explore', () => {
    const exploreIdx = CANONICAL_PHASES.indexOf('explore');
    const proposeIdx = CANONICAL_PHASES.indexOf('propose');
    assert.ok(proposeIdx > exploreIdx);
  });

  test('debug comes after verify', () => {
    const verifyIdx = CANONICAL_PHASES.indexOf('verify');
    const debugIdx = CANONICAL_PHASES.indexOf('debug');
    assert.ok(debugIdx > verifyIdx);
  });

  test('all phases have metadata', () => {
    for (const phase of CANONICAL_PHASES) {
      assert.ok(PHASE_METADATA[phase], `${phase} should have metadata`);
      assert.ok(PHASE_METADATA[phase].description, `${phase} should have description`);
      assert.ok(Array.isArray(PHASE_METADATA[phase].fixedRoles), `${phase} should have fixedRoles`);
    }
  });

  test('apply and archive are always mono', () => {
    assert.equal(PHASE_METADATA.apply.alwaysMono, true);
    assert.equal(PHASE_METADATA.archive.alwaysMono, true);
  });

  test('debug has trigger on-failure', () => {
    assert.equal(PHASE_METADATA.debug.trigger, 'on-failure');
    assert.equal(PHASE_METADATA.debug.depends_on, 'verify');
  });
});

describe('contracts', () => {
  test('contracts directory exists', () => {
    const dir = findContractsDir();
    assert.ok(dir, 'Contracts dir should be found');
    assert.ok(existsSync(dir));
  });

  test('all 9 role contracts exist', () => {
    const dir = findContractsDir();
    const rolesDir = join(dir, 'roles');
    assert.ok(existsSync(rolesDir));
    const expectedRoles = ['agent', 'judge', 'radar', 'tester', 'risk-detector', 'security-auditor', 'investigator', 'judge-debate-protocol', 'radar-context-protocol'];
    for (const role of expectedRoles) {
      assert.ok(existsSync(join(rolesDir, `${role}.md`)), `${role}.md should exist`);
    }
  });

  test('all 10 phase contracts exist', () => {
    const dir = findContractsDir();
    const phasesDir = join(dir, 'phases');
    assert.ok(existsSync(phasesDir));
    for (const phase of CANONICAL_PHASES) {
      assert.ok(existsSync(join(phasesDir, `${phase}.md`)), `${phase}.md should exist`);
    }
  });

  test('readContracts returns all contracts', () => {
    const dir = findContractsDir();
    const contracts = readContracts(dir);
    assert.ok(contracts.length >= 19, `Should have at least 19 contracts, got ${contracts.length}`);

    const roles = contracts.filter(c => c.type === 'role');
    const phases = contracts.filter(c => c.type === 'phase');
    assert.equal(roles.length, 9);
    assert.equal(phases.length, 10);
  });

  test('each contract has required fields', () => {
    const dir = findContractsDir();
    const contracts = readContracts(dir);
    for (const c of contracts) {
      assert.ok(c.name, `Contract should have name`);
      assert.ok(c.topicKey, `Contract should have topicKey`);
      assert.ok(c.content.length > 50, `Contract ${c.name} should have substantial content`);
      assert.ok(c.checksum, `Contract ${c.name} should have checksum`);
    }
  });

  test('generateSyncManifest creates manifest file', () => {
    const dir = findContractsDir();
    const result = generateSyncManifest(dir);
    assert.ok(result.manifest);
    assert.equal(result.manifest.version, 1);
    assert.ok(result.manifest.contracts.length >= 19);
    assert.ok(existsSync(result.manifestPath));
  });
});

describe('profile fixes', () => {
  test('multiagent verify has a primary lane', async () => {
    const { loadRouterConfig } = await import('../src/adapters/opencode/index.js');
    const config = loadRouterConfig();
    const preset = config.catalogs?.default?.presets?.multiagent;
    assert.ok(preset, 'multiagent preset should exist');
    const verifyPhase = preset.phases?.verify;
    assert.ok(verifyPhase, 'verify phase should exist');
    // Phase 7: simplified schema {model, fallbacks} OR lane array format
    if (Array.isArray(verifyPhase)) {
      const hasPrimary = verifyPhase.some(l => l.role === 'primary');
      assert.ok(hasPrimary, 'verify should have a primary lane');
    } else {
      // Simplified schema — model field acts as primary
      assert.ok(verifyPhase.model, 'verify simplified schema should have model');
    }
  });

  test('cheap verify has correct role', async () => {
    const { loadRouterConfig } = await import('../src/adapters/opencode/index.js');
    const config = loadRouterConfig();
    const preset = config.catalogs?.default?.presets?.cheap;
    assert.ok(preset, 'cheap preset should exist');
    const verifyPhase = preset.phases?.verify;
    assert.ok(verifyPhase, 'verify phase should exist');
    // Phase 7: simplified schema {model, fallbacks} OR lane array format
    if (Array.isArray(verifyPhase)) {
      // Should NOT have a lone judge without primary
      if (verifyPhase.length === 1) {
        assert.equal(verifyPhase[0].role, 'primary', 'Single lane should be primary, not judge');
      }
    } else {
      // Simplified schema — model field acts as primary
      assert.ok(verifyPhase.model, 'verify simplified schema should have model');
    }
  });
});
