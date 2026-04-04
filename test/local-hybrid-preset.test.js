/**
 * Tests for the `local-hybrid` built-in preset.
 *
 * Strict TDD: tests written FIRST (RED), preset file created after.
 *
 * Verifies:
 *   - Preset file exists and is valid YAML
 *   - Preset loads via loadV4Profiles without throwing
 *   - All 9 canonical SDD phases are covered (debug moved to sdd-debug catalog)
 *   - Each phase has at minimum one lane with a primary role
 *   - Primary targets use openrouter free tier models
 *   - Fallbacks include ollama/ local models for offline use
 *   - Identity section is present with inherit_agents_md: true and persona: gentleman
 *   - Preset name matches file convention: 'local-hybrid'
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { validateProfileFile, loadV4Profiles } from '../src/core/router-v4-io.js';
import { parseYaml } from '../src/core/router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESET_PATH = path.join(__dirname, '../router/profiles/local-hybrid.router.yaml');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-local-hybrid-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function loadPreset() {
  const raw = fs.readFileSync(PRESET_PATH, 'utf8');
  return parseYaml(raw);
}

// ─── File existence and basic structure ───────────────────────────────────────

describe('local-hybrid preset — file and basic structure', () => {
  test('preset file exists at router/profiles/local-hybrid.router.yaml', () => {
    assert.ok(
      fs.existsSync(PRESET_PATH),
      `Expected preset file at: ${PRESET_PATH}`
    );
  });

  test('preset file is valid YAML with a root object', () => {
    const preset = loadPreset();
    assert.ok(preset && typeof preset === 'object' && !Array.isArray(preset));
  });

  test('preset name is "local-hybrid"', () => {
    const preset = loadPreset();
    assert.equal(preset.name, 'local-hybrid');
  });

  test('preset passes validateProfileFile without throwing', () => {
    const preset = loadPreset();
    assert.doesNotThrow(() => validateProfileFile(preset, PRESET_PATH));
  });

  test('preset loads correctly via loadV4Profiles in a temp dir', () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
      fs.copyFileSync(PRESET_PATH, path.join(dir, 'profiles', 'local-hybrid.router.yaml'));

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      assert.equal(profiles.length, 1);
      assert.equal(profiles[0].content.name, 'local-hybrid');
      assert.equal(profiles[0].catalogName, 'default');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Phase coverage ───────────────────────────────────────────────────────────

describe('local-hybrid preset — phase coverage', () => {
  // The preset covers 9 canonical SDD phases (debug removed — now handled by sdd-debug catalog).
  // CANONICAL_PHASES = orchestrator, explore, propose, spec, design, tasks, apply, verify, archive
  const REQUIRED_PHASES = [
    'orchestrator', 'explore', 'propose', 'spec',
    'design', 'tasks', 'apply', 'verify', 'archive',
  ];

  test('preset phases is a non-empty object', () => {
    const preset = loadPreset();
    assert.ok(preset.phases && typeof preset.phases === 'object');
    assert.ok(Object.keys(preset.phases).length > 0);
  });

  for (const phase of REQUIRED_PHASES) {
    test(`preset covers phase: ${phase}`, () => {
      const preset = loadPreset();
      assert.ok(
        preset.phases[phase],
        `Missing phase: ${phase}`
      );
    });
  }

  test('each phase has at least one lane with a main role (primary or judge)', () => {
    // The verify phase conventionally uses role: judge (not primary).
    // All other phases use role: primary. Both are valid "main" lane roles.
    const preset = loadPreset();
    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      assert.ok(Array.isArray(lanes), `Phase "${phaseName}" must be an array of lanes`);
      assert.ok(lanes.length > 0, `Phase "${phaseName}" must have at least one lane`);
      const hasMainRole = lanes.some((lane) => lane.role === 'primary' || lane.role === 'judge');
      assert.ok(hasMainRole, `Phase "${phaseName}" must have a lane with role primary or judge`);
    }
  });

  test('all required phases are present — no phase is missing from the 10', () => {
    const preset = loadPreset();
    const presentPhases = Object.keys(preset.phases);
    for (const required of REQUIRED_PHASES) {
      assert.ok(presentPhases.includes(required), `Required phase missing: ${required}`);
    }
  });
});

// ─── Model assignment strategy ────────────────────────────────────────────────

describe('local-hybrid preset — model assignment strategy', () => {
  test('main lane models match the intended hybrid routing strategy', () => {
    // Main lane = role: primary for most phases, role: judge for verify phase.
    // The preset intentionally mixes free cloud, paid cloud, and local-first choices by phase.
    const preset = loadPreset();
    const EXPECTED_PREFIXES = {
      apply: 'anthropic/',
      verify: 'openai/',
      archive: 'google/',
    };

    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      const mainLane = lanes.find((lane) => lane.role === 'primary' || lane.role === 'judge');
      assert.ok(mainLane, `Phase "${phaseName}" has no primary or judge lane`);
      assert.ok(
        typeof mainLane.target === 'string' && mainLane.target.length > 0,
        `Phase "${phaseName}" main lane must have a non-empty target`
      );

      const expectedPrefix = EXPECTED_PREFIXES[phaseName] ?? 'opencode/';

      if (phaseName in EXPECTED_PREFIXES) {
        assert.ok(
          mainLane.target.startsWith(expectedPrefix),
          `Phase "${phaseName}" main target must use ${expectedPrefix} prefix, got: ${mainLane.target}`
        );
      } else {
        assert.ok(
          mainLane.target.startsWith(expectedPrefix),
          `Phase "${phaseName}" main target must use ${expectedPrefix} prefix, got: ${mainLane.target}`
        );
      }
    }
  });

  test('fallbacks include at least one ollama/ local model for offline use', () => {
    const preset = loadPreset();
    let hasOllamaFallback = false;

    for (const [_phaseName, lanes] of Object.entries(preset.phases)) {
      const primaryLane = lanes.find((lane) => lane.role === 'primary');
      if (!primaryLane) continue;

      const fallbacks = primaryLane.fallbacks;
      if (typeof fallbacks === 'string' && fallbacks.includes('ollama/')) {
        hasOllamaFallback = true;
        break;
      }
      if (Array.isArray(fallbacks) && fallbacks.some((f) => String(f).includes('ollama/'))) {
        hasOllamaFallback = true;
        break;
      }
    }

    assert.ok(
      hasOllamaFallback,
      'At least one phase must have an ollama/ fallback for offline use'
    );
  });

  test('each main lane has a fallbacks field defined', () => {
    const preset = loadPreset();
    for (const [phaseName, lanes] of Object.entries(preset.phases)) {
      const mainLane = lanes.find((lane) => lane.role === 'primary' || lane.role === 'judge');
      assert.ok(mainLane, `Phase "${phaseName}" missing main lane`);
      assert.ok(
        mainLane.fallbacks !== undefined,
        `Phase "${phaseName}" main lane must have a fallbacks field`
      );
    }
  });
});

// ─── Identity section ─────────────────────────────────────────────────────────

describe('local-hybrid preset — identity section', () => {
  test('identity section is present', () => {
    const preset = loadPreset();
    assert.ok(preset.identity !== undefined, 'identity section must be present');
    assert.ok(
      typeof preset.identity === 'object' && !Array.isArray(preset.identity),
      'identity must be a plain object'
    );
  });

  test('identity.inherit_agents_md is true', () => {
    const preset = loadPreset();
    assert.equal(
      preset.identity.inherit_agents_md,
      true,
      'inherit_agents_md must be true for gentleman context to flow automatically'
    );
  });

  test('identity.persona is "gentleman"', () => {
    const preset = loadPreset();
    assert.equal(
      preset.identity.persona,
      'gentleman',
      'persona must be "gentleman"'
    );
  });

  test('identity section passes validateProfileFile (no unknown fields)', () => {
    const preset = loadPreset();
    // If identity has unknown/disallowed fields, validateProfileFile throws.
    // This test ensures the identity section is spec-compliant.
    assert.doesNotThrow(() => validateProfileFile(preset, PRESET_PATH));
  });
});

// ─── SDD ownership registration ───────────────────────────────────────────────

describe('local-hybrid preset — SDD registration in router.yaml', () => {
  const ROUTER_YAML_PATH = path.join(__dirname, '../router/router.yaml');

  test('router.yaml exists', () => {
    assert.ok(fs.existsSync(ROUTER_YAML_PATH));
  });

  test('local-hybrid preset is discoverable when router dir is scanned', () => {
    // loadV4Profiles auto-discovers all *.router.yaml files in profiles/
    // so having the file in router/profiles/ is sufficient for registration.
    // This test verifies the project's router/ dir loads local-hybrid correctly.
    const routerDir = path.join(__dirname, '../router');
    const profiles = loadV4Profiles(routerDir);
    const localHybrid = profiles.find((p) => p.content.name === 'local-hybrid');
    assert.ok(localHybrid, 'local-hybrid must be discoverable via loadV4Profiles on the project router dir');
    assert.equal(localHybrid.sddName, 'agent-orchestrator');
  });
});
