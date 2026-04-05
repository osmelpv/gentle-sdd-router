/**
 * Tests for sdd-debug v2 catalog structure.
 *
 * Validates the NEW 5-phase catalog definition, contracts, and role contracts
 * against the spec (sdd/sdd-debug-v2/spec) and design decisions.
 *
 * Covers scenarios: S01, S02, S03, S04, S06 from the spec.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { validateSddYaml, resolveContract } from '../src/core/sdd-catalog-io.js';
import { parseYaml } from '../src/core/router.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '..'
);

const CATALOGS_DIR = path.join(PROJECT_ROOT, 'router', 'catalogs');
const SDD_DEBUG_DIR = path.join(CATALOGS_DIR, 'sdd-debug');
const SDD_YAML_PATH = path.join(SDD_DEBUG_DIR, 'sdd.yaml');
const CONTRACTS_DIR = path.join(SDD_DEBUG_DIR, 'contracts');

function loadSddDebugYaml() {
  const raw = fs.readFileSync(SDD_YAML_PATH, 'utf8');
  return parseYaml(raw);
}

function loadAndValidate() {
  const parsed = loadSddDebugYaml();
  return validateSddYaml(parsed, SDD_YAML_PATH);
}

// ─── S01: sdd.yaml existence and metadata ────────────────────────────────────

describe('sdd-debug v2: catalog metadata', () => {
  test('sdd.yaml exists in router/catalogs/sdd-debug/', () => {
    assert.ok(fs.existsSync(SDD_YAML_PATH), 'sdd.yaml must exist');
  });

  test('name is "sdd-debug"', () => {
    const sdd = loadAndValidate();
    assert.equal(sdd.name, 'sdd-debug');
  });

  test('version is 2', () => {
    const sdd = loadAndValidate();
    assert.equal(sdd.version, 2);
  });

  test('description is non-empty', () => {
    const sdd = loadAndValidate();
    assert.ok(sdd.description.length > 0, 'description must be non-empty');
  });
});

// ─── S01: 5 phases in correct order ─────────────────────────────────────────

describe('sdd-debug v2: 5 phases in correct order (S01)', () => {
  const EXPECTED_PHASES = [
    'analyze-area',
    'implant-logs',
    'collect-and-diagnose',
    'apply-fixes',
    'finalize',
  ];

  test('has exactly 5 phases', () => {
    const sdd = loadAndValidate();
    const phaseNames = Object.keys(sdd.phases);
    assert.equal(phaseNames.length, 5, `Expected 5 phases, got ${phaseNames.length}: ${phaseNames.join(', ')}`);
  });

  test('phase names match expected list', () => {
    const sdd = loadAndValidate();
    const phaseNames = Object.keys(sdd.phases);
    assert.deepEqual(phaseNames, EXPECTED_PHASES);
  });

  test('phase_order is sequential 1-5', () => {
    const raw = loadSddDebugYaml();
    const phaseNames = Object.keys(raw.phases);
    for (let i = 0; i < phaseNames.length; i++) {
      const phase = raw.phases[phaseNames[i]];
      assert.equal(
        phase.phase_order,
        i + 1,
        `Phase '${phaseNames[i]}' should have phase_order ${i + 1}, got ${phase.phase_order}`
      );
    }
  });
});

// ─── S06: dependency chain ───────────────────────────────────────────────────

describe('sdd-debug v2: dependency chain (S06)', () => {
  test('analyze-area has no dependencies', () => {
    const sdd = loadAndValidate();
    assert.deepEqual(sdd.phases['analyze-area'].depends_on, []);
  });

  test('implant-logs depends on analyze-area', () => {
    const sdd = loadAndValidate();
    assert.deepEqual(sdd.phases['implant-logs'].depends_on, ['analyze-area']);
  });

  test('collect-and-diagnose depends on implant-logs', () => {
    const sdd = loadAndValidate();
    assert.deepEqual(sdd.phases['collect-and-diagnose'].depends_on, ['implant-logs']);
  });

  test('apply-fixes depends on collect-and-diagnose', () => {
    const sdd = loadAndValidate();
    assert.deepEqual(sdd.phases['apply-fixes'].depends_on, ['collect-and-diagnose']);
  });

  test('finalize depends on apply-fixes', () => {
    const sdd = loadAndValidate();
    assert.deepEqual(sdd.phases['finalize'].depends_on, ['apply-fixes']);
  });

  test('no circular dependencies — validation passes', () => {
    assert.doesNotThrow(() => loadAndValidate(), 'Validation must not throw for dependency chain');
  });
});

// ─── S02: delegation field preserved ─────────────────────────────────────────

describe('sdd-debug v2: delegation values (S02)', () => {
  const EXPECTED_DELEGATION = {
    'analyze-area': 'sub-agent',
    'implant-logs': 'sub-agent',
    'collect-and-diagnose': 'orchestrator',
    'apply-fixes': 'sub-agent',
    'finalize': 'orchestrator',
  };

  for (const [phaseName, expected] of Object.entries(EXPECTED_DELEGATION)) {
    test(`${phaseName} delegation is "${expected}"`, () => {
      const sdd = loadAndValidate();
      assert.equal(
        sdd.phases[phaseName].delegation,
        expected,
        `${phaseName} delegation must be "${expected}"`
      );
    });
  }
});

// ─── S03: checkpoint on collect-and-diagnose ─────────────────────────────────

describe('sdd-debug v2: checkpoint block (S03)', () => {
  test('collect-and-diagnose has checkpoint block', () => {
    const sdd = loadAndValidate();
    assert.ok(
      sdd.phases['collect-and-diagnose'].checkpoint !== null,
      'collect-and-diagnose must have a checkpoint block'
    );
  });

  test('checkpoint.before_next is true', () => {
    const sdd = loadAndValidate();
    const cp = sdd.phases['collect-and-diagnose'].checkpoint;
    assert.equal(cp.before_next, true);
  });

  test('checkpoint.show_user is a non-empty array', () => {
    const sdd = loadAndValidate();
    const cp = sdd.phases['collect-and-diagnose'].checkpoint;
    assert.ok(Array.isArray(cp.show_user) && cp.show_user.length > 0);
  });

  test('checkpoint.user_actions includes approve, question, contradict', () => {
    const sdd = loadAndValidate();
    const cp = sdd.phases['collect-and-diagnose'].checkpoint;
    assert.ok(Array.isArray(cp.user_actions));
    assert.ok(cp.user_actions.includes('approve'), 'user_actions must include approve');
    assert.ok(cp.user_actions.includes('question'), 'user_actions must include question');
    assert.ok(cp.user_actions.includes('contradict'), 'user_actions must include contradict');
  });

  test('checkpoint.on_contradict is "loop_self"', () => {
    const sdd = loadAndValidate();
    const cp = sdd.phases['collect-and-diagnose'].checkpoint;
    assert.equal(cp.on_contradict, 'loop_self');
  });

  test('other phases do NOT have checkpoint blocks', () => {
    const sdd = loadAndValidate();
    for (const phaseName of ['analyze-area', 'implant-logs', 'apply-fixes', 'finalize']) {
      assert.equal(
        sdd.phases[phaseName].checkpoint,
        null,
        `${phaseName} should NOT have a checkpoint block`
      );
    }
  });
});

// ─── S04: loop_target on finalize ────────────────────────────────────────────

describe('sdd-debug v2: loop_target (S04)', () => {
  test('finalize has loop_target pointing to collect-and-diagnose', () => {
    const sdd = loadAndValidate();
    assert.equal(
      sdd.phases['finalize'].loop_target,
      'collect-and-diagnose',
      'finalize.loop_target must point to collect-and-diagnose'
    );
  });

  test('other phases do NOT have loop_target', () => {
    const sdd = loadAndValidate();
    for (const phaseName of ['analyze-area', 'implant-logs', 'collect-and-diagnose', 'apply-fixes']) {
      assert.equal(
        sdd.phases[phaseName].loop_target,
        null,
        `${phaseName} should NOT have a loop_target`
      );
    }
  });
});

// ─── orchestrator.retained_phases ────────────────────────────────────────────

describe('sdd-debug v2: orchestrator block', () => {
  test('orchestrator block exists', () => {
    const sdd = loadAndValidate();
    assert.ok(sdd.orchestrator !== null, 'orchestrator block must exist');
  });

  test('retained_phases lists collect-and-diagnose and finalize', () => {
    const sdd = loadAndValidate();
    const retained = sdd.orchestrator.retained_phases;
    assert.ok(Array.isArray(retained), 'retained_phases must be an array');
    assert.ok(retained.includes('collect-and-diagnose'), 'must include collect-and-diagnose');
    assert.ok(retained.includes('finalize'), 'must include finalize');
    assert.equal(retained.length, 2, 'retained_phases must have exactly 2 entries');
  });

  test('retained_phases match delegation:orchestrator phases', () => {
    const sdd = loadAndValidate();
    const orchestratorPhases = Object.entries(sdd.phases)
      .filter(([, phase]) => phase.delegation === 'orchestrator')
      .map(([name]) => name)
      .sort();
    const retained = [...sdd.orchestrator.retained_phases].sort();
    assert.deepEqual(retained, orchestratorPhases);
  });
});

// ─── Phase contracts exist and have required sections ────────────────────────

describe('sdd-debug v2: phase contracts', () => {
  const PHASE_NAMES = [
    'analyze-area',
    'implant-logs',
    'collect-and-diagnose',
    'apply-fixes',
    'finalize',
  ];

  for (const phaseName of PHASE_NAMES) {
    test(`${phaseName}.md exists and is non-empty`, () => {
      const contractPath = path.join(CONTRACTS_DIR, 'phases', `${phaseName}.md`);
      assert.ok(fs.existsSync(contractPath), `${phaseName}.md must exist`);
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.trim().length > 100, `${phaseName}.md must have substantial content`);
    });

    test(`${phaseName}.md has Composition section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'phases', `${phaseName}.md`), 'utf8');
      assert.ok(content.includes('## Composition'), `${phaseName}.md must have Composition section`);
    });

    test(`${phaseName}.md has Phase Input or input section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'phases', `${phaseName}.md`), 'utf8');
      assert.ok(
        content.includes('## Phase Input') || content.includes('## Enriched Context'),
        `${phaseName}.md must have Phase Input or Enriched Context section`
      );
    });

    test(`${phaseName}.md has Phase Output or output section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'phases', `${phaseName}.md`), 'utf8');
      assert.ok(
        content.includes('## Phase Output') || content.includes('## Step '),
        `${phaseName}.md must have Phase Output section or Step sections`
      );
    });
  }

  test('resolveContract finds all 5 phase contracts', () => {
    const globalContracts = path.join(PROJECT_ROOT, 'router', 'contracts');
    for (const phaseName of PHASE_NAMES) {
      const result = resolveContract('phases', phaseName, 'sdd-debug', CATALOGS_DIR, globalContracts);
      assert.ok(result !== null, `Phase contract for '${phaseName}' must be resolvable`);
      assert.ok(result.content.length > 100, `Phase contract for '${phaseName}' must have content`);
    }
  });
});

// ─── Role contracts exist and have required sections ─────────────────────────

describe('sdd-debug v2: role contracts', () => {
  const ROLE_NAMES = [
    'debug-analyst',
    'log-implanter',
    'fix-implementer',
    'debug-archiver',
  ];

  for (const roleName of ROLE_NAMES) {
    test(`${roleName}.md exists and is non-empty`, () => {
      const contractPath = path.join(CONTRACTS_DIR, 'roles', `${roleName}.md`);
      assert.ok(fs.existsSync(contractPath), `${roleName}.md must exist`);
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.trim().length > 100, `${roleName}.md must have substantial content`);
    });

    test(`${roleName}.md has Role Definition section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'roles', `${roleName}.md`), 'utf8');
      assert.ok(content.includes('## Role Definition'), `${roleName}.md must have Role Definition section`);
    });

    test(`${roleName}.md has Behavioral Rules section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'roles', `${roleName}.md`), 'utf8');
      assert.ok(content.includes('## Behavioral Rules'), `${roleName}.md must have Behavioral Rules section`);
    });

    test(`${roleName}.md has Input Contract section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'roles', `${roleName}.md`), 'utf8');
      assert.ok(content.includes('## Input Contract'), `${roleName}.md must have Input Contract section`);
    });

    test(`${roleName}.md has Output Contract section`, () => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'roles', `${roleName}.md`), 'utf8');
      assert.ok(content.includes('## Output Contract'), `${roleName}.md must have Output Contract section`);
    });
  }

  test('resolveContract finds all 4 role contracts', () => {
    const globalContracts = path.join(PROJECT_ROOT, 'router', 'contracts');
    for (const roleName of ROLE_NAMES) {
      const result = resolveContract('roles', roleName, 'sdd-debug', CATALOGS_DIR, globalContracts);
      assert.ok(result !== null, `Role contract for '${roleName}' must be resolvable`);
      assert.ok(result.content.length > 100, `Role contract for '${roleName}' must have content`);
    }
  });
});

// ─── Output contract ─────────────────────────────────────────────────────────

describe('sdd-debug v2: output contract', () => {
  test('output-contract.md exists and is non-empty', () => {
    const contractPath = path.join(CONTRACTS_DIR, 'output-contract.md');
    assert.ok(fs.existsSync(contractPath), 'output-contract.md must exist');
    const content = fs.readFileSync(contractPath, 'utf8');
    assert.ok(content.trim().length > 500, 'output-contract.md must have substantial content');
  });

  test('output contract contains debug_result schema', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    assert.ok(content.includes('debug_result'), 'must contain debug_result schema');
  });

  test('output contract has v1 fields (backward compat)', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    const v1Fields = ['status', 'summary', 'baseline', 'issues_resolved', 'issues_unresolved',
      'issues_escalated', 'regressions', 'side_effects', 'requires_reverify'];
    for (const field of v1Fields) {
      assert.ok(content.includes(field), `output contract must contain v1 field: ${field}`);
    }
  });

  test('output contract has v2 new fields', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    const v2Fields = ['cycle_count', 'root_cause', 'evidence', 'lessons_learned',
      'conventions_created', 'tests_suggested', 'guards_cleaned', 'engram_entries'];
    for (const field of v2Fields) {
      assert.ok(content.includes(field), `output contract must contain v2 field: ${field}`);
    }
  });

  test('output contract has status:cycling enum value', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    assert.ok(content.includes('cycling'), 'output contract must include cycling status');
  });

  test('output contract has hard constraints section', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    assert.ok(content.includes('## Hard Constraints'), 'must have Hard Constraints section');
  });

  test('output contract has at least one example', () => {
    const content = fs.readFileSync(path.join(CONTRACTS_DIR, 'output-contract.md'), 'utf8');
    assert.ok(content.includes('## Example'), 'must have at least one example');
  });
});

// ─── enriched_context blocks ─────────────────────────────────────────────────

describe('sdd-debug v2: enriched_context (raw YAML)', () => {
  test('collect-and-diagnose has enriched_context in raw YAML', () => {
    const raw = loadSddDebugYaml();
    assert.ok(
      raw.phases['collect-and-diagnose'].enriched_context !== undefined,
      'collect-and-diagnose must have enriched_context'
    );
    assert.ok(
      Array.isArray(raw.phases['collect-and-diagnose'].enriched_context),
      'enriched_context must be an array'
    );
  });

  test('finalize has enriched_context in raw YAML', () => {
    const raw = loadSddDebugYaml();
    assert.ok(
      raw.phases['finalize'].enriched_context !== undefined,
      'finalize must have enriched_context'
    );
    assert.ok(
      Array.isArray(raw.phases['finalize'].enriched_context),
      'enriched_context must be an array'
    );
  });

  test('collect-and-diagnose enriched_context references area-analysis and guard-registry', () => {
    const raw = loadSddDebugYaml();
    const ec = raw.phases['collect-and-diagnose'].enriched_context;
    const artifactNames = ec.map(e => e.artifact);
    assert.ok(artifactNames.includes('area-analysis'), 'must reference area-analysis');
    assert.ok(artifactNames.includes('guard-registry'), 'must reference guard-registry');
  });

  test('finalize enriched_context references regression-report, guard-registry, area-analysis', () => {
    const raw = loadSddDebugYaml();
    const ec = raw.phases['finalize'].enriched_context;
    const artifactNames = ec.map(e => e.artifact);
    assert.ok(artifactNames.includes('regression-report'), 'must reference regression-report');
    assert.ok(artifactNames.includes('guard-registry'), 'must reference guard-registry');
    assert.ok(artifactNames.includes('area-analysis'), 'must reference area-analysis');
  });
});
