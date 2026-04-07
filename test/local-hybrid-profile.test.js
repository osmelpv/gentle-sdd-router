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
 *   - Primary targets use a mix of anthropic/, opencode/, openai/, and opencode-go/ models
 *   - Fallbacks include multi-vendor diversity for resilience
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

  test('each phase has a model assigned (simplified schema or lane array)', () => {
    // Phase 7: phases use simplified schema {model, fallbacks?} — no lane array required.
    // The model field replaces the old lane.target field.
    const preset = loadPreset();
    for (const [phaseName, phaseEntry] of Object.entries(preset.phases)) {
      if (Array.isArray(phaseEntry)) {
        // Old lane array format (backward compat)
        assert.ok(phaseEntry.length > 0, `Phase "${phaseName}" must have at least one lane`);
        const hasMainRole = phaseEntry.some((lane) => lane.role === 'primary' || lane.role === 'judge');
        assert.ok(hasMainRole, `Phase "${phaseName}" must have a lane with role primary or judge`);
      } else {
        // Simplified schema
        assert.ok(phaseEntry && typeof phaseEntry === 'object', `Phase "${phaseName}" must be an object`);
        assert.ok(typeof phaseEntry.model === 'string' && phaseEntry.model.length > 0, `Phase "${phaseName}" must have a non-empty model`);
      }
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
    // Phase 7: profiles use simplified schema {model, fallbacks?}.
    // The model field replaces the old lane.target.
    const preset = loadPreset();
    const EXPECTED_PREFIXES = {
      orchestrator: 'anthropic/',
      explore: 'opencode/',
      propose: 'opencode/',
      spec: 'opencode/',
      design: 'anthropic/',
      tasks: 'opencode/',
      apply: 'anthropic/',
      verify: 'openai/',
      archive: 'opencode-go/',
    };

    for (const [phaseName, phaseEntry] of Object.entries(preset.phases)) {
      // Extract model: simplified schema uses .model, lane array uses lanes[0].target
      const mainModel = Array.isArray(phaseEntry)
        ? (phaseEntry.find((l) => l.role === 'primary' || l.role === 'judge') ?? phaseEntry[0])?.target
        : phaseEntry?.model;

      assert.ok(
        typeof mainModel === 'string' && mainModel.length > 0,
        `Phase "${phaseName}" must have a non-empty model/target`
      );

      const expectedPrefix = EXPECTED_PREFIXES[phaseName];
      assert.ok(
        expectedPrefix,
        `Phase "${phaseName}" must have an expected prefix defined`
      );
      assert.ok(
        mainModel.startsWith(expectedPrefix),
        `Phase "${phaseName}" main model must use ${expectedPrefix} prefix, got: ${mainModel}`
      );
    }
  });

  test('fallbacks include multi-vendor diversity for resilience', () => {
    const preset = loadPreset();
    const allFallbackProviders = new Set();

    for (const [_phaseName, phaseEntry] of Object.entries(preset.phases)) {
      // Extract fallbacks: simplified schema has .fallbacks array, lane array uses lane.fallbacks
      const fallbacks = Array.isArray(phaseEntry)
        ? (phaseEntry.find((l) => l.role === 'primary' || l.role === 'judge') ?? phaseEntry[0])?.fallbacks
        : phaseEntry?.fallbacks;

      const fallbackArr = Array.isArray(fallbacks) ? fallbacks : (typeof fallbacks === 'string' ? fallbacks.split(',') : []);
      const providers = fallbackArr.map((f) => String(f).trim().split('/')[0]).filter(Boolean);
      for (const p of providers) allFallbackProviders.add(p);
    }

    assert.ok(
      allFallbackProviders.size >= 3,
      `Fallbacks must span at least 3 providers for resilience, got: ${[...allFallbackProviders].join(', ')}`
    );
  });

  test('each phase has a fallbacks field defined', () => {
    // Phase 7: simplified schema {model, fallbacks?} — fallbacks may be an array or omitted.
    const preset = loadPreset();
    for (const [phaseName, phaseEntry] of Object.entries(preset.phases)) {
      const fallbacks = Array.isArray(phaseEntry)
        ? (phaseEntry.find((l) => l.role === 'primary' || l.role === 'judge') ?? phaseEntry[0])?.fallbacks
        : phaseEntry?.fallbacks;
      assert.ok(
        fallbacks !== undefined,
        `Phase "${phaseName}" must have a fallbacks field`
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
