/**
 * test/profile-write.test.js — Phase 7: Write-path round-trip tests
 *
 * Task 7.3: Round-trip tests
 * - Profile with old lane array format → write to disk → read back → simplified schema
 * - Core config with active_preset → write → read back → no active_preset, no active_catalog
 *
 * Uses real temp directories (node:os tmpdir). Never writes to router/ directory.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { buildV4WritePlan, assembleV4Config, loadV4Profiles, normalizePhaseForWrite } from '../src/core/router-v4-io.js';
import { parseYaml, stringifyYaml } from '../src/core/router.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-profile-write-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

/**
 * Execute the write plan: write profiles + core to a temp router dir.
 * This simulates what saveV4Config does in index.js.
 */
function executePlan(plan, routerDir, routerYamlPath) {
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  for (const pw of plan.profileWrites) {
    const profilePath = pw.filePath ?? path.join(profilesDir, `${pw.presetName}.router.yaml`);
    const profileDir = path.dirname(profilePath);
    fs.mkdirSync(profileDir, { recursive: true });
    const yaml = stringifyYaml(pw.content);
    const tmp = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, yaml, 'utf8');
    fs.renameSync(tmp, profilePath);
  }

  if (plan.coreChanged) {
    const coreToWrite = Object.fromEntries(
      Object.entries(plan.coreContent).filter(([, v]) => v !== undefined)
    );
    const coreYaml = stringifyYaml(coreToWrite);
    const tmp = `${routerYamlPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, coreYaml, 'utf8');
    fs.renameSync(tmp, routerYamlPath);
  }
}

// ── Lane array profile YAML fixtures ─────────────────────────────────────────

const LANE_ARRAY_PROFILE_YAML = `name: multivendor
sdd: agent-orchestrator
availability: stable
phases:
  orchestrator:
    - target: anthropic/claude-opus
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: openai/gpt-5
      inputPerMillion: 15
      outputPerMillion: 75
      contextWindow: 200000
  apply:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: apply
      role: primary
      fallbacks: openai/gpt-5, mistral/codestral-latest
      inputPerMillion: 3
      outputPerMillion: 15
      contextWindow: 200000
`;

const SIMPLIFIED_PROFILE_YAML = `name: local-hybrid
sdd: agent-orchestrator
availability: stable
visible: true
builtin: true
phases:
  orchestrator:
    model: anthropic/claude-sonnet-4-6
    fallbacks:
      - mistral/mistral-large-3
  apply:
    model: anthropic/claude-sonnet-4-6
    fallbacks:
      - mistral/codestral-latest
`;

// ── Task 7.1: Core config write — strip active_preset and active_catalog ─────

describe('buildV4WritePlan — coreContent strips active_preset and active_catalog', () => {
  test('coreContent does NOT contain active_preset', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      assert.ok(plan.coreContent, 'plan has coreContent');
      assert.ok(!('active_preset' in plan.coreContent), 'active_preset must NOT be in coreContent');
    } finally {
      cleanup(dir);
    }
  });

  test('coreContent does NOT contain active_catalog', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_catalog: 'default',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      assert.ok(!('active_catalog' in plan.coreContent), 'active_catalog must NOT be in coreContent');
    } finally {
      cleanup(dir);
    }
  });

  test('coreContent preserves active_sdd', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      assert.equal(plan.coreContent.active_sdd, 'agent-orchestrator', 'active_sdd preserved');
    } finally {
      cleanup(dir);
    }
  });

  test('coreContent preserves version and activation_state', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      assert.equal(plan.coreContent.version, 5, 'version preserved');
      assert.equal(plan.coreContent.activation_state, 'active', 'activation_state preserved');
    } finally {
      cleanup(dir);
    }
  });

  test('coreContent preserves sdds section', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
        sdds: { 'agent-orchestrator': { displayName: 'SDD-Orchestrator' } },
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      assert.ok(plan.coreContent.sdds, 'sdds section preserved');
      assert.equal(plan.coreContent.sdds['agent-orchestrator'].displayName, 'SDD-Orchestrator');
    } finally {
      cleanup(dir);
    }
  });
});

// ── Task 7.1 round-trip: write + read back — no active_preset in YAML ────────

describe('core config round-trip — active_preset not written to disk', () => {
  test('written router.yaml does not contain active_preset', () => {
    const dir = makeTempDir();
    const routerYamlPath = path.join(dir, 'router.yaml');

    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      executePlan(plan, dir, routerYamlPath);

      assert.ok(fs.existsSync(routerYamlPath), 'router.yaml written');
      const writtenYaml = fs.readFileSync(routerYamlPath, 'utf8');
      assert.ok(!writtenYaml.includes('active_preset'), `written YAML must NOT contain active_preset. Got:\n${writtenYaml}`);
    } finally {
      cleanup(dir);
    }
  });

  test('written router.yaml does not contain active_catalog', () => {
    const dir = makeTempDir();
    const routerYamlPath = path.join(dir, 'router.yaml');

    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        active_catalog: 'default',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      executePlan(plan, dir, routerYamlPath);

      const writtenYaml = fs.readFileSync(routerYamlPath, 'utf8');
      assert.ok(!writtenYaml.includes('active_catalog'), `written YAML must NOT contain active_catalog. Got:\n${writtenYaml}`);
    } finally {
      cleanup(dir);
    }
  });

  test('written router.yaml contains active_sdd and version', () => {
    const dir = makeTempDir();
    const routerYamlPath = path.join(dir, 'router.yaml');

    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      executePlan(plan, dir, routerYamlPath);

      const writtenYaml = fs.readFileSync(routerYamlPath, 'utf8');
      assert.ok(writtenYaml.includes('active_sdd'), 'active_sdd present in written YAML');
      assert.ok(writtenYaml.includes('version:'), 'version present in written YAML');
    } finally {
      cleanup(dir);
    }
  });
});

// ── Task 7.2: normalizePhaseForWrite — pure function ─────────────────────────

describe('normalizePhaseForWrite', () => {
  test('lane array with single model converts to {model, fallbacks}', () => {
    const laneArray = [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'openai/gpt-5',
        inputPerMillion: 15,
        outputPerMillion: 75,
        contextWindow: 200000,
      },
    ];

    const result = normalizePhaseForWrite(laneArray);

    assert.equal(result.model, 'anthropic/claude-opus', 'model extracted from target');
    assert.ok(Array.isArray(result.fallbacks), 'fallbacks is an array');
    assert.equal(result.fallbacks[0], 'openai/gpt-5', 'fallback extracted from CSV');
  });

  test('normalized result does not contain kind, role, phase, inputPerMillion, outputPerMillion, contextWindow', () => {
    const laneArray = [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
        fallbacks: 'openai/gpt-5',
        inputPerMillion: 15,
        outputPerMillion: 75,
        contextWindow: 200000,
      },
    ];

    const result = normalizePhaseForWrite(laneArray);

    assert.ok(!('kind' in result), 'kind stripped');
    assert.ok(!('role' in result), 'role stripped');
    assert.ok(!('phase' in result), 'phase stripped');
    assert.ok(!('inputPerMillion' in result), 'inputPerMillion stripped');
    assert.ok(!('outputPerMillion' in result), 'outputPerMillion stripped');
    assert.ok(!('contextWindow' in result), 'contextWindow stripped');
    assert.ok(!('target' in result), 'target (renamed to model) stripped from result');
  });

  test('lane array with comma-separated fallbacks produces array of model strings', () => {
    const laneArray = [
      {
        target: 'anthropic/claude-sonnet',
        kind: 'lane',
        phase: 'apply',
        role: 'primary',
        fallbacks: 'openai/gpt-5, mistral/codestral-latest',
      },
    ];

    const result = normalizePhaseForWrite(laneArray);

    assert.deepEqual(result.fallbacks, ['openai/gpt-5', 'mistral/codestral-latest']);
  });

  test('already-simplified schema {model, fallbacks} is preserved as-is', () => {
    const simplified = {
      model: 'anthropic/claude-sonnet-4-6',
      fallbacks: ['mistral/mistral-large-3'],
    };

    const result = normalizePhaseForWrite(simplified);

    assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
    assert.deepEqual(result.fallbacks, ['mistral/mistral-large-3']);
  });

  test('phase without fallbacks produces result without fallbacks key', () => {
    const laneArray = [
      {
        target: 'anthropic/claude-opus',
        kind: 'lane',
        phase: 'orchestrator',
        role: 'primary',
      },
    ];

    const result = normalizePhaseForWrite(laneArray);

    assert.equal(result.model, 'anthropic/claude-opus');
    assert.ok(!('fallbacks' in result), 'fallbacks omitted when empty');
  });
});

// ── Task 7.2: Profile write path — phases normalized on write ─────────────────

describe('buildV4WritePlan — profile phases normalized to simplified schema on write', () => {
  test('profile with lane array phases: written content has simplified phase schema', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      const profileWrite = plan.profileWrites.find(pw => pw.presetName === 'multivendor');
      assert.ok(profileWrite, 'multivendor profile in write plan');

      const orchestratorPhase = profileWrite.content.phases?.orchestrator;
      assert.ok(orchestratorPhase, 'orchestrator phase present');
      assert.ok(!Array.isArray(orchestratorPhase), 'orchestrator phase is NOT an array (simplified)');
      assert.equal(orchestratorPhase.model, 'anthropic/claude-opus', 'model extracted from target');
    } finally {
      cleanup(dir);
    }
  });

  test('profile write does not contain kind, role, phase, inputPerMillion, outputPerMillion, contextWindow', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      const profileWrite = plan.profileWrites.find(pw => pw.presetName === 'multivendor');
      const yaml = stringifyYaml(profileWrite.content);

      assert.ok(!yaml.includes('kind:'), 'kind not in written YAML');
      assert.ok(!yaml.includes('role:'), 'role not in written YAML');
      assert.ok(!yaml.includes('inputPerMillion:'), 'inputPerMillion not in written YAML');
      assert.ok(!yaml.includes('outputPerMillion:'), 'outputPerMillion not in written YAML');
      assert.ok(!yaml.includes('contextWindow:'), 'contextWindow not in written YAML');
    } finally {
      cleanup(dir);
    }
  });

  test('visible flag is preserved in written profile content', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/local-hybrid.router.yaml', SIMPLIFIED_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      const profileWrite = plan.profileWrites.find(pw => pw.presetName === 'local-hybrid');
      assert.ok(profileWrite, 'local-hybrid in write plan');
      assert.equal(profileWrite.content.visible, true, 'visible: true preserved');
    } finally {
      cleanup(dir);
    }
  });

  test('builtin flag is preserved in written profile content', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/local-hybrid.router.yaml', SIMPLIFIED_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);

      const profileWrite = plan.profileWrites.find(pw => pw.presetName === 'local-hybrid');
      assert.equal(profileWrite.content.builtin, true, 'builtin: true preserved');
    } finally {
      cleanup(dir);
    }
  });
});

// ── Task 7.3: Full round-trip test (write disk, read back) ────────────────────

describe('profile write+read round-trip — simplified schema on disk', () => {
  test('profile with lane array format: round-trip produces simplified schema {model, fallbacks}', () => {
    const dir = makeTempDir();

    try {
      // Write profile with lane array format to disk
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);

      // Assemble config from the lane array format profile
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);

      // Build write plan and execute it
      const plan = buildV4WritePlan(null, config);
      const routerYamlPath = path.join(dir, 'router.yaml');
      executePlan(plan, dir, routerYamlPath);

      // Read back the written profile YAML from disk
      const writtenYaml = fs.readFileSync(path.join(dir, 'profiles', 'multivendor.router.yaml'), 'utf8');
      const readBack = parseYaml(writtenYaml);

      // Phases must be in simplified format (objects, not arrays)
      assert.ok(readBack.phases?.orchestrator, 'orchestrator phase present');
      assert.ok(!Array.isArray(readBack.phases.orchestrator), 'orchestrator is NOT an array');
      assert.equal(readBack.phases.orchestrator.model, 'anthropic/claude-opus', 'model field present');
      assert.ok(Array.isArray(readBack.phases.orchestrator.fallbacks), 'fallbacks is array');
      assert.equal(readBack.phases.orchestrator.fallbacks[0], 'openai/gpt-5');
    } finally {
      cleanup(dir);
    }
  });

  test('round-trip profile: no kind, role, phase, inputPerMillion, outputPerMillion, contextWindow in YAML', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);
      const routerYamlPath = path.join(dir, 'router.yaml');
      executePlan(plan, dir, routerYamlPath);

      const writtenYaml = fs.readFileSync(path.join(dir, 'profiles', 'multivendor.router.yaml'), 'utf8');
      assert.ok(!writtenYaml.includes('kind:'), 'kind stripped from YAML');
      assert.ok(!writtenYaml.includes('inputPerMillion:'), 'inputPerMillion stripped');
      assert.ok(!writtenYaml.includes('outputPerMillion:'), 'outputPerMillion stripped');
      assert.ok(!writtenYaml.includes('contextWindow:'), 'contextWindow stripped');
    } finally {
      cleanup(dir);
    }
  });

  test('round-trip core config: router.yaml has no active_preset, has active_sdd', () => {
    const dir = makeTempDir();
    const routerYamlPath = path.join(dir, 'router.yaml');

    try {
      writeFile(dir, 'profiles/multivendor.router.yaml', LANE_ARRAY_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        active_preset: 'multivendor',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);
      executePlan(plan, dir, routerYamlPath);

      // Read back router.yaml directly
      const writtenCore = parseYaml(fs.readFileSync(routerYamlPath, 'utf8'));

      assert.ok(!('active_preset' in writtenCore), 'active_preset NOT in read-back core YAML');
      assert.ok(!('active_catalog' in writtenCore), 'active_catalog NOT in read-back core YAML');
      assert.equal(writtenCore.active_sdd, 'agent-orchestrator', 'active_sdd preserved');
      assert.equal(writtenCore.version, 5, 'version preserved');
    } finally {
      cleanup(dir);
    }
  });

  test('visible flag survives round-trip for profile file', () => {
    const dir = makeTempDir();
    const routerYamlPath = path.join(dir, 'router.yaml');

    try {
      writeFile(dir, 'profiles/local-hybrid.router.yaml', SIMPLIFIED_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const coreConfig = {
        version: 5,
        active_sdd: 'agent-orchestrator',
        activation_state: 'active',
      };
      const config = assembleV4Config(coreConfig, profiles);
      const plan = buildV4WritePlan(null, config);
      executePlan(plan, dir, routerYamlPath);

      const writtenYaml = fs.readFileSync(path.join(dir, 'profiles', 'local-hybrid.router.yaml'), 'utf8');
      const readBack = parseYaml(writtenYaml);

      assert.equal(readBack.visible, true, 'visible: true survives round-trip');
      assert.equal(readBack.builtin, true, 'builtin: true survives round-trip');
    } finally {
      cleanup(dir);
    }
  });
});
