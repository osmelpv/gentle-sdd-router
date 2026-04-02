/**
 * Tests for the sdd-debug built-in catalog.
 *
 * Verifies:
 * - sdd-debug catalog loads correctly via loadCustomSdds()
 * - All 7 phases are present and valid
 * - All contracts (roles + phases) exist and have required sections
 * - sdd.yaml validates successfully
 * - Dependency chain: explore-issues → triage → diagnose → propose-fix → apply-fix → validate-fix → archive-debug
 *
 * Strict TDD: tests written FIRST (RED phase), catalog files come after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { loadCustomSdds, validateSddYaml } from '../src/core/sdd-catalog-io.js';
import { parseYaml } from '../src/core/router.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Absolute path to the real router/catalogs/ directory in this repo. */
const PROJECT_ROOT = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOGS_DIR = path.join(PROJECT_ROOT, 'router', 'catalogs');
const SDD_DEBUG_DIR = path.join(CATALOGS_DIR, 'sdd-debug');

// ─── 7 Expected Phases ───────────────────────────────────────────────────────

const EXPECTED_PHASES = [
  'explore-issues',
  'triage',
  'diagnose',
  'propose-fix',
  'apply-fix',
  'validate-fix',
  'archive-debug',
];

// ─── Expected dependency chain ───────────────────────────────────────────────

const EXPECTED_DEPS = {
  'explore-issues': [],
  'triage': ['explore-issues'],
  'diagnose': ['triage'],
  'propose-fix': ['diagnose'],
  'apply-fix': ['propose-fix'],
  'validate-fix': ['apply-fix'],
  'archive-debug': ['validate-fix'],
};

// ─── 7 Role contracts ────────────────────────────────────────────────────────

const EXPECTED_ROLES = [
  'explorer',
  'triager',
  'diagnostician',
  'fix-proposer',
  'fix-implementer',
  'fix-validator',
  'debug-archiver',
];

// ─── Required sections in role contracts ─────────────────────────────────────

const ROLE_REQUIRED_SECTIONS = [
  '## Role Definition',
  '## Core Responsibilities',
  '## Mandatory Rules',
  '## Skills',
  '## Red Lines',
  '## Output Format',
];

// ─── Required sections in phase contracts ────────────────────────────────────

const PHASE_REQUIRED_SECTIONS = [
  '## Composition',
  '## Input Contract',
  '## Output Contract',
  '## Hard Constraints',
  '## Success Criteria',
];

// ─── sdd-debug catalog structure ─────────────────────────────────────────────

describe('sdd-debug catalog — directory structure', () => {
  test('router/catalogs/sdd-debug/ directory exists', () => {
    assert.ok(
      fs.existsSync(SDD_DEBUG_DIR),
      `sdd-debug catalog directory must exist at ${SDD_DEBUG_DIR}`
    );
  });

  test('sdd.yaml exists inside sdd-debug/', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    assert.ok(
      fs.existsSync(sddYamlPath),
      `sdd.yaml must exist at ${sddYamlPath}`
    );
  });

  test('contracts/roles/ directory exists', () => {
    const rolesDir = path.join(SDD_DEBUG_DIR, 'contracts', 'roles');
    assert.ok(
      fs.existsSync(rolesDir),
      `contracts/roles/ must exist at ${rolesDir}`
    );
  });

  test('contracts/phases/ directory exists', () => {
    const phasesDir = path.join(SDD_DEBUG_DIR, 'contracts', 'phases');
    assert.ok(
      fs.existsSync(phasesDir),
      `contracts/phases/ must exist at ${phasesDir}`
    );
  });
});

// ─── sdd.yaml loading and validation ─────────────────────────────────────────

describe('sdd-debug catalog — sdd.yaml validity', () => {
  test('sdd.yaml parses without errors', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    assert.doesNotThrow(() => parseYaml(raw), 'sdd.yaml must be valid YAML');
  });

  test('sdd.yaml validates successfully via validateSddYaml', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    assert.doesNotThrow(
      () => validateSddYaml(parsed, sddYamlPath),
      'validateSddYaml must accept sdd-debug/sdd.yaml'
    );
  });

  test('sdd.yaml has name = "sdd-debug"', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const sdd = validateSddYaml(parsed, sddYamlPath);
    assert.equal(sdd.name, 'sdd-debug', 'SDD name must be "sdd-debug"');
  });

  test('sdd.yaml has version >= 1', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const sdd = validateSddYaml(parsed, sddYamlPath);
    assert.ok(sdd.version >= 1, 'SDD version must be >= 1');
  });

  test('sdd.yaml has non-empty description', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const sdd = validateSddYaml(parsed, sddYamlPath);
    assert.ok(sdd.description && sdd.description.trim().length > 0, 'SDD description must be non-empty');
  });
});

// ─── 7 phases present and valid ──────────────────────────────────────────────

describe('sdd-debug catalog — 7 phases present', () => {
  let sdd;

  // Load once before all tests in this describe block
  test('all 7 expected phases exist in sdd.yaml', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    sdd = validateSddYaml(parsed, sddYamlPath);

    const phaseNames = Object.keys(sdd.phases);
    for (const expected of EXPECTED_PHASES) {
      assert.ok(
        phaseNames.includes(expected),
        `Phase "${expected}" must be defined in sdd.yaml`
      );
    }
  });

  test('exactly 7 phases (no extras, no fewer)', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);
    assert.equal(
      Object.keys(loadedSdd.phases).length,
      7,
      'sdd-debug must have exactly 7 phases'
    );
  });

  test('each phase has a non-empty intent', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);

    for (const phaseName of EXPECTED_PHASES) {
      const phase = loadedSdd.phases[phaseName];
      assert.ok(
        phase && phase.intent && phase.intent.trim().length > 0,
        `Phase "${phaseName}" must have a non-empty intent`
      );
    }
  });

  test('each phase has a valid execution value', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);

    for (const phaseName of EXPECTED_PHASES) {
      const phase = loadedSdd.phases[phaseName];
      assert.ok(
        ['parallel', 'sequential'].includes(phase.execution),
        `Phase "${phaseName}" must have execution = parallel|sequential, got "${phase.execution}"`
      );
    }
  });
});

// ─── Dependency chain validation ─────────────────────────────────────────────

describe('sdd-debug catalog — dependency chain', () => {
  test('explore-issues has no dependencies (chain start)', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);
    assert.deepEqual(
      loadedSdd.phases['explore-issues'].depends_on,
      [],
      'explore-issues must have no dependencies'
    );
  });

  test('triage depends on explore-issues', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);
    assert.deepEqual(
      loadedSdd.phases['triage'].depends_on,
      ['explore-issues'],
      'triage must depend on explore-issues'
    );
  });

  test('full dependency chain is correct for all 7 phases', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const loadedSdd = validateSddYaml(parsed, sddYamlPath);

    for (const [phaseName, expectedDeps] of Object.entries(EXPECTED_DEPS)) {
      assert.deepEqual(
        loadedSdd.phases[phaseName].depends_on,
        expectedDeps,
        `Phase "${phaseName}" must depend on: [${expectedDeps.join(', ')}]`
      );
    }
  });

  test('dependency chain has no cycles (validateSddYaml passes)', () => {
    const sddYamlPath = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
    const raw = fs.readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    // This will throw if there are cycles
    assert.doesNotThrow(
      () => validateSddYaml(parsed, sddYamlPath),
      'sdd-debug dependency chain must have no cycles'
    );
  });
});

// ─── loadCustomSdds integration ──────────────────────────────────────────────

describe('sdd-debug catalog — loads via loadCustomSdds()', () => {
  test('loadCustomSdds(catalogsDir) includes sdd-debug', () => {
    const sdds = loadCustomSdds(CATALOGS_DIR);
    const debugSdd = sdds.find(s => s.name === 'sdd-debug');
    assert.ok(debugSdd, 'loadCustomSdds must return sdd-debug in the list');
  });

  test('loaded sdd-debug has all 7 phases', () => {
    const sdds = loadCustomSdds(CATALOGS_DIR);
    const debugSdd = sdds.find(s => s.name === 'sdd-debug');
    assert.ok(debugSdd, 'sdd-debug must be loaded');
    const phaseNames = Object.keys(debugSdd.phases);
    for (const expected of EXPECTED_PHASES) {
      assert.ok(phaseNames.includes(expected), `Loaded sdd-debug must have phase "${expected}"`);
    }
  });
});

// ─── Role contract files ──────────────────────────────────────────────────────

describe('sdd-debug catalog — role contracts exist', () => {
  for (const roleName of EXPECTED_ROLES) {
    test(`role contract "${roleName}.md" exists`, () => {
      const rolePath = path.join(SDD_DEBUG_DIR, 'contracts', 'roles', `${roleName}.md`);
      assert.ok(
        fs.existsSync(rolePath),
        `Role contract must exist at ${rolePath}`
      );
    });
  }
});

describe('sdd-debug catalog — role contracts have required sections', () => {
  for (const roleName of EXPECTED_ROLES) {
    test(`role "${roleName}.md" contains all required sections`, () => {
      const rolePath = path.join(SDD_DEBUG_DIR, 'contracts', 'roles', `${roleName}.md`);
      const content = fs.readFileSync(rolePath, 'utf8');
      for (const section of ROLE_REQUIRED_SECTIONS) {
        assert.ok(
          content.includes(section),
          `Role "${roleName}.md" must contain section: ${section}`
        );
      }
    });
  }
});

// ─── Phase contract files ─────────────────────────────────────────────────────

describe('sdd-debug catalog — phase contracts exist', () => {
  for (const phaseName of EXPECTED_PHASES) {
    test(`phase contract "${phaseName}.md" exists`, () => {
      const phasePath = path.join(SDD_DEBUG_DIR, 'contracts', 'phases', `${phaseName}.md`);
      assert.ok(
        fs.existsSync(phasePath),
        `Phase contract must exist at ${phasePath}`
      );
    });
  }
});

describe('sdd-debug catalog — phase contracts have required sections', () => {
  for (const phaseName of EXPECTED_PHASES) {
    test(`phase "${phaseName}.md" contains all required sections`, () => {
      const phasePath = path.join(SDD_DEBUG_DIR, 'contracts', 'phases', `${phaseName}.md`);
      const content = fs.readFileSync(phasePath, 'utf8');
      for (const section of PHASE_REQUIRED_SECTIONS) {
        assert.ok(
          content.includes(section),
          `Phase contract "${phaseName}.md" must contain section: ${section}`
        );
      }
    });
  }
});
