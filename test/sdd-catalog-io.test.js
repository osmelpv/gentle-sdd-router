/**
 * Unit tests for sdd-catalog-io.js
 * Tests: loadCustomSdds, createCustomSdd, deleteCustomSdd, validateSddYaml, resolveContract
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  validateSddYaml,
  loadCustomSdds,
  createCustomSdd,
  deleteCustomSdd,
  resolveContract,
  scaffoldPhaseContract,
  validateSddFull,
  listDeclaredInvocations,
} from '../src/core/sdd-catalog-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-sdd-catalog-io-test-'));
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

// ─── Minimal valid sdd.yaml ───────────────────────────────────────────────────

const MINIMAL_SDD_YAML = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define high-level game concept"
`;

const TWO_PHASE_SDD_YAML = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define the concept"
    execution: parallel
    agents: 2
    judge: true
  narrative:
    intent: "Write the narrative"
    depends_on:
      - concept
`;

const INVALID_YAML_MISSING_NAME = `version: 1
phases:
  concept:
    intent: "Something"
`;

const INVALID_YAML_MISSING_PHASES = `name: my-sdd
version: 1
`;

const INVALID_YAML_PHASE_NO_INTENT = `name: my-sdd
version: 1
phases:
  concept: {}
`;

const INVALID_YAML_BAD_EXECUTION = `name: my-sdd
version: 1
phases:
  concept:
    intent: "something"
    execution: concurrent
`;

const CYCLE_SDD_YAML = `name: cycle-sdd
version: 1
phases:
  a:
    intent: "Phase A"
    depends_on:
      - b
  b:
    intent: "Phase B"
    depends_on:
      - a
`;

const UNKNOWN_DEP_SDD_YAML = `name: dep-sdd
version: 1
phases:
  a:
    intent: "Phase A"
    depends_on:
      - nonexistent
`;

const TRIGGER_SDD_YAML = `name: trigger-sdd
version: 1
phases:
  main:
    intent: "Main phase"
triggers:
  from_sdd: "sdd-orchestrator"
  trigger_phase: "apply"
  return_to: "verify"
`;

// ─── validateSddYaml ─────────────────────────────────────────────────────────

describe('validateSddYaml', () => {
  test('accepts a minimal valid sdd.yaml', () => {
    const parsed = {
      name: 'game-design',
      version: 1,
      phases: {
        concept: { intent: 'Define high-level game concept' },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.name, 'game-design');
    assert.equal(result.version, 1);
    assert.ok(result.phases.concept);
  });

  test('throws when name is missing', () => {
    const parsed = {
      version: 1,
      phases: { concept: { intent: 'Something' } },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /name/i);
  });

  test('throws when phases is missing', () => {
    const parsed = { name: 'my-sdd', version: 1 };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /phases/i);
  });

  test('throws when phases is empty object', () => {
    const parsed = { name: 'my-sdd', version: 1, phases: {} };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /phases/i);
  });

  test('throws when a phase has no intent', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: {} },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /intent/i);
  });

  test('throws on invalid execution enum value', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: { intent: 'something', execution: 'concurrent' },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /execution/i);
  });

  test('throws on circular depends_on', () => {
    const parsed = {
      name: 'cycle-sdd',
      version: 1,
      phases: {
        a: { intent: 'Phase A', depends_on: ['b'] },
        b: { intent: 'Phase B', depends_on: ['a'] },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /cycl|circular/i);
  });

  test('throws on unknown depends_on reference', () => {
    const parsed = {
      name: 'dep-sdd',
      version: 1,
      phases: {
        a: { intent: 'Phase A', depends_on: ['nonexistent'] },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /nonexistent|unknown/i);
  });

  test('accepts valid execution values: parallel and sequential', () => {
    const parallel = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: { intent: 'something', execution: 'parallel' } },
    };
    const seq = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: { intent: 'something', execution: 'sequential' } },
    };
    assert.doesNotThrow(() => validateSddYaml(parallel, '<test>'));
    assert.doesNotThrow(() => validateSddYaml(seq, '<test>'));
  });

  test('applies defaults: missing execution defaults to sequential', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: { intent: 'something' } },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.execution, 'sequential');
  });

  test('applies defaults: missing agents defaults to 1', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: { intent: 'something' } },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.agents, 1);
  });

  test('stores trigger fields as plain data (non-executing)', () => {
    const parsed = {
      name: 'trigger-sdd',
      version: 1,
      phases: { main: { intent: 'Main phase' } },
      triggers: { from_sdd: 'sdd-orchestrator', trigger_phase: 'apply', return_to: 'verify' },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.triggers.from_sdd, 'sdd-orchestrator');
    assert.equal(result.triggers.trigger_phase, 'apply');
    assert.equal(result.triggers.return_to, 'verify');
    // Must be plain string — no execution
    assert.equal(typeof result.triggers.from_sdd, 'string');
  });

  test('accepts non-slug name should throw', () => {
    const parsed = {
      name: 'My SDD',
      version: 1,
      phases: { concept: { intent: 'something' } },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /slug|name/i);
  });
});

// ─── loadCustomSdds ───────────────────────────────────────────────────────────

describe('loadCustomSdds', () => {
  test('returns empty array when catalogs dir does not exist', () => {
    const tmp = makeTempDir();
    try {
      const nonExistent = path.join(tmp, 'catalogs');
      const result = loadCustomSdds(nonExistent, { includeGlobal: false });
      assert.deepEqual(result, []);
    } finally {
      cleanup(tmp);
    }
  });

  test('returns empty array when catalogs dir is empty', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      const result = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.deepEqual(result, []);
    } finally {
      cleanup(tmp);
    }
  });

  test('loads one valid sdd.yaml', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', MINIMAL_SDD_YAML);
      const result = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'game-design');
    } finally {
      cleanup(tmp);
    }
  });

  test('loads multiple valid catalogs', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'alpha/sdd.yaml', MINIMAL_SDD_YAML.replace('game-design', 'alpha'));
      writeFile(catalogsDir, 'beta/sdd.yaml', MINIMAL_SDD_YAML.replace('game-design', 'beta'));
      const result = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(result.length, 2);
      const names = result.map(s => s.name).sort();
      assert.deepEqual(names, ['alpha', 'beta']);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when one catalog has invalid sdd.yaml', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'alpha/sdd.yaml', MINIMAL_SDD_YAML.replace('game-design', 'alpha'));
      writeFile(catalogsDir, 'beta/sdd.yaml', INVALID_YAML_MISSING_NAME);
      assert.throws(() => loadCustomSdds(catalogsDir, { includeGlobal: false }), /name/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('loaded SDD has correct phases with defaults applied', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', MINIMAL_SDD_YAML);
      const [sdd] = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(sdd.phases.concept.intent, 'Define high-level game concept');
      assert.equal(sdd.phases.concept.execution, 'sequential');
      assert.equal(sdd.phases.concept.agents, 1);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── createCustomSdd ─────────────────────────────────────────────────────────

describe('createCustomSdd', () => {
  test('creates sdd.yaml with correct structure', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      const result = createCustomSdd(catalogsDir, 'my-sdd', 'My custom workflow');
      assert.equal(result.name, 'my-sdd');
      assert.ok(fs.existsSync(path.join(catalogsDir, 'my-sdd', 'sdd.yaml')));
    } finally {
      cleanup(tmp);
    }
  });

  test('sdd.yaml contains name, version, description', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd', 'My custom workflow');
      const content = fs.readFileSync(path.join(catalogsDir, 'my-sdd', 'sdd.yaml'), 'utf8');
      assert.ok(content.includes('name: my-sdd'));
      assert.ok(content.includes('My custom workflow'));
    } finally {
      cleanup(tmp);
    }
  });

  test('creates contracts/roles and contracts/phases subdirectories', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      assert.ok(fs.existsSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'roles')));
      assert.ok(fs.existsSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases')));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD with same name already exists', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      assert.throws(() => createCustomSdd(catalogsDir, 'my-sdd'), /already exist|duplicate/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on non-slug name (uppercase)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(() => createCustomSdd(catalogsDir, 'My SDD'), /slug|name/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on non-slug name (spaces)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(() => createCustomSdd(catalogsDir, 'my sdd'), /slug|name/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('valid slug name creates without error', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.doesNotThrow(() => createCustomSdd(catalogsDir, 'my-sdd-123'));
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── deleteCustomSdd ─────────────────────────────────────────────────────────

describe('deleteCustomSdd', () => {
  test('removes the catalog directory', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      assert.ok(fs.existsSync(path.join(catalogsDir, 'my-sdd')));

      deleteCustomSdd(catalogsDir, 'my-sdd');
      assert.ok(!fs.existsSync(path.join(catalogsDir, 'my-sdd')));
    } finally {
      cleanup(tmp);
    }
  });

  test('deleted SDD no longer appears in loadCustomSdds', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      createCustomSdd(catalogsDir, 'other-sdd');

      deleteCustomSdd(catalogsDir, 'my-sdd');
      const remaining = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].name, 'other-sdd');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD does not exist', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(() => deleteCustomSdd(catalogsDir, 'ghost-sdd'), /not found|ghost-sdd/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('returns delete result with name and deleted: true', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      const result = deleteCustomSdd(catalogsDir, 'my-sdd');
      assert.equal(result.name, 'my-sdd');
      assert.equal(result.deleted, true);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── resolveContract ─────────────────────────────────────────────────────────

describe('resolveContract', () => {
  test('returns catalog-scoped contract when it exists', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const globalContractsDir = path.join(tmp, 'contracts');
      writeFile(catalogsDir, 'game-design/contracts/roles/director.md', '# Director role');
      writeFile(globalContractsDir, 'roles/director.md', '# Global director');

      const result = resolveContract('roles', 'director', 'game-design', catalogsDir, globalContractsDir);
      assert.ok(result !== null);
      assert.ok(result.content.includes('Director role'));
      assert.ok(result.source.includes('catalogs'));
    } finally {
      cleanup(tmp);
    }
  });

  test('falls back to global contract when catalog contract does not exist', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const globalContractsDir = path.join(tmp, 'contracts');
      fs.mkdirSync(path.join(catalogsDir, 'game-design'), { recursive: true });
      writeFile(globalContractsDir, 'roles/agent.md', '# Agent role');

      const result = resolveContract('roles', 'agent', 'game-design', catalogsDir, globalContractsDir);
      assert.ok(result !== null);
      assert.ok(result.content.includes('Agent role'));
      assert.ok(result.source.includes('contracts'));
    } finally {
      cleanup(tmp);
    }
  });

  test('returns null when neither catalog nor global contract exists', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const globalContractsDir = path.join(tmp, 'contracts');
      fs.mkdirSync(catalogsDir, { recursive: true });
      fs.mkdirSync(globalContractsDir, { recursive: true });

      const result = resolveContract('roles', 'unknown-role', 'game-design', catalogsDir, globalContractsDir);
      assert.equal(result, null);
    } finally {
      cleanup(tmp);
    }
  });

  test('catalog contract takes precedence over global (both exist)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const globalContractsDir = path.join(tmp, 'contracts');
      writeFile(catalogsDir, 'game-design/contracts/roles/director.md', '# CATALOG director');
      writeFile(globalContractsDir, 'roles/director.md', '# GLOBAL director');

      const result = resolveContract('roles', 'director', 'game-design', catalogsDir, globalContractsDir);
      assert.ok(result.content.includes('CATALOG director'));
    } finally {
      cleanup(tmp);
    }
  });

  test('result includes a checksum', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const globalContractsDir = path.join(tmp, 'contracts');
      writeFile(catalogsDir, 'game-design/contracts/roles/director.md', '# Director');
      const result = resolveContract('roles', 'director', 'game-design', catalogsDir, globalContractsDir);
      assert.ok(result.checksum);
      assert.equal(typeof result.checksum, 'string');
      assert.equal(result.checksum.length, 64); // sha256 hex
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── validateSddYaml — invoke extension ──────────────────────────────────────

describe('validateSddYaml — invoke field', () => {
  test('normalizes absent invoke to null', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: { concept: { intent: 'Define concept' } },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.invoke, null);
  });

  test('accepts valid invoke block and normalizes sdd default to catalog', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'art-production', payload_from: 'output', await: true },
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    const invoke = result.phases.concept.invoke;
    assert.equal(invoke.catalog, 'art-production');
    assert.equal(invoke.sdd, 'art-production'); // defaults to catalog
    assert.equal(invoke.await, true);
    assert.equal(invoke.payload_from, 'output');
  });

  test('accepts explicit sdd that differs from catalog', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'art-production', sdd: 'asset-pipeline', payload_from: 'input' },
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.invoke.sdd, 'asset-pipeline');
  });

  test('defaults await to true when absent', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'target', payload_from: 'output' },
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.invoke.await, true);
  });

  test('throws when invoke.catalog is an invalid slug', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'Art Production', payload_from: 'output' },
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /slug|catalog/i);
  });

  test('throws when payload_from is invalid enum value', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'target', payload_from: 'all' },
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /payload_from|output|input|custom/i);
  });

  test('throws when await is not boolean', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { catalog: 'target', payload_from: 'output', await: 'yes' },
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /await|boolean/i);
  });

  test('throws when invoke.catalog is missing', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: {
          intent: 'Define concept',
          invoke: { payload_from: 'output' },
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /catalog|required/i);
  });

  test('invoke null leaves other phase fields intact', () => {
    const parsed = {
      name: 'my-sdd',
      version: 1,
      phases: {
        concept: { intent: 'Define concept', execution: 'parallel', agents: 2 },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.concept.execution, 'parallel');
    assert.equal(result.phases.concept.agents, 2);
    assert.equal(result.phases.concept.invoke, null);
  });
});

// ─── scaffoldPhaseContract ────────────────────────────────────────────────────

describe('scaffoldPhaseContract', () => {
  test('creates a .md contract file for the phase', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases'), { recursive: true });
      scaffoldPhaseContract(catalogsDir, 'my-sdd', 'concept', {
        intent: 'Define the concept',
        agents: 1,
        judge: false,
        radar: false,
      });
      const contractPath = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases', 'concept.md');
      assert.ok(fs.existsSync(contractPath), 'Contract file should exist');
    } finally {
      cleanup(tmp);
    }
  });

  test('contract contains phase name as title', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'game-design', 'contracts', 'phases'), { recursive: true });
      scaffoldPhaseContract(catalogsDir, 'game-design', 'narrative', {
        intent: 'Write the narrative arc',
        agents: 1,
        judge: false,
        radar: false,
      });
      const contractPath = path.join(catalogsDir, 'game-design', 'contracts', 'phases', 'narrative.md');
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.includes('narrative'), 'Contract must include phase name');
      assert.ok(content.startsWith('# Phase:') || content.includes('# Phase:'), 'Contract must have Phase heading');
    } finally {
      cleanup(tmp);
    }
  });

  test('contract contains the intent from phaseConfig', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases'), { recursive: true });
      scaffoldPhaseContract(catalogsDir, 'my-sdd', 'explore', {
        intent: 'Investigate and understand the codebase',
        agents: 2,
        judge: true,
        radar: false,
      });
      const contractPath = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases', 'explore.md');
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.includes('Investigate and understand the codebase'), 'Contract must include intent text');
    } finally {
      cleanup(tmp);
    }
  });

  test('contract contains composition info (agents, judge, radar)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases'), { recursive: true });
      scaffoldPhaseContract(catalogsDir, 'my-sdd', 'apply', {
        intent: 'Implement tasks',
        agents: 3,
        judge: true,
        radar: true,
      });
      const contractPath = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases', 'apply.md');
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.includes('3'), 'Contract must include agents count');
      // judge: true → 'yes'
      assert.ok(content.includes('yes') || content.includes('true'), 'Contract must include judge info');
    } finally {
      cleanup(tmp);
    }
  });

  test('does NOT overwrite existing contract file', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const phasesDir = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases');
      fs.mkdirSync(phasesDir, { recursive: true });
      const contractPath = path.join(phasesDir, 'concept.md');
      // Write original content
      fs.writeFileSync(contractPath, '# My Custom Content\n', 'utf8');
      // Try to scaffold — should skip
      scaffoldPhaseContract(catalogsDir, 'my-sdd', 'concept', {
        intent: 'New intent',
        agents: 1,
        judge: false,
        radar: false,
      });
      // Content must remain unchanged
      const afterContent = fs.readFileSync(contractPath, 'utf8');
      assert.equal(afterContent, '# My Custom Content\n', 'Should not overwrite existing contract');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns { created: true } when file is created', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases'), { recursive: true });
      const result = scaffoldPhaseContract(catalogsDir, 'my-sdd', 'concept', {
        intent: 'Define concept',
        agents: 1,
        judge: false,
        radar: false,
      });
      assert.equal(result.created, true);
      assert.ok(result.path.endsWith('concept.md'), 'Result path should end with concept.md');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns { created: false } when file already exists', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const phasesDir = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases');
      fs.mkdirSync(phasesDir, { recursive: true });
      fs.writeFileSync(path.join(phasesDir, 'concept.md'), '# Existing\n', 'utf8');
      const result = scaffoldPhaseContract(catalogsDir, 'my-sdd', 'concept', {
        intent: 'Define concept',
        agents: 1,
        judge: false,
        radar: false,
      });
      assert.equal(result.created, false);
    } finally {
      cleanup(tmp);
    }
  });

  test('contract includes template sections (Instructions, Input Contract, Output Contract)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(path.join(catalogsDir, 'my-sdd', 'contracts', 'phases'), { recursive: true });
      scaffoldPhaseContract(catalogsDir, 'my-sdd', 'verify', {
        intent: 'Verify implementation',
        agents: 1,
        judge: false,
        radar: false,
      });
      const contractPath = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases', 'verify.md');
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.includes('## Instructions'), 'Contract must have Instructions section');
      assert.ok(content.includes('## Input Contract'), 'Contract must have Input Contract section');
      assert.ok(content.includes('## Output Contract'), 'Contract must have Output Contract section');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── createCustomSdd — auto-generates phase contracts ─────────────────────────

describe('createCustomSdd — auto-generates phase contracts', () => {
  test('createCustomSdd generates a contract file for the default main phase', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      createCustomSdd(catalogsDir, 'my-sdd');
      const contractPath = path.join(catalogsDir, 'my-sdd', 'contracts', 'phases', 'main.md');
      assert.ok(fs.existsSync(contractPath), 'Contract for default main phase must be created');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── validateSddFull ──────────────────────────────────────────────────────────

describe('validateSddFull — sdd.yaml + contract presence checks', () => {
  const SDD_WITH_INVOKES = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
  level-design:
    intent: "Design levels"
    invoke:
      catalog: art-production
      payload_from: output
      await: true
`;

  test('returns valid:true and no errors for a fully valid SDD with all phase contracts present', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      // Create SDD
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');
      // Create contracts for all phases
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase: concept\n', 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'level-design.md'), '# Phase: level-design\n', 'utf8');

      const result = validateSddFull(catalogsDir, 'game-design');
      assert.equal(result.valid, true, 'should be valid when all contracts are present');
      assert.equal(result.errors.length, 0, 'should have no errors');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns valid:false when phase contracts are missing', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');
      // Only create contract for 'concept', missing 'level-design'
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase: concept\n', 'utf8');

      const result = validateSddFull(catalogsDir, 'game-design');
      assert.equal(result.valid, false, 'should be invalid when phase contracts are missing');
      assert.ok(result.errors.length > 0, 'should have at least one error');
      assert.ok(result.errors.some(e => e.includes('level-design')), 'error should mention missing phase');
    } finally {
      cleanup(tmp);
    }
  });

  test('result includes details.phases with present/missing contract info', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase\n', 'utf8');
      // level-design contract missing

      const result = validateSddFull(catalogsDir, 'game-design');
      assert.ok(result.details, 'result must have details');
      assert.ok(typeof result.details.phases === 'object', 'details.phases must be an object');
      assert.equal(result.details.phases.present, 1, '1 phase contract present');
      assert.equal(result.details.phases.missing.length, 1, '1 phase contract missing');
      assert.ok(result.details.phases.missing.includes('level-design'), 'missing array has level-design');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns warnings for missing role contracts (not errors)', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.mkdirSync(path.join(sddDir, 'contracts', 'roles'), { recursive: true });
      // SDD with roles referenced
      const sddWithRoles = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
    agents: 2
roles:
  - balance-designer
  - art-director
`;
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), sddWithRoles, 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase\n', 'utf8');
      // Create only one role contract, missing the other
      fs.writeFileSync(path.join(sddDir, 'contracts', 'roles', 'balance-designer.md'), '# Role\n', 'utf8');

      const result = validateSddFull(catalogsDir, 'game-design');
      assert.ok(result.warnings.some(w => w.includes('art-director')), 'warning must mention missing role');
    } finally {
      cleanup(tmp);
    }
  });

  test('detects invoke references to non-existent catalogs', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase\n', 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'level-design.md'), '# Phase\n', 'utf8');
      // 'art-production' catalog does NOT exist in catalogsDir

      const result = validateSddFull(catalogsDir, 'game-design');
      assert.ok(
        result.warnings.some(w => w.includes('art-production')),
        'should warn about missing catalog for invoke target'
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD does not exist', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(
        () => validateSddFull(catalogsDir, 'nonexistent'),
        /nonexistent/,
        'must throw for missing SDD'
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── Fix 3: normalizeInvoke — new fields ─────────────────────────────────────

describe('normalizeInvoke — input_context, output_expected, on_failure (Fix 3)', () => {
  const makeSddWithInvoke = (invokeExtra = '') => `name: game-design
version: 1
phases:
  level-design:
    intent: "Design levels"
    invoke:
      catalog: art-production
      payload_from: output
      await: true
${invokeExtra}`;

  test('normalizes invoke with input_context as array of objects', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      input_context:
        - artifact: balance-sheet
          field: "unit.stats"
        - artifact: level-layout
          field: "zones.north"
`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      const invoke = sdd.phases['level-design'].invoke;
      assert.ok(Array.isArray(invoke.input_context), 'input_context must be an array');
      assert.equal(invoke.input_context.length, 2, 'should have 2 input_context entries');
      assert.equal(invoke.input_context[0].artifact, 'balance-sheet');
      assert.equal(invoke.input_context[0].field, 'unit.stats');
    } finally {
      cleanup(tmp);
    }
  });

  test('normalizes invoke with output_expected as array of objects', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      output_expected:
        - artifact: fbx-model
          format: "FBX rigged"
        - artifact: texture-set
          format: "PNG 2048x2048"
`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      const invoke = sdd.phases['level-design'].invoke;
      assert.ok(Array.isArray(invoke.output_expected), 'output_expected must be an array');
      assert.equal(invoke.output_expected.length, 2, 'should have 2 output_expected entries');
      assert.equal(invoke.output_expected[0].artifact, 'fbx-model');
      assert.equal(invoke.output_expected[0].format, 'FBX rigged');
    } finally {
      cleanup(tmp);
    }
  });

  test('normalizes on_failure: block', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      on_failure: block\n`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      assert.equal(sdd.phases['level-design'].invoke.on_failure, 'block');
    } finally {
      cleanup(tmp);
    }
  });

  test('normalizes on_failure: escalate', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      on_failure: escalate\n`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      assert.equal(sdd.phases['level-design'].invoke.on_failure, 'escalate');
    } finally {
      cleanup(tmp);
    }
  });

  test('normalizes on_failure: continue', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      on_failure: continue\n`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      assert.equal(sdd.phases['level-design'].invoke.on_failure, 'continue');
    } finally {
      cleanup(tmp);
    }
  });

  test('on_failure defaults to block when absent', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke('');
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      assert.equal(sdd.phases['level-design'].invoke.on_failure, 'block', 'default on_failure must be block');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on invalid on_failure value', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      on_failure: retry\n`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      assert.throws(
        () => loadCustomSdds(catalogsDir, { includeGlobal: false }),
        /on_failure.*retry|retry.*on_failure|invalid/i,
        'must throw for invalid on_failure value'
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('input_context and output_expected are included in manifest v3 round-trip', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const yaml = makeSddWithInvoke(`      input_context:
        - artifact: spec-doc
          field: summary
      output_expected:
        - artifact: design-doc
          format: "Markdown"
      on_failure: escalate
`);
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), yaml, 'utf8');
      const sdd = loadCustomSdds(catalogsDir, { includeGlobal: false })[0];
      const invoke = sdd.phases['level-design'].invoke;
      // Round-trip checks
      assert.ok(Array.isArray(invoke.input_context), 'input_context must survive round-trip');
      assert.ok(Array.isArray(invoke.output_expected), 'output_expected must survive round-trip');
      assert.equal(invoke.on_failure, 'escalate', 'on_failure must survive round-trip');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── Fix 4: listDeclaredInvocations ──────────────────────────────────────────

describe('listDeclaredInvocations — declared invocations from sdd.yaml', () => {
  const SDD_NO_INVOKES = `name: basic-sdd
version: 1
phases:
  explore:
    intent: "Explore the problem"
  spec:
    intent: "Write specs"
`;

  const SDD_WITH_INVOKES = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
  level-design:
    intent: "Design levels"
    invoke:
      catalog: art-production
      sdd: asset-pipeline
      payload_from: output
      await: true
      on_failure: block
  multiplayer:
    intent: "Design multiplayer"
    invoke:
      catalog: engineering
      sdd: backend-spec
      payload_from: output
      await: true
      on_failure: escalate
      input_context:
        - artifact: game-spec
          field: multiplayer.requirements
      output_expected:
        - artifact: backend-api
          format: "OpenAPI 3.0"
`;

  test('returns empty array when SDD has no invokes', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'basic-sdd');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_NO_INVOKES, 'utf8');

      const result = listDeclaredInvocations(catalogsDir, 'basic-sdd');
      assert.ok(Array.isArray(result), 'must return an array');
      assert.equal(result.length, 0, 'must be empty when no invokes defined');
    } finally {
      cleanup(tmp);
    }
  });

  test('returns invocations for each phase with an invoke block', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');

      const result = listDeclaredInvocations(catalogsDir, 'game-design');
      assert.equal(result.length, 2, 'must return 2 invocations');
      const phaseNames = result.map(r => r.phase);
      assert.ok(phaseNames.includes('level-design'), 'must include level-design');
      assert.ok(phaseNames.includes('multiplayer'), 'must include multiplayer');
    } finally {
      cleanup(tmp);
    }
  });

  test('each invocation entry has phase, catalog, sdd, and on_failure fields', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');

      const result = listDeclaredInvocations(catalogsDir, 'game-design');
      const levelDesign = result.find(r => r.phase === 'level-design');
      assert.ok(levelDesign, 'level-design entry must exist');
      assert.equal(levelDesign.catalog, 'art-production', 'catalog must match');
      assert.equal(levelDesign.sdd, 'asset-pipeline', 'sdd must match');
      assert.equal(levelDesign.on_failure, 'block', 'on_failure must be block');
    } finally {
      cleanup(tmp);
    }
  });

  test('invocation with input_context includes it in the entry', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');

      const result = listDeclaredInvocations(catalogsDir, 'game-design');
      const multiplayer = result.find(r => r.phase === 'multiplayer');
      assert.ok(Array.isArray(multiplayer.input_context), 'input_context must be an array');
      assert.equal(multiplayer.input_context[0].artifact, 'game-spec');
    } finally {
      cleanup(tmp);
    }
  });

  test('invocation with output_expected includes it in the entry', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');

      const result = listDeclaredInvocations(catalogsDir, 'game-design');
      const multiplayer = result.find(r => r.phase === 'multiplayer');
      assert.ok(Array.isArray(multiplayer.output_expected), 'output_expected must be an array');
      assert.equal(multiplayer.output_expected[0].artifact, 'backend-api');
      assert.equal(multiplayer.output_expected[0].format, 'OpenAPI 3.0');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD does not exist', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(
        () => listDeclaredInvocations(catalogsDir, 'nonexistent'),
        /nonexistent/,
        'must throw for missing SDD'
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── validateSddYaml — delegation, checkpoint, loop_target (sdd-debug-v2) ───

describe('validateSddYaml — delegation field', () => {
  test('should preserve delegation: orchestrator on phases', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
          delegation: 'orchestrator',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.analyze.delegation, 'orchestrator');
  });

  test('should preserve delegation: sub-agent (default)', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
          delegation: 'sub-agent',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.analyze.delegation, 'sub-agent');
  });

  test('should default delegation to sub-agent when absent', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.analyze.delegation, 'sub-agent');
  });

  test('should reject invalid delegation value', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
          delegation: 'external',
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /delegation/i);
  });
});

describe('validateSddYaml — checkpoint field', () => {
  test('should preserve checkpoint block on phase', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        diagnose: {
          intent: 'Diagnose the issue',
          checkpoint: {
            before_next: true,
            show_user: ['forensic_report', 'proposed_changes'],
            user_actions: ['approve', 'question', 'contradict'],
            on_contradict: 'loop_self',
          },
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    const cp = result.phases.diagnose.checkpoint;
    assert.ok(cp, 'checkpoint must be present');
    assert.equal(cp.before_next, true);
    assert.deepEqual(cp.show_user, ['forensic_report', 'proposed_changes']);
    assert.deepEqual(cp.user_actions, ['approve', 'question', 'contradict']);
    assert.equal(cp.on_contradict, 'loop_self');
  });

  test('should default checkpoint to null when absent', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.analyze.checkpoint, null);
  });

  test('should reject checkpoint with non-boolean before_next', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        diagnose: {
          intent: 'Diagnose',
          checkpoint: {
            before_next: 'yes',
          },
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /checkpoint.*before_next|before_next.*boolean/i);
  });
});

describe('validateSddYaml — loop_target field', () => {
  test('should preserve loop_target field on phase', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        diagnose: {
          intent: 'Diagnose the issue',
        },
        finalize: {
          intent: 'Finalize the fix',
          depends_on: ['diagnose'],
          loop_target: 'diagnose',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.finalize.loop_target, 'diagnose');
  });

  test('should default loop_target to null when absent', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.phases.analyze.loop_target, null);
  });

  test('should reject invalid loop_target (non-existent phase)', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        finalize: {
          intent: 'Finalize the fix',
          loop_target: 'nonexistent-phase',
        },
      },
    };
    assert.throws(() => validateSddYaml(parsed, '<test>'), /loop_target|nonexistent/i);
  });
});

describe('loadCustomSdds — delegation/checkpoint/loop_target round-trip', () => {
  test('should preserve delegation field through loadCustomSdds', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddYaml = `name: debug-test
version: 1
phases:
  analyze:
    intent: "Analyze the area"
    delegation: orchestrator
  apply:
    intent: "Apply fixes"
    delegation: sub-agent
    depends_on:
      - analyze
`;
      writeFile(catalogsDir, 'debug-test/sdd.yaml', sddYaml);
      const [sdd] = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(sdd.phases.analyze.delegation, 'orchestrator');
      assert.equal(sdd.phases.apply.delegation, 'sub-agent');
    } finally {
      cleanup(tmp);
    }
  });

  test('should preserve checkpoint through loadCustomSdds', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddYaml = `name: debug-test
version: 1
phases:
  diagnose:
    intent: "Diagnose"
    checkpoint:
      before_next: true
      show_user:
        - forensic_report
      user_actions:
        - approve
        - contradict
      on_contradict: loop_self
`;
      writeFile(catalogsDir, 'debug-test/sdd.yaml', sddYaml);
      const [sdd] = loadCustomSdds(catalogsDir, { includeGlobal: false });
      const cp = sdd.phases.diagnose.checkpoint;
      assert.ok(cp, 'checkpoint must survive round-trip');
      assert.equal(cp.before_next, true);
      assert.deepEqual(cp.show_user, ['forensic_report']);
      assert.deepEqual(cp.user_actions, ['approve', 'contradict']);
    } finally {
      cleanup(tmp);
    }
  });

  test('should preserve loop_target through loadCustomSdds', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddYaml = `name: debug-test
version: 1
phases:
  diagnose:
    intent: "Diagnose"
  finalize:
    intent: "Finalize"
    depends_on:
      - diagnose
    loop_target: diagnose
`;
      writeFile(catalogsDir, 'debug-test/sdd.yaml', sddYaml);
      const [sdd] = loadCustomSdds(catalogsDir, { includeGlobal: false });
      assert.equal(sdd.phases.finalize.loop_target, 'diagnose');
    } finally {
      cleanup(tmp);
    }
  });
});

describe('validateSddYaml — orchestrator top-level block passthrough', () => {
  test('should preserve orchestrator block at top level', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        diagnose: {
          intent: 'Diagnose the issue',
          delegation: 'orchestrator',
        },
        apply: {
          intent: 'Apply fixes',
          delegation: 'sub-agent',
          depends_on: ['diagnose'],
        },
      },
      orchestrator: {
        retained_phases: ['diagnose'],
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.ok(result.orchestrator, 'orchestrator block must be present');
    assert.deepEqual(result.orchestrator.retained_phases, ['diagnose']);
  });

  test('should default orchestrator to null when absent', () => {
    const parsed = {
      name: 'debug-sdd',
      version: 1,
      phases: {
        analyze: {
          intent: 'Analyze the area',
        },
      },
    };
    const result = validateSddYaml(parsed, '<test>');
    assert.equal(result.orchestrator, null);
  });
});
