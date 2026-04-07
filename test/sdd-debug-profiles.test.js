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
const INVOKE_CONFIGS_DIR = path.join(PROJECT_ROOT, 'router', 'invoke_configs');
const ROUTER_YAML_PATH = path.join(PROJECT_ROOT, 'router', 'router.yaml');

function loadPreset(filename) {
  const raw = fs.readFileSync(path.join(PROFILES_DIR, filename), 'utf8');
  return parseYaml(raw);
}

function loadInvokeConfig(filename) {
  const raw = fs.readFileSync(path.join(INVOKE_CONFIGS_DIR, filename), 'utf8');
  return parseYaml(raw);
}

// ─── sdd-debug-mono invoke config ──────────────────────────────────────────────────

describe('sdd-debug-mono preset', () => {
  const mono = loadInvokeConfig('gsr-sdd-debug-mono.yaml');

  test('exists and loads without error', () => {
    assert.ok(mono, 'sdd-debug-mono.router.yaml should load');
  });

  test('has sdd: sdd-debug', () => {
    assert.equal(mono.sdd, 'sdd-debug');
  });

  test('has name: gsr-sdd-debug-mono', () => {
    assert.equal(mono.name, 'gsr-sdd-debug-mono');
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

  test('orchestrator phase is an object with model field (simplified schema)', () => {
    const orchPhase = mono.phases?.orchestrator;
    assert.ok(orchPhase !== null && typeof orchPhase === 'object', 'orchestrator should be an object');
    assert.ok(!Array.isArray(orchPhase), 'orchestrator should NOT be an array (simplified schema)');
    assert.ok(typeof orchPhase.model === 'string', 'orchestrator should have model field');
  });

  test('all phases use openai/gpt-5.4 as model', () => {
    for (const [phaseName, phaseEntry] of Object.entries(mono.phases ?? {})) {
      assert.equal(
        phaseEntry?.model,
        'openai/gpt-5.4',
        `${phaseName} should use openai/gpt-5.4, got: ${phaseEntry?.model}`
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

// ─── sdd-debug-multi invoke config ─────────────────────────────────────────────────

describe('sdd-debug-multi preset', () => {
  const multi = loadInvokeConfig('gsr-sdd-debug-multi.yaml');

  test('exists and loads without error', () => {
    assert.ok(multi, 'sdd-debug-multi.router.yaml should load');
  });

  test('has sdd: sdd-debug', () => {
    assert.equal(multi.sdd, 'sdd-debug');
  });

  test('has name: gsr-sdd-debug-multi', () => {
    assert.equal(multi.name, 'gsr-sdd-debug-multi');
  });

  test('has exactly 4 phase entries', () => {
    const phaseNames = Object.keys(multi.phases ?? {});
    assert.equal(phaseNames.length, 4, `Expected 4 phases, got: ${phaseNames.join(', ')}`);
  });

  test('orchestrator phase is an object with model field (simplified schema)', () => {
    const orchPhase = multi.phases?.orchestrator;
    assert.ok(orchPhase !== null && typeof orchPhase === 'object', 'orchestrator should be an object');
    assert.ok(!Array.isArray(orchPhase), 'orchestrator should NOT be an array (simplified schema)');
    assert.ok(typeof orchPhase.model === 'string', 'orchestrator should have model field');
  });

  test('analyze-area phase has model field (simplified schema)', () => {
    const phase = multi.phases?.['analyze-area'];
    assert.ok(phase !== null && typeof phase === 'object', 'analyze-area should be an object');
    assert.ok(typeof phase.model === 'string', 'analyze-area should have model field');
  });

  test('implant-logs phase has model field (simplified schema)', () => {
    const phase = multi.phases?.['implant-logs'];
    assert.ok(phase !== null && typeof phase === 'object', 'implant-logs should be an object');
    assert.ok(typeof phase.model === 'string', 'implant-logs should have model field');
  });

  test('apply-fixes phase has model field (simplified schema)', () => {
    const phase = multi.phases?.['apply-fixes'];
    assert.ok(phase !== null && typeof phase === 'object', 'apply-fixes should be an object');
    assert.ok(typeof phase.model === 'string', 'apply-fixes should have model field');
  });

  test('all phases use openai/gpt-5.4 as model', () => {
    for (const [phaseName, phaseEntry] of Object.entries(multi.phases ?? {})) {
      assert.equal(
        phaseEntry?.model,
        'openai/gpt-5.4',
        `${phaseName} should use openai/gpt-5.4, got: ${phaseEntry?.model}`
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

describe('All main presets: debug_invoke.profile', () => {
  for (const filename of MAIN_PRESETS_MONO) {
    test(`${filename} debug_invoke.profile equals "gsr-sdd-debug-mono"`, () => {
      const preset = loadPreset(filename);
      assert.equal(
        preset.debug_invoke?.profile,
        'gsr-sdd-debug-mono',
        `${filename} should reference gsr-sdd-debug-mono`
      );
    });
  }

  test('multiagent.router.yaml debug_invoke.profile equals "gsr-sdd-debug-multi"', () => {
    const preset = loadPreset('multiagent.router.yaml');
    assert.equal(
      preset.debug_invoke?.profile,
      'gsr-sdd-debug-multi',
      'multiagent should reference gsr-sdd-debug-multi'
    );
  });

  test('safety.router.yaml debug_invoke.profile equals "gsr-sdd-debug-mono"', () => {
    const preset = loadPreset('safety.router.yaml');
    assert.equal(
      preset.debug_invoke?.profile,
      'gsr-sdd-debug-mono',
      'safety should reference gsr-sdd-debug-mono'
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
// After Phase 3, getGlobalSddAgentSpecs reads debug profile from invoke_configs/
// and returns 3 debug agents (analyze-area, implant-logs, apply-fixes).

describe('getGlobalSddAgentSpecs: v2 integration', () => {
  test('returns standard SDD agents from local-hybrid', () => {
    const specs = getGlobalSddAgentSpecs();
    const standardNames = specs.filter((s) => s.sdd === 'sdd-orchestrator').map((s) => s.name);
    assert.ok(standardNames.includes('sdd-orchestrator'), 'Should have sdd-orchestrator');
    assert.ok(standardNames.includes('sdd-apply'), 'Should have sdd-apply');
    assert.ok(standardNames.includes('sdd-verify'), 'Should have sdd-verify');
  });

  test('getGlobalSddAgentSpecs reads debug profile from invoke_configs/ — returns 3 debug agents (Phase 3 updated)', () => {
    // sdd-debug-mono moved to invoke_configs/gsr-sdd-debug-mono.yaml in Phase 2
    // Phase 3 updated getGlobalSddAgentSpecs to read from invoke_configs/
    const specs = getGlobalSddAgentSpecs();
    const debugSpecs = specs.filter((s) => s.sdd === 'sdd-debug');
    assert.equal(debugSpecs.length, 3, 'getGlobalSddAgentSpecs should return 3 debug agents from invoke_configs/');
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
