/**
 * Tests for dynamic phase metadata resolution (custom SDD catalogs).
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 *
 * Tests verify:
 *   - CANONICAL_PHASES and PHASE_METADATA exports remain unchanged
 *   - loadPhaseMetadataForCatalog returns CANONICAL behavior for default/null
 *   - loadPhaseMetadataForCatalog returns catalog phase map for custom SDDs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { CANONICAL_PHASES, PHASE_METADATA } from '../src/core/phases.js';
import { loadPhaseMetadataForCatalog } from '../src/core/phases.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-phases-dynamic-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// ─── Existing exports remain unchanged ───────────────────────────────────────

describe('CANONICAL_PHASES and PHASE_METADATA are frozen/unchanged', () => {
  test('CANONICAL_PHASES contains all 10 expected phases', () => {
    const expected = [
      'orchestrator', 'explore', 'propose', 'spec',
      'design', 'tasks', 'apply', 'verify', 'debug', 'archive',
    ];
    for (const phase of expected) {
      assert.ok(CANONICAL_PHASES.includes(phase), `Expected ${phase} in CANONICAL_PHASES`);
    }
    assert.equal(CANONICAL_PHASES.length, expected.length);
  });

  test('PHASE_METADATA has an entry for every CANONICAL_PHASE', () => {
    for (const phase of CANONICAL_PHASES) {
      assert.ok(PHASE_METADATA[phase], `PHASE_METADATA missing entry for: ${phase}`);
    }
  });

  test('PHASE_METADATA.apply is alwaysMono=true', () => {
    assert.equal(PHASE_METADATA.apply.alwaysMono, true);
  });

  test('PHASE_METADATA.explore defaultExecution is parallel', () => {
    assert.equal(PHASE_METADATA.explore.defaultExecution, 'parallel');
  });
});

// ─── loadPhaseMetadataForCatalog ─────────────────────────────────────────────

describe('loadPhaseMetadataForCatalog — default/null behavior', () => {
  test('returns canonical phase keys when sddName is null', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const result = loadPhaseMetadataForCatalog(null, catalogsDir);
      for (const phase of CANONICAL_PHASES) {
        assert.ok(result[phase], `Expected canonical phase: ${phase}`);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('returns canonical phase keys when sddName is "default"', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const result = loadPhaseMetadataForCatalog('default', catalogsDir);
      for (const phase of CANONICAL_PHASES) {
        assert.ok(result[phase], `Expected canonical phase: ${phase}`);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('default result has same structure as PHASE_METADATA', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const result = loadPhaseMetadataForCatalog(null, catalogsDir);
      assert.deepEqual(result, PHASE_METADATA);
    } finally {
      cleanup(tmp);
    }
  });
});

describe('loadPhaseMetadataForCatalog — custom SDD', () => {
  const CUSTOM_SDD_YAML = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define high-level game concept"
    execution: parallel
    agents: 2
  narrative:
    intent: "Write the narrative"
    depends_on:
      - concept
  prototype:
    intent: "Build a prototype"
    depends_on:
      - narrative
`;

  test('returns phase map with custom phase names for custom catalog', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', CUSTOM_SDD_YAML);
      const result = loadPhaseMetadataForCatalog('game-design', catalogsDir);
      assert.ok(result.concept, 'Expected concept phase');
      assert.ok(result.narrative, 'Expected narrative phase');
      assert.ok(result.prototype, 'Expected prototype phase');
    } finally {
      cleanup(tmp);
    }
  });

  test('custom phase metadata has intent, execution, agents', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', CUSTOM_SDD_YAML);
      const result = loadPhaseMetadataForCatalog('game-design', catalogsDir);
      assert.equal(result.concept.description, 'Define high-level game concept');
      assert.equal(result.concept.defaultExecution, 'parallel');
      assert.equal(result.concept.agents, 2);
    } finally {
      cleanup(tmp);
    }
  });

  test('custom SDD phases do NOT include canonical phases like orchestrator', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', CUSTOM_SDD_YAML);
      const result = loadPhaseMetadataForCatalog('game-design', catalogsDir);
      assert.equal(result.orchestrator, undefined, 'Custom SDD should not include canonical phases');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws or returns null for non-existent custom SDD', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(
        () => loadPhaseMetadataForCatalog('nonexistent-sdd', catalogsDir),
        /not found|nonexistent/i
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── create-profile-wizard: dynamic phase loading integration ─────────────────

describe('loadPhaseMetadataForCatalog — profile wizard integration', () => {
  const WIZARD_SDD_YAML = `name: wizard-test
version: 1
description: "Wizard phase loading test"
phases:
  concept:
    intent: "Define concept"
    execution: sequential
  prototype:
    intent: "Build prototype"
    execution: parallel
    agents: 2
    depends_on:
      - concept
`;

  test('loadPhaseMetadataForCatalog returns phase list usable for wizard steps (replaces CANONICAL_PHASES)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'wizard-test/sdd.yaml', WIZARD_SDD_YAML);
      const metadata = loadPhaseMetadataForCatalog('wizard-test', catalogsDir);
      // Profile wizard iterates over phase names — verify Object.keys works
      const phaseNames = Object.keys(metadata);
      assert.equal(phaseNames.length, 2, 'Expected 2 phases for wizard-test SDD');
      assert.ok(phaseNames.includes('concept'), 'Expected concept phase');
      assert.ok(phaseNames.includes('prototype'), 'Expected prototype phase');
      // Each phase must have compatible fields for the wizard
      assert.equal(typeof metadata.concept.description, 'string', 'Phase must have description');
      assert.ok('alwaysMono' in metadata.concept, 'Phase must have alwaysMono field');
      assert.ok('fixedRoles' in metadata.concept, 'Phase must have fixedRoles field');
    } finally {
      cleanup(tmp);
    }
  });

  test('loadPhaseMetadataForCatalog for null/default returns CANONICAL_PHASES-compatible keys', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const metadata = loadPhaseMetadataForCatalog(null, catalogsDir);
      // create-profile-wizard uses CANONICAL_PHASES as fallback — these must be present
      assert.ok(metadata.orchestrator, 'Canonical fallback must have orchestrator');
      assert.ok(metadata.apply, 'Canonical fallback must have apply');
      assert.ok(metadata.explore, 'Canonical fallback must have explore');
    } finally {
      cleanup(tmp);
    }
  });

  test('phase names from loadPhaseMetadataForCatalog are usable as wizard phase iteration list', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'wizard-test/sdd.yaml', WIZARD_SDD_YAML);
      const metadata = loadPhaseMetadataForCatalog('wizard-test', catalogsDir);
      // Simulate what the wizard does: iterate phases array for model selection steps
      const phaseNames = Object.keys(metadata);
      const resolvedPhases = {};
      for (const phaseName of phaseNames) {
        resolvedPhases[phaseName] = [{ target: 'test-model', role: 'primary', kind: 'lane', phase: phaseName }];
      }
      assert.equal(Object.keys(resolvedPhases).length, 2, 'Wizard should create lanes for each dynamic phase');
      assert.ok(resolvedPhases.concept, 'concept lane must be present');
      assert.ok(resolvedPhases.prototype, 'prototype lane must be present');
    } finally {
      cleanup(tmp);
    }
  });
});
