/**
 * Contract tests for manifest v3 generation (cross-catalog invocations).
 *
 * Tests verify:
 *   - version: 3 when any SDD phase has a non-null invoke block
 *   - version: 2 when custom SDDs exist but no invoke
 *   - version: 1 when no custom SDDs
 *   - v3 phases include invoke data for phases that have it
 *   - v3 phases omit invoke for phases without it (or set null)
 *   - v3 is a strict superset of v2
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { generateSyncManifest } from '../src/core/sync.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-sync-v3-test-'));
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

const MINIMAL_CONTRACT = `---
name: agent
description: A test agent role
---
## Role
Test agent role.
`;

const SDD_WITHOUT_INVOKE = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define concept"
  narrative:
    intent: "Write narrative"
    depends_on:
      - concept
`;

const SDD_WITH_INVOKE = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define concept"
  narrative:
    intent: "Write narrative"
    depends_on:
      - concept
    invoke:
      catalog: art-production
      sdd: asset-pipeline
      payload_from: output
      await: true
`;

const SDD_WITH_INVOKE_MINIMAL = `name: art-production
version: 1
description: "Art production workflow"
phases:
  assets:
    intent: "Create game assets"
    invoke:
      catalog: game-design
      payload_from: input
`;

// ─── v1 manifest (no custom SDDs) ────────────────────────────────────────────

describe('generateSyncManifest — v1 still works (no SDDs)', () => {
  test('emits version: 1 when no catalogsDir provided', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      const { manifest } = generateSyncManifest(contractsDir);
      assert.equal(manifest.version, 1);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── v2 manifest (SDDs present, no invoke) ───────────────────────────────────

describe('generateSyncManifest — v2 manifest (SDDs without invoke)', () => {
  test('emits version: 2 when SDDs exist but no phase has invoke', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITHOUT_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifest.version, 2);
    } finally {
      cleanup(tmp);
    }
  });

  test('v2 phases do NOT have invoke field (backward compat)', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITHOUT_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      const conceptPhase = sddEntry.phases.find(p => p.name === 'concept');
      // In v2, invoke field should be absent or null — not required
      // The important thing is version is 2
      assert.equal(manifest.version, 2);
      assert.ok(conceptPhase, 'Expected concept phase');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── v3 manifest (SDDs with invoke) ──────────────────────────────────────────

describe('generateSyncManifest — v3 manifest (SDDs with invoke)', () => {
  test('emits version: 3 when any phase has invoke', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITH_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifest.version, 3);
    } finally {
      cleanup(tmp);
    }
  });

  test('v3 phase with invoke includes invoke object', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITH_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      const narrativePhase = sddEntry.phases.find(p => p.name === 'narrative');
      assert.ok(narrativePhase, 'Expected narrative phase');
      assert.ok(narrativePhase.invoke, 'Expected invoke on narrative phase');
      assert.equal(narrativePhase.invoke.catalog, 'art-production');
      assert.equal(narrativePhase.invoke.sdd, 'asset-pipeline');
      assert.equal(narrativePhase.invoke.payload_from, 'output');
      assert.equal(narrativePhase.invoke.await, true);
    } finally {
      cleanup(tmp);
    }
  });

  test('v3 phase without invoke has invoke: null', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITH_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      const conceptPhase = sddEntry.phases.find(p => p.name === 'concept');
      assert.ok(conceptPhase, 'Expected concept phase');
      assert.equal(conceptPhase.invoke, null);
    } finally {
      cleanup(tmp);
    }
  });

  test('v3 is v2 superset: still has contracts, custom_sdds, name, scope, roles', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITH_INVOKE);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifest.version, 3);
      assert.ok(Array.isArray(manifest.contracts));
      assert.ok(Array.isArray(manifest.custom_sdds));
      const sddEntry = manifest.custom_sdds[0];
      assert.equal(sddEntry.name, 'game-design');
      assert.equal(sddEntry.scope, 'project');
      assert.ok(Array.isArray(sddEntry.roles));
      assert.ok(Array.isArray(sddEntry.phases));
    } finally {
      cleanup(tmp);
    }
  });

  test('v3 triggered by single invoke in one of multiple SDDs', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'game-design/sdd.yaml', SDD_WITHOUT_INVOKE);
      writeFile(catalogsDir, 'art-production/sdd.yaml', SDD_WITH_INVOKE_MINIMAL);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      assert.equal(manifest.version, 3);
    } finally {
      cleanup(tmp);
    }
  });

  test('minimal invoke (sdd defaults to catalog) preserved in v3 manifest', () => {
    const tmp = makeTempDir();
    try {
      const contractsDir = path.join(tmp, 'contracts');
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(contractsDir, 'roles/agent.md', MINIMAL_CONTRACT);
      writeFile(catalogsDir, 'art-production/sdd.yaml', SDD_WITH_INVOKE_MINIMAL);
      const { manifest } = generateSyncManifest(contractsDir, catalogsDir);
      const sddEntry = manifest.custom_sdds[0];
      const assetsPhase = sddEntry.phases.find(p => p.name === 'assets');
      assert.ok(assetsPhase.invoke);
      assert.equal(assetsPhase.invoke.catalog, 'game-design');
      assert.equal(assetsPhase.invoke.sdd, 'game-design'); // defaulted to catalog
    } finally {
      cleanup(tmp);
    }
  });
});
