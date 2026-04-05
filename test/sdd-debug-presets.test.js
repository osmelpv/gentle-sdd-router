/**
 * Tests for sdd-debug v2 preset files (Phase 3).
 *
 * Validates:
 * - sdd-debug-mono: 4 phase entries, sdd: sdd-debug, all use openai/gpt-5.4
 * - sdd-debug-multi: multi-agent composition with primary+secondary+judge
 * - All 9 main presets: debug_invoke.preset references
 * - router.yaml: no sdd-debug-by-logs
 * - global-sdd-agent-routing.js: v2 phase mapping
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseYaml } from '../src/core/router.js';
import { getGlobalSddAgentSpecs, DEBUG_PHASE_ROLE_NAMES } from '../src/core/global-sdd-agent-routing.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '..'
);

const PROFILES_DIR = path.join(PROJECT_ROOT, 'router', 'profiles');
const ROUTER_YAML_PATH = path.join(PROJECT_ROOT, 'router', 'router.yaml');

function loadPreset(filename) {
  const raw = fs.readFileSync(path.join(PROFILES_DIR, filename), 'utf8');
  return parseYaml(raw);
}

// ─── sdd-debug-mono preset ──────────────────────────────────────────────────

describe('sdd-debug-mono preset', () => {
  const mono = loadPreset('sdd-debug-mono.router.yaml');

  test('exists and loads without error', () => {
    assert.ok(mono, 'sdd-debug-mono.router.yaml should load');
  });

  test('has sdd: sdd-debug', () => {
    assert.equal(mono.sdd, 'sdd-debug');
  });

  test('has name: sdd-debug-mono', () => {
    assert.equal(mono.name, 'sdd-debug-mono');
  });

  test('has availability: stable', () => {
    assert.equal(mono.availability, 'stable');
  });

  test('has exactly 4 phase entries', () => {
    const phaseNames = Object.keys(mono.phases ?? {});
    assert.equal(phaseNames.length, 4, `Expected 4 phases, got: ${phaseNames.join(', ')}`);
  });

  test('has orchestrator, analyze-area, implant-logs, apply-fixes phases', () => {
    const expected = ['orchestrator', 'analyze-area', 'implant-logs', 'apply-fixes'];
    for (const phase of expected) {
      assert.ok(mono.phases?.[phase], `Missing phase: ${phase}`);
    }
  });

  test('orchestrator is declared exactly ONCE', () => {
    const orchLanes = mono.phases?.orchestrator;
    assert.ok(Array.isArray(orchLanes), 'orchestrator should be an array');
    assert.equal(orchLanes.length, 1, 'orchestrator should have exactly 1 lane');
  });

  test('all phases use openai/gpt-5.4 as primary target', () => {
    for (const [phaseName, lanes] of Object.entries(mono.phases ?? {})) {
      const primary = lanes?.find((l) => l.role === 'primary') ?? lanes?.[0];
      assert.equal(
        primary?.target,
        'openai/gpt-5.4',
        `${phaseName} primary should use openai/gpt-5.4, got: ${primary?.target}`
      );
    }
  });

  test('does NOT have debug_invoke (no recursion)', () => {
    assert.equal(mono.debug_invoke, undefined, 'sdd-debug-mono must NOT have debug_invoke');
  });

  test('has identity with inherit_agents_md: true', () => {
    assert.equal(mono.identity?.inherit_agents_md, true);
  });
});

// ─── sdd-debug-multi preset ─────────────────────────────────────────────────

describe('sdd-debug-multi preset', () => {
  const multi = loadPreset('sdd-debug-multi.router.yaml');

  test('exists and loads without error', () => {
    assert.ok(multi, 'sdd-debug-multi.router.yaml should load');
  });

  test('has sdd: sdd-debug', () => {
    assert.equal(multi.sdd, 'sdd-debug');
  });

  test('has name: sdd-debug-multi', () => {
    assert.equal(multi.name, 'sdd-debug-multi');
  });

  test('has exactly 4 phase entries', () => {
    const phaseNames = Object.keys(multi.phases ?? {});
    assert.equal(phaseNames.length, 4, `Expected 4 phases, got: ${phaseNames.join(', ')}`);
  });

  test('orchestrator has multi-agent composition (2 lanes)', () => {
    const orchLanes = multi.phases?.orchestrator;
    assert.ok(Array.isArray(orchLanes));
    assert.equal(orchLanes.length, 2, 'orchestrator should have primary + secondary');
  });

  test('analyze-area has multi-agent composition (2 lanes)', () => {
    const lanes = multi.phases?.['analyze-area'];
    assert.ok(Array.isArray(lanes));
    assert.equal(lanes.length, 2, 'analyze-area should have primary + secondary');
  });

  test('implant-logs has single lane (mono within multi)', () => {
    const lanes = multi.phases?.['implant-logs'];
    assert.ok(Array.isArray(lanes));
    assert.equal(lanes.length, 1, 'implant-logs should have 1 lane');
  });

  test('apply-fixes has multi-agent composition with judge role', () => {
    const lanes = multi.phases?.['apply-fixes'];
    assert.ok(Array.isArray(lanes));
    assert.equal(lanes.length, 2, 'apply-fixes should have primary + judge');
    const judge = lanes.find((l) => l.role === 'judge');
    assert.ok(judge, 'apply-fixes should have a judge lane');
  });

  test('all primary targets use openai/gpt-5.4', () => {
    for (const [phaseName, lanes] of Object.entries(multi.phases ?? {})) {
      const primary = lanes?.find((l) => l.role === 'primary');
      assert.equal(
        primary?.target,
        'openai/gpt-5.4',
        `${phaseName} primary should use openai/gpt-5.4, got: ${primary?.target}`
      );
    }
  });

  test('does NOT have debug_invoke (no recursion)', () => {
    assert.equal(multi.debug_invoke, undefined, 'sdd-debug-multi must NOT have debug_invoke');
  });
});

// ─── All 9 main presets: debug_invoke.preset references ─────────────────────

const MAIN_PRESETS_MONO = [
  'local-hybrid.router.yaml',
  'multivendor.router.yaml',
  'cheap.router.yaml',
  'claude.router.yaml',
  'heavyweight.router.yaml',
  'ollama.router.yaml',
  'openai.router.yaml',
];

describe('All main presets: debug_invoke.preset', () => {
  for (const filename of MAIN_PRESETS_MONO) {
    test(`${filename} debug_invoke.preset equals "sdd-debug-mono"`, () => {
      const preset = loadPreset(filename);
      assert.equal(
        preset.debug_invoke?.preset,
        'sdd-debug-mono',
        `${filename} should reference sdd-debug-mono`
      );
    });
  }

  test('multiagent.router.yaml debug_invoke.preset equals "sdd-debug-multi"', () => {
    const preset = loadPreset('multiagent.router.yaml');
    assert.equal(
      preset.debug_invoke?.preset,
      'sdd-debug-multi',
      'multiagent should reference sdd-debug-multi'
    );
  });

  test('safety.router.yaml debug_invoke.preset equals "sdd-debug-mono"', () => {
    const preset = loadPreset('safety.router.yaml');
    assert.equal(
      preset.debug_invoke?.preset,
      'sdd-debug-mono',
      'safety should reference sdd-debug-mono'
    );
  });

  test('safety.router.yaml debug_invoke.trigger equals "never"', () => {
    const preset = loadPreset('safety.router.yaml');
    assert.equal(preset.debug_invoke?.trigger, 'never');
  });
});

// ─── router.yaml: no sdd-debug-by-logs ──────────────────────────────────────

describe('router.yaml: sdd-debug-by-logs removed', () => {
  test('router.yaml does not reference sdd-debug-by-logs', () => {
    const raw = fs.readFileSync(ROUTER_YAML_PATH, 'utf8');
    assert.ok(
      !raw.includes('sdd-debug-by-logs'),
      'router.yaml must not contain sdd-debug-by-logs'
    );
  });

  test('router.yaml still references sdd-debug', () => {
    const raw = fs.readFileSync(ROUTER_YAML_PATH, 'utf8');
    assert.ok(
      raw.includes('sdd-debug'),
      'router.yaml must still contain sdd-debug'
    );
  });
});

// ─── global-sdd-agent-routing: v2 phase mapping ─────────────────────────────

describe('global-sdd-agent-routing: v2 debug phase mapping', () => {
  test('DEBUG_PHASE_ROLE_NAMES has exactly 3 entries (delegated phases only)', () => {
    const keys = Object.keys(DEBUG_PHASE_ROLE_NAMES);
    assert.equal(keys.length, 3, `Expected 3 entries, got: ${keys.join(', ')}`);
  });

  test('DEBUG_PHASE_ROLE_NAMES maps analyze-area → debug-analyst', () => {
    assert.equal(DEBUG_PHASE_ROLE_NAMES['analyze-area'], 'debug-analyst');
  });

  test('DEBUG_PHASE_ROLE_NAMES maps implant-logs → log-implanter', () => {
    assert.equal(DEBUG_PHASE_ROLE_NAMES['implant-logs'], 'log-implanter');
  });

  test('DEBUG_PHASE_ROLE_NAMES maps apply-fixes → fix-implementer', () => {
    assert.equal(DEBUG_PHASE_ROLE_NAMES['apply-fixes'], 'fix-implementer');
  });

  test('DEBUG_PHASE_ROLE_NAMES does NOT contain old v1 phase names', () => {
    const oldPhases = ['explore-issues', 'triage', 'diagnose', 'propose-fix', 'apply-fix', 'validate-fix', 'archive-debug'];
    for (const old of oldPhases) {
      assert.equal(DEBUG_PHASE_ROLE_NAMES[old], undefined, `Should not contain old phase: ${old}`);
    }
  });
});

// ─── global-sdd-agent-routing: getGlobalSddAgentSpecs integration ────────────

describe('getGlobalSddAgentSpecs: v2 integration', () => {
  test('returns standard SDD agents from local-hybrid', () => {
    const specs = getGlobalSddAgentSpecs();
    const standardNames = specs.filter((s) => s.sdd === 'sdd-orchestrator').map((s) => s.name);
    assert.ok(standardNames.includes('sdd-orchestrator'), 'Should have sdd-orchestrator');
    assert.ok(standardNames.includes('sdd-apply'), 'Should have sdd-apply');
    assert.ok(standardNames.includes('sdd-verify'), 'Should have sdd-verify');
  });

  test('returns debug agents from sdd-debug-mono', () => {
    const specs = getGlobalSddAgentSpecs();
    const debugNames = specs.filter((s) => s.sdd === 'sdd-debug').map((s) => s.name);
    assert.ok(debugNames.includes('sdd-debug-analyze-area'), 'Should have sdd-debug-analyze-area');
    assert.ok(debugNames.includes('sdd-debug-implant-logs'), 'Should have sdd-debug-implant-logs');
    assert.ok(debugNames.includes('sdd-debug-apply-fixes'), 'Should have sdd-debug-apply-fixes');
  });

  test('debug agents use openai/gpt-5.4 as target', () => {
    const specs = getGlobalSddAgentSpecs();
    const debugSpecs = specs.filter((s) => s.sdd === 'sdd-debug');
    for (const spec of debugSpecs) {
      assert.equal(spec.target, 'openai/gpt-5.4', `${spec.name} should target openai/gpt-5.4`);
    }
  });

  test('exactly 3 debug agents (delegated phases only)', () => {
    const specs = getGlobalSddAgentSpecs();
    const debugSpecs = specs.filter((s) => s.sdd === 'sdd-debug');
    assert.equal(debugSpecs.length, 3, `Expected 3 debug agents, got ${debugSpecs.length}`);
  });

  test('standard SDD agents work independently when debug preset is missing', () => {
    // Pass a non-existent debug preset — should NOT throw
    const specs = getGlobalSddAgentSpecs({ debugPreset: 'nonexistent-preset' });
    const standardNames = specs.filter((s) => s.sdd === 'sdd-orchestrator').map((s) => s.name);
    assert.ok(standardNames.length > 0, 'Standard agents should still load');
    const debugSpecs = specs.filter((s) => s.sdd === 'sdd-debug');
    assert.equal(debugSpecs.length, 0, 'No debug agents when preset is missing');
  });
});
