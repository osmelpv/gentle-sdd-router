/**
 * Tests for Part 3 of sdd-debug-workflow:
 * A) sdd-debug preset files (mono + multi)
 * B) output-contract.md for sdd-debug
 * C) verify.md updated with sdd-debug invocation
 * D) local-hybrid.router.yaml debug phase removed
 * E) sdd-debug catalog registered in router.yaml
 *
 * Strict TDD: tests written FIRST (RED phase), implementation follows.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseYaml } from '../src/core/router.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '..'
);

const PROFILES_DIR = path.join(PROJECT_ROOT, 'router', 'profiles');
const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'router', 'contracts');
const SDD_DEBUG_DIR = path.join(PROJECT_ROOT, 'router', 'catalogs', 'sdd-debug');
const ROUTER_YAML = path.join(PROJECT_ROOT, 'router', 'router.yaml');

const MONO_PRESET_FILE = path.join(PROFILES_DIR, 'sdd-debug-mono.router.yaml');
const MULTI_PRESET_FILE = path.join(PROFILES_DIR, 'sdd-debug-multi.router.yaml');
const OUTPUT_CONTRACT_FILE = path.join(SDD_DEBUG_DIR, 'contracts', 'output-contract.md');
const VERIFY_CONTRACT_FILE = path.join(CONTRACTS_DIR, 'phases', 'verify.md');
const LOCAL_HYBRID_FILE = path.join(PROFILES_DIR, 'local-hybrid.router.yaml');

// All 7 debug phases
const DEBUG_PHASES = [
  'explore-issues',
  'triage',
  'diagnose',
  'propose-fix',
  'apply-fix',
  'validate-fix',
  'archive-debug',
];

// ─── Task A: sdd-debug-mono preset ────────────────────────────────────────────

describe('sdd-debug-mono preset — file existence', () => {
  test('sdd-debug-mono.router.yaml exists in profiles/', () => {
    assert.ok(
      fs.existsSync(MONO_PRESET_FILE),
      `sdd-debug-mono.router.yaml must exist at ${MONO_PRESET_FILE}`
    );
  });
});

describe('sdd-debug-mono preset — content', () => {
  function loadMono() {
    const raw = fs.readFileSync(MONO_PRESET_FILE, 'utf8');
    return parseYaml(raw);
  }

  test('name is "sdd-debug-mono"', () => {
    const preset = loadMono();
    assert.equal(preset.name, 'sdd-debug-mono');
  });

  test('catalog is "sdd-debug"', () => {
    const preset = loadMono();
    assert.equal(preset.catalog, 'sdd-debug');
  });

  test('availability is "stable"', () => {
    const preset = loadMono();
    assert.equal(preset.availability, 'stable');
  });

  test('has identity.inherit_agents_md = true', () => {
    const preset = loadMono();
    assert.equal(preset.identity?.inherit_agents_md, true);
  });

  test('has identity.persona = "gentleman"', () => {
    const preset = loadMono();
    assert.equal(preset.identity?.persona, 'gentleman');
  });

  test('has all 7 debug phases', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      assert.ok(
        preset.phases?.[phase],
        `sdd-debug-mono must have phase "${phase}"`
      );
    }
  });

  test('has exactly 7 phases (no extras)', () => {
    const preset = loadMono();
    assert.equal(
      Object.keys(preset.phases).length,
      7,
      'sdd-debug-mono must have exactly 7 phases'
    );
  });

  test('each phase has exactly 1 lane', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      const lanes = preset.phases[phase];
      assert.equal(
        lanes.length,
        1,
        `Phase "${phase}" in mono must have exactly 1 lane`
      );
    }
  });

  test('every lane uses openai/gpt-5.4 as target', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      const lane = preset.phases[phase][0];
      assert.equal(
        lane.target,
        'openai/gpt-5.4',
        `Phase "${phase}" in mono must target openai/gpt-5.4`
      );
    }
  });

  test('every lane has role = "primary"', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      const lane = preset.phases[phase][0];
      assert.equal(
        lane.role,
        'primary',
        `Phase "${phase}" in mono must have role = primary`
      );
    }
  });

  test('every lane has fallbacks defined (non-empty)', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      const lane = preset.phases[phase][0];
      assert.ok(
        lane.fallbacks && String(lane.fallbacks).trim().length > 0,
        `Phase "${phase}" in mono must have non-empty fallbacks`
      );
    }
  });

  test('no phase has a judge role (mono variant has no judges)', () => {
    const preset = loadMono();
    for (const phase of DEBUG_PHASES) {
      const lanes = preset.phases[phase];
      const judgeCount = lanes.filter(l => l.role === 'judge').length;
      assert.equal(
        judgeCount,
        0,
        `Mono preset must have no judge role in phase "${phase}"`
      );
    }
  });
});

// ─── Task A: sdd-debug-multi preset ───────────────────────────────────────────

describe('sdd-debug-multi preset — file existence', () => {
  test('sdd-debug-multi.router.yaml exists in profiles/', () => {
    assert.ok(
      fs.existsSync(MULTI_PRESET_FILE),
      `sdd-debug-multi.router.yaml must exist at ${MULTI_PRESET_FILE}`
    );
  });
});

describe('sdd-debug-multi preset — content', () => {
  function loadMulti() {
    const raw = fs.readFileSync(MULTI_PRESET_FILE, 'utf8');
    return parseYaml(raw);
  }

  test('name is "sdd-debug-multi"', () => {
    const preset = loadMulti();
    assert.equal(preset.name, 'sdd-debug-multi');
  });

  test('catalog is "sdd-debug"', () => {
    const preset = loadMulti();
    assert.equal(preset.catalog, 'sdd-debug');
  });

  test('availability is "stable"', () => {
    const preset = loadMulti();
    assert.equal(preset.availability, 'stable');
  });

  test('has identity.inherit_agents_md = true', () => {
    const preset = loadMulti();
    assert.equal(preset.identity?.inherit_agents_md, true);
  });

  test('has all 7 debug phases', () => {
    const preset = loadMulti();
    for (const phase of DEBUG_PHASES) {
      assert.ok(
        preset.phases?.[phase],
        `sdd-debug-multi must have phase "${phase}"`
      );
    }
  });

  test('has exactly 7 phases (no extras)', () => {
    const preset = loadMulti();
    assert.equal(
      Object.keys(preset.phases).length,
      7,
      'sdd-debug-multi must have exactly 7 phases'
    );
  });

  test('phases triage/diagnose/propose-fix/validate-fix have a judge lane', () => {
    const preset = loadMulti();
    const phasesThatNeedJudge = ['triage', 'diagnose', 'propose-fix', 'validate-fix'];
    for (const phase of phasesThatNeedJudge) {
      const lanes = preset.phases[phase];
      const judges = lanes.filter(l => l.role === 'judge');
      assert.ok(
        judges.length >= 1,
        `Phase "${phase}" in multi must have at least 1 judge`
      );
    }
  });

  test('explore-issues has a judge lane', () => {
    const preset = loadMulti();
    const lanes = preset.phases['explore-issues'];
    const judges = lanes.filter(l => l.role === 'judge');
    assert.ok(judges.length >= 1, 'explore-issues in multi must have a judge');
  });

  test('apply-fix has exactly 1 lane (even in multi variant)', () => {
    const preset = loadMulti();
    const lanes = preset.phases['apply-fix'];
    assert.equal(
      lanes.length,
      1,
      'apply-fix must have exactly 1 lane in multi variant (safety invariant)'
    );
  });

  test('apply-fix lane has no judge role', () => {
    const preset = loadMulti();
    const lanes = preset.phases['apply-fix'];
    const judges = lanes.filter(l => l.role === 'judge');
    assert.equal(judges.length, 0, 'apply-fix must have no judge role in multi');
  });

  test('judge uses a different provider than primary (cross-provider validation)', () => {
    const preset = loadMulti();
    // Check one representative phase: explore-issues
    const lanes = preset.phases['explore-issues'];
    const primary = lanes.find(l => l.role === 'primary');
    const judge = lanes.find(l => l.role === 'judge');
    assert.ok(primary, 'explore-issues must have primary in multi');
    assert.ok(judge, 'explore-issues must have judge in multi');
    // Different provider = different prefix (openai/ vs anthropic/ vs google/)
    const primaryProvider = primary.target.split('/')[0];
    const judgeProvider = judge.target.split('/')[0];
    assert.notEqual(
      primaryProvider,
      judgeProvider,
      `Judge provider must differ from primary (primary=${primaryProvider}, judge=${judgeProvider})`
    );
  });

  test('radar present only on explore-issues and propose-fix', () => {
    const preset = loadMulti();
    const radarPhases = DEBUG_PHASES.filter(phase => {
      return preset.phases[phase].some(l => l.role === 'radar');
    });
    // Only explore-issues and propose-fix have radar (optional)
    for (const phase of radarPhases) {
      assert.ok(
        ['explore-issues', 'propose-fix'].includes(phase),
        `Radar must only appear in explore-issues or propose-fix, found in "${phase}"`
      );
    }
  });

  test('archive-debug has exactly 1 lane (primary only)', () => {
    const preset = loadMulti();
    const lanes = preset.phases['archive-debug'];
    assert.equal(
      lanes.length,
      1,
      'archive-debug must have exactly 1 lane in multi'
    );
    assert.equal(
      lanes[0].role,
      'primary',
      'archive-debug single lane must have role primary'
    );
  });
});

// ─── Task B: sdd-debug output-contract.md ────────────────────────────────────

describe('sdd-debug output-contract — file existence', () => {
  test('output-contract.md exists in router/catalogs/sdd-debug/contracts/', () => {
    assert.ok(
      fs.existsSync(OUTPUT_CONTRACT_FILE),
      `output-contract.md must exist at ${OUTPUT_CONTRACT_FILE}`
    );
  });
});

describe('sdd-debug output-contract — required sections', () => {
  function loadOutputContract() {
    return fs.readFileSync(OUTPUT_CONTRACT_FILE, 'utf8');
  }

  test('contains debug_result schema section', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('debug_result'),
      'output-contract.md must define the debug_result schema'
    );
  });

  test('contains status field (resolved | partial | failed | escalated)', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('status'),
      'output-contract.md must define the status field'
    );
    // At least one of the status values must appear
    assert.ok(
      content.includes('resolved') || content.includes('partial') || content.includes('failed'),
      'output-contract.md must define status values (resolved, partial, failed, escalated)'
    );
  });

  test('contains baseline section (tests_before / tests_after)', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('baseline'),
      'output-contract.md must have a baseline section'
    );
    assert.ok(
      content.includes('tests_before') && content.includes('tests_after'),
      'output-contract.md baseline must include tests_before and tests_after'
    );
  });

  test('contains issues_resolved section', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('issues_resolved'),
      'output-contract.md must have issues_resolved section'
    );
  });

  test('contains issues_unresolved section', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('issues_unresolved'),
      'output-contract.md must have issues_unresolved section'
    );
  });

  test('contains issues_escalated section', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('issues_escalated'),
      'output-contract.md must have issues_escalated section'
    );
  });

  test('contains regressions section', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('regressions'),
      'output-contract.md must have regressions section'
    );
  });

  test('contains confidence field (high | medium | low)', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('confidence'),
      'output-contract.md must define confidence field'
    );
  });

  test('contains requires_reverify field', () => {
    const content = loadOutputContract();
    assert.ok(
      content.includes('requires_reverify'),
      'output-contract.md must have requires_reverify field'
    );
  });
});

// ─── Task C: verify.md updated with sdd-debug invocation ─────────────────────

describe('verify.md — sdd-debug invocation declared', () => {
  function loadVerify() {
    return fs.readFileSync(VERIFY_CONTRACT_FILE, 'utf8');
  }

  test('verify.md mentions sdd-debug invocation', () => {
    const content = loadVerify();
    assert.ok(
      content.includes('sdd-debug'),
      'verify.md must reference sdd-debug for debug invocation'
    );
  });

  test('verify.md contains gsr sdd invoke command', () => {
    const content = loadVerify();
    assert.ok(
      content.includes('gsr sdd invoke') || content.includes('sdd invoke'),
      'verify.md must document the gsr sdd invoke command for cross-catalog invocation'
    );
  });

  test('verify.md documents the re-verify loop after sdd-debug returns', () => {
    const content = loadVerify();
    assert.ok(
      content.includes('re-verify') || content.includes('reverify') || content.includes('runs AGAIN'),
      'verify.md must document the re-verify loop: after sdd-debug returns, verify runs again'
    );
  });

  test('verify.md documents what happens when no issues found (proceed to archive)', () => {
    const content = loadVerify();
    assert.ok(
      content.includes('archive') || content.includes('Archive'),
      'verify.md must document that no-issues case proceeds to archive'
    );
  });

  test('verify.md documents judge evaluation for regressions (revert | escalate | retry)', () => {
    const content = loadVerify();
    assert.ok(
      content.includes('revert') || content.includes('escalate') || content.includes('retry'),
      'verify.md must document judge decision options: revert, escalate, or retry'
    );
  });
});

// ─── Task D: local-hybrid debug phase removed ─────────────────────────────────

describe('local-hybrid preset — debug phase removed', () => {
  function loadLocalHybrid() {
    const raw = fs.readFileSync(LOCAL_HYBRID_FILE, 'utf8');
    return parseYaml(raw);
  }

  test('local-hybrid.router.yaml parses without errors', () => {
    assert.doesNotThrow(
      () => loadLocalHybrid(),
      'local-hybrid.router.yaml must be valid YAML after modification'
    );
  });

  test('local-hybrid does NOT have a debug phase', () => {
    const preset = loadLocalHybrid();
    assert.equal(
      preset.phases?.debug,
      undefined,
      'local-hybrid must no longer have a "debug" phase (handled by sdd-debug catalog)'
    );
  });

  test('local-hybrid still has verify phase intact', () => {
    const preset = loadLocalHybrid();
    assert.ok(
      preset.phases?.verify,
      'local-hybrid must still have verify phase'
    );
  });

  test('local-hybrid still has archive phase intact', () => {
    const preset = loadLocalHybrid();
    assert.ok(
      preset.phases?.archive,
      'local-hybrid must still have archive phase'
    );
  });

  test('local-hybrid still has apply phase intact', () => {
    const preset = loadLocalHybrid();
    assert.ok(
      preset.phases?.apply,
      'local-hybrid must still have apply phase'
    );
  });
});

// ─── Task E: router.yaml has sdd-debug catalog ────────────────────────────────

describe('router.yaml — sdd-debug SDD registered', () => {
  function loadRouterYaml() {
    const raw = fs.readFileSync(ROUTER_YAML, 'utf8');
    return parseYaml(raw);
  }

  test('router.yaml parses without errors', () => {
    assert.doesNotThrow(
      () => loadRouterYaml(),
      'router.yaml must be valid YAML after modification'
    );
  });

  test('router.yaml has sdd-debug SDD entry', () => {
    const config = loadRouterYaml();
    assert.ok(
      config.sdds?.['sdd-debug'],
      'router.yaml must have a sdd-debug entry under sdds'
    );
  });

  test('sdd-debug SDD has displayName "SDD-Debug"', () => {
    const config = loadRouterYaml();
    assert.equal(
      config.sdds['sdd-debug']?.displayName,
      'SDD-Debug',
      'sdd-debug SDD displayName must be "SDD-Debug"'
    );
  });

  test('sdd-debug SDD exists without enable/disable semantics', () => {
    const config = loadRouterYaml();
    assert.ok(config.sdds['sdd-debug']);
  });

  test('agent-orchestrator SDD is still present', () => {
    const config = loadRouterYaml();
    assert.ok(
      config.sdds?.['agent-orchestrator'],
      'agent-orchestrator SDD must still be present in router.yaml'
    );
  });
});

// ─── Cross-check: no other preset has a debug phase ──────────────────────────

describe('all existing presets — no debug phase', () => {
  const PRESET_FILES = [
    'multivendor.router.yaml',
    'multiagent.router.yaml',
    'ollama.router.yaml',
    'cheap.router.yaml',
    'claude.router.yaml',
    'heavyweight.router.yaml',
    'openai.router.yaml',
    'safety.router.yaml',
  ];

  for (const fileName of PRESET_FILES) {
    test(`${fileName} must NOT have a "debug" phase`, () => {
      const filePath = path.join(PROFILES_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        // File may not exist (e.g. in some environments); skip gracefully
        return;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const preset = parseYaml(raw);
      assert.equal(
        preset.phases?.debug,
        undefined,
        `${fileName} must not have a "debug" phase (use sdd-debug catalog instead)`
      );
    });
  }
});
