/**
 * Contract tests for manifest v2 generation.
 * Tests verify:
 *   - version: 1 when no custom SDDs
 *   - version: 2 when custom SDDs are present
 *   - contracts array unchanged (strict superset)
 *   - manifest written to same path as before
 *   - custom_sdds has correct structure
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { generateSyncManifest, readCatalogContracts } from '../src/core/sync.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-sync-v2-test-'));
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

const MINIMAL_CONTRACT_ROLE = `---
name: agent
description: A test agent role
---
## Role
Test agent role.
`;

const GAME_DESIGN_SDD_YAML = `name: game-design
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
triggers:
  from_sdd: "sdd-orchestrator"
  trigger_phase: "apply"
  return_to: null
`;

// ─── v1 manifest (no custom SDDs) ────────────────────────────────────────────

describe('generateSyncManifest — v1 manifest (no custom SDDs)', () => {
  test('emits version: 1 when no catalogsDir provided', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      const { manifest } = generateSyncManifest(contractsDir);
      assert.equal(manifest.version, 1);
    } finally {
      cleanup(tmp);
    }
  });

  test('emits version: 1 when catalogsDir is empty', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir, { includeGlobal: false });
      assert.equal(manifest.version, 1);
    } finally {
      cleanup(tmp);
    }
  });

  test('emits version: 1 when catalogsDir does not exist', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const nonExistentCatalogs = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      const { manifest } = generateSyncManifest(contractsDir, nonExistentCatalogs, { includeGlobal: false });
      assert.equal(manifest.version, 1);
    } finally {
      cleanup(tmp);
    }
  });

  test('v1 manifest has NO custom_sdds field', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      const { manifest } = generateSyncManifest(contractsDir);
      assert.equal(manifest.custom_sdds, undefined);
    } finally {
      cleanup(tmp);
    }
  });

  test('contracts array is present in v1 manifest', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      const { manifest } = generateSyncManifest(contractsDir);
      assert.ok(Array.isArray(manifest.contracts));
      assert.equal(manifest.contracts.length, 1);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── v2 manifest (with custom SDDs) ──────────────────────────────────────────

describe('generateSyncManifest — v2 manifest (with custom SDDs)', () => {
  test('emits version: 2 when one custom SDD is present', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifest.version, 2);
    } finally {
      cleanup(tmp);
    }
  });

  test('v2 manifest has custom_sdds array', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir, { includeGlobal: false });
      assert.ok(Array.isArray(manifest.custom_sdds));
      assert.equal(manifest.custom_sdds.length, 1);
    } finally {
      cleanup(tmp);
    }
  });

  test('custom_sdds entry has correct name and scope', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      assert.equal(sddEntry.name, 'game-design');
      assert.equal(sddEntry.scope, 'project');
    } finally {
      cleanup(tmp);
    }
  });

  test('custom_sdds entry has phases summary array', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      assert.ok(Array.isArray(sddEntry.phases));
      assert.equal(sddEntry.phases.length, 2); // concept + narrative
      const conceptPhase = sddEntry.phases.find(p => p.name === 'concept');
      assert.ok(conceptPhase, 'Expected concept phase');
      assert.equal(conceptPhase.intent, 'Define high-level game concept');
      assert.equal(conceptPhase.execution, 'parallel');
      assert.equal(conceptPhase.agents, 2);
    } finally {
      cleanup(tmp);
    }
  });

  test('custom_sdds entry has roles array (empty if no role contracts)', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      assert.ok(Array.isArray(sddEntry.roles));
    } finally {
      cleanup(tmp);
    }
  });

  test('custom_sdds entry has triggers object', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      assert.ok(sddEntry.triggers, 'Expected triggers object');
      assert.equal(sddEntry.triggers.from_sdd, 'sdd-orchestrator');
    } finally {
      cleanup(tmp);
    }
  });

  test('v2 manifest still has contracts array identical in structure to v1', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.ok(Array.isArray(manifest.contracts));
      assert.equal(manifest.contracts.length, 1);
      // V1 fields present: type, name, topic_key, file, checksum
      const c = manifest.contracts[0];
      assert.ok(c.type);
      assert.ok(c.name);
      assert.ok(c.topic_key);
      assert.ok(c.file);
      assert.ok(c.checksum);
    } finally {
      cleanup(tmp);
    }
  });

  test('manifest is always written to <contractsDir>/.sync-manifest.json', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      const { manifestPath } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifestPath, path.join(contractsDir, '.sync-manifest.json'));
      assert.ok(fs.existsSync(manifestPath), 'Manifest file should exist on disk');
    } finally {
      cleanup(tmp);
    }
  });

  test('catalog role contracts appear in custom_sdds roles array', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      writeFile(catalogsDir, 'game-design/contracts/roles/director.md', '# Director\nDirector role.');
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      assert.equal(sddEntry.roles.length, 1);
      assert.equal(sddEntry.roles[0].name, 'director');
    } finally {
      cleanup(tmp);
    }
  });

  test('catalog role contracts have project-style relative file paths with /contracts/ segment', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      writeFile(catalogsDir, 'game-design/contracts/roles/director.md', '# Director\nDirector role.');
      writeFile(catalogsDir, 'game-design/contracts/phases/apply.md', '# Apply\nApply phase.');
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      // Should be: catalogs/game-design/contracts/roles/director.md
      assert.equal(sddEntry.roles[0].file, 'catalogs/game-design/contracts/roles/director.md');
    } finally {
      cleanup(tmp);
    }
  });

  test('catalog phase contracts have project-style relative file paths with /contracts/ segment', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT_ROLE);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_DESIGN_SDD_YAML);
      writeFile(catalogsDir, 'game-design/contracts/phases/concept.md', '# Concept\nConcept phase.');
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      // Catalog contracts should appear in the roles or phases of the sddEntry with correct paths
      // readCatalogContracts returns phases too — access them directly
      const sddEntry = manifest.custom_sdds[0];
      // We need to verify the path format via readCatalogContracts function directly
      const catalogDir = path.join(catalogsDir, 'game-design');
      const contracts = readCatalogContracts(catalogDir, catalogsDir);
      const phaseContract = contracts.find(c => c.type === 'phase');
      assert.ok(phaseContract, 'Expected a phase contract');
      assert.equal(phaseContract.file, 'catalogs/game-design/contracts/phases/concept.md');
    } finally {
      cleanup(tmp);
    }
  });
});
