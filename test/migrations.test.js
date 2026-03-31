import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  MIGRATIONS,
  createBackup,
  loadMigrationsRegistry,
  planMigrations,
  restoreBackup,
  runMigrations,
  saveMigrationsRegistry,
} from '../src/core/migrations/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-migrations-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function writeRouterYaml(dir, content) {
  const p = path.join(dir, 'router.yaml');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function writeRegistryYaml(dir, content) {
  const p = path.join(dir, '.migrations.yaml');
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function writeRegistryWithApplied(dir, appliedIds) {
  // Build registry as YAML with applied as an object map (avoids custom parser limitations)
  const lines = ['schema_version: 1', 'applied:'];
  for (const id of appliedIds) {
    lines.push(`  ${id}:`);
    lines.push(`    name: v3-to-v4-multifile`);
    lines.push(`    applied_at: "2026-01-01T00:00:00.000Z"`);
  }
  writeRegistryYaml(dir, lines.join('\n') + '\n');
}

// ─── Minimal v3 monolith fixture ─────────────────────────────────────────────
// Note: custom YAML parser requires list items to start with target:/kind:/metadata:
const V3_ROUTER_YAML = `version: 3
active_catalog: default
active_preset: balanced
activation_state: active
catalogs:
  default:
    presets:
      balanced:
        phases:
          orchestrator:
            - target: anthropic/claude-sonnet
              phase: orchestrator
              role: primary
`;

// ─── Minimal v4 core config fixture ──────────────────────────────────────────
const V4_ROUTER_YAML = `version: 4
active_preset: balanced
activation_state: active
`;

// ─── MIGRATIONS array ─────────────────────────────────────────────────────────

describe('MIGRATIONS static registry', () => {
  test('MIGRATIONS array is non-empty', () => {
    assert.ok(Array.isArray(MIGRATIONS), 'MIGRATIONS is an array');
    assert.ok(MIGRATIONS.length > 0, 'MIGRATIONS has at least one entry');
  });

  test('MIGRATIONS are ordered by id (lexicographic)', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      assert.ok(
        MIGRATIONS[i - 1].id < MIGRATIONS[i].id,
        `MIGRATIONS[${i - 1}].id (${MIGRATIONS[i - 1].id}) < MIGRATIONS[${i}].id (${MIGRATIONS[i].id})`
      );
    }
  });

  test('first migration is 001', () => {
    assert.equal(MIGRATIONS[0].id, '001');
  });

  test('each migration has required shape', () => {
    for (const m of MIGRATIONS) {
      assert.ok(typeof m.id === 'string', `migration ${m.id} has string id`);
      assert.ok(typeof m.name === 'string', `migration ${m.id} has string name`);
      assert.ok(typeof m.description === 'string', `migration ${m.id} has string description`);
      assert.ok(typeof m.canApply === 'function', `migration ${m.id} has canApply function`);
      assert.ok(typeof m.apply === 'function', `migration ${m.id} has apply function`);
    }
  });
});

// ─── loadMigrationsRegistry ───────────────────────────────────────────────────

describe('loadMigrationsRegistry', () => {
  test('returns default registry when .migrations.yaml does not exist', () => {
    const dir = makeTempDir();

    try {
      const registry = loadMigrationsRegistry(dir);
      assert.equal(registry.schema_version, 1);
      assert.ok(typeof registry.applied === 'object' && !Array.isArray(registry.applied), 'applied is an object map');
      assert.equal(Object.keys(registry.applied).length, 0, 'no applied migrations');
    } finally {
      cleanup(dir);
    }
  });

  test('reads existing registry file (object-map format)', () => {
    const dir = makeTempDir();

    try {
      // applied is stored as an object map keyed by migration id
      writeRegistryYaml(dir, [
        'schema_version: 1',
        'applied:',
        '  001:',
        '    name: v3-to-v4-multifile',
        '    applied_at: "2026-01-01T00:00:00.000Z"',
      ].join('\n') + '\n');

      const registry = loadMigrationsRegistry(dir);
      assert.equal(registry.schema_version, 1);
      assert.ok(typeof registry.applied === 'object' && !Array.isArray(registry.applied), 'applied is an object');
      assert.ok('001' in registry.applied, '001 key present');
      assert.equal(registry.applied['001'].name, 'v3-to-v4-multifile');
    } finally {
      cleanup(dir);
    }
  });

  test('handles empty applied map in registry', () => {
    const dir = makeTempDir();

    try {
      writeRegistryYaml(dir, 'schema_version: 1\napplied:\n');
      const registry = loadMigrationsRegistry(dir);
      assert.ok(typeof registry.applied === 'object', 'applied is an object');
      assert.equal(Object.keys(registry.applied).length, 0, 'no applied migrations');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── saveMigrationsRegistry ───────────────────────────────────────────────────

describe('saveMigrationsRegistry', () => {
  test('writes registry to .migrations.yaml', () => {
    const dir = makeTempDir();

    try {
      const registry = {
        schema_version: 1,
        applied: { '001': { name: 'test', applied_at: '2026-01-01T00:00:00.000Z' } },
      };
      saveMigrationsRegistry(dir, registry);

      const p = path.join(dir, '.migrations.yaml');
      assert.ok(fs.existsSync(p), '.migrations.yaml was created');

      const content = fs.readFileSync(p, 'utf8');
      assert.ok(content.includes('001'), 'file contains migration id');
      assert.ok(content.includes('schema_version'), 'file contains schema_version');
    } finally {
      cleanup(dir);
    }
  });

  test('round-trip: save then load returns the same data', () => {
    const dir = makeTempDir();

    try {
      const registry = {
        schema_version: 1,
        applied: {
          '001': { name: 'v3-to-v4-multifile', applied_at: '2026-01-01T00:00:00.000Z' },
        },
      };

      saveMigrationsRegistry(dir, registry);
      const loaded = loadMigrationsRegistry(dir);

      assert.equal(loaded.schema_version, 1);
      assert.ok('001' in loaded.applied, '001 key present after round-trip');
      assert.equal(loaded.applied['001'].name, 'v3-to-v4-multifile');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── planMigrations ───────────────────────────────────────────────────────────

describe('planMigrations', () => {
  test('returns pending migration 001 for v3 config with no registry', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const plan = planMigrations(dir);

      assert.equal(plan.currentVersion, 3);
      assert.ok(Array.isArray(plan.pending), 'pending is an array');
      assert.ok(plan.pending.length > 0, 'at least one migration is pending');

      const m001 = plan.pending.find((m) => m.id === '001');
      assert.ok(m001, 'migration 001 is in pending list');
      assert.equal(m001.name, 'v3-to-v4-multifile');
    } finally {
      cleanup(dir);
    }
  });

  test('returns empty pending list for v4 config', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V4_ROUTER_YAML);

      const plan = planMigrations(dir);

      assert.equal(plan.currentVersion, 4);
      assert.deepEqual(plan.pending, []);
      assert.equal(plan.targetVersion, null);
    } finally {
      cleanup(dir);
    }
  });

  test('skips migration 001 when it is already applied', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      writeRegistryWithApplied(dir, ['001']);

      const plan = planMigrations(dir);

      assert.deepEqual(plan.pending, [], 'no pending migrations when 001 is already applied');
    } finally {
      cleanup(dir);
    }
  });

  test('missing registry file is treated as default (no applied migrations)', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      // No .migrations.yaml file

      const plan = planMigrations(dir);

      // Should still return pending 001
      const m001 = plan.pending.find((m) => m.id === '001');
      assert.ok(m001, 'migration 001 is pending even without registry file');
    } finally {
      cleanup(dir);
    }
  });

  test('plan includes alreadyApplied list', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      writeRegistryWithApplied(dir, ['001']);

      const plan = planMigrations(dir);

      assert.ok(Array.isArray(plan.alreadyApplied), 'alreadyApplied is an array');
      assert.ok(plan.alreadyApplied.includes('001'), '001 is in alreadyApplied');
    } finally {
      cleanup(dir);
    }
  });

  test('plan for v4 config has null targetVersion', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V4_ROUTER_YAML);

      const plan = planMigrations(dir);

      assert.equal(plan.targetVersion, null);
    } finally {
      cleanup(dir);
    }
  });

  test('plan returns currentVersion correctly', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const plan = planMigrations(dir);

      assert.equal(plan.currentVersion, 3);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── createBackup / restoreBackup ─────────────────────────────────────────────

describe('createBackup', () => {
  test('creates a backup directory under router/backups/', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const backupPath = createBackup(dir, '001');

      assert.ok(fs.existsSync(backupPath), 'backup directory exists');
      assert.ok(backupPath.includes(`pre-001-`), 'backup dir name has correct prefix');
    } finally {
      cleanup(dir);
    }
  });

  test('backup contains original router.yaml', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const backupPath = createBackup(dir, '001');

      const backedUpYaml = path.join(backupPath, 'router.yaml');
      assert.ok(fs.existsSync(backedUpYaml), 'router.yaml is in backup');

      const content = fs.readFileSync(backedUpYaml, 'utf8');
      assert.ok(content.includes('version: 3'), 'backup contains original content');
    } finally {
      cleanup(dir);
    }
  });

  test('backup does not include the backups/ directory itself', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const backupPath = createBackup(dir, '001');

      const nestedBackups = path.join(backupPath, 'backups');
      assert.ok(!fs.existsSync(nestedBackups), 'backup does not contain a nested backups/ dir');
    } finally {
      cleanup(dir);
    }
  });

  test('backup preserves .migrations.yaml if present', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      writeRegistryYaml(dir, 'schema_version: 1\napplied:\n');

      const backupPath = createBackup(dir, '001');

      const backedUpRegistry = path.join(backupPath, '.migrations.yaml');
      assert.ok(fs.existsSync(backedUpRegistry), '.migrations.yaml is in backup');
    } finally {
      cleanup(dir);
    }
  });
});

describe('restoreBackup', () => {
  test('restores original router.yaml from backup', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      const backupPath = createBackup(dir, '001');

      // Simulate a modification after backup
      writeRouterYaml(dir, 'version: 4\nactive_preset: balanced\nactivation_state: active\n');

      restoreBackup(dir, backupPath);

      const content = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(content.includes('version: 3'), 'router.yaml restored to v3');
    } finally {
      cleanup(dir);
    }
  });

  test('restore removes new files created after backup', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      const backupPath = createBackup(dir, '001');

      // Create profiles dir (simulating partial migration)
      const profilesDir = path.join(dir, 'profiles');
      fs.mkdirSync(profilesDir, { recursive: true });
      fs.writeFileSync(path.join(profilesDir, 'balanced.router.yaml'), 'name: balanced\n', 'utf8');

      restoreBackup(dir, backupPath);

      assert.ok(!fs.existsSync(profilesDir), 'profiles dir removed after restore');
    } finally {
      cleanup(dir);
    }
  });

  test('restore preserves the backups/ directory', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);
      const backupPath = createBackup(dir, '001');

      restoreBackup(dir, backupPath);

      const backupsDir = path.join(dir, 'backups');
      assert.ok(fs.existsSync(backupsDir), 'backups/ directory preserved after restore');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── runMigrations integration tests ─────────────────────────────────────────

// Minimal v1 monolith fixture for integration tests
const V1_ROUTER_YAML = `version: 1
active_profile: default
profiles:
  default:
    phases:
      orchestrator:
        - target: anthropic/claude-sonnet
          phase: orchestrator
          role: primary
`;

describe('runMigrations: full migration flow (v3 → v4)', () => {
  test('applies migration and returns applied list', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const result = await runMigrations(dir);

      assert.ok(Array.isArray(result.applied), 'result.applied is an array');
      assert.ok(result.applied.includes('001'), 'migration 001 was applied');
    } finally {
      cleanup(dir);
    }
  });

  test('writes v4 core config to router.yaml', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      await runMigrations(dir);

      const raw = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(raw.includes('version: 4'), 'router.yaml has version: 4 after migration');
    } finally {
      cleanup(dir);
    }
  });

  test('writes profile files under profiles/', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      await runMigrations(dir);

      const profilesDir = path.join(dir, 'profiles');
      assert.ok(fs.existsSync(profilesDir), 'profiles/ directory exists');

      const files = fs.readdirSync(profilesDir);
      const profileFiles = files.filter((f) => f.endsWith('.router.yaml'));
      assert.ok(profileFiles.length > 0, 'at least one .router.yaml file in profiles/');
    } finally {
      cleanup(dir);
    }
  });

  test('updates .migrations.yaml registry after successful migration', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      await runMigrations(dir);

      const registry = loadMigrationsRegistry(dir);
      assert.ok('001' in registry.applied, '001 recorded in registry after migration');
      assert.ok(typeof registry.applied['001'].applied_at === 'string', 'applied_at is a string');
    } finally {
      cleanup(dir);
    }
  });

  test('backup directory is created under router/backups/', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const result = await runMigrations(dir);

      assert.ok(result.backups.length > 0, 'at least one backup path returned');
      assert.ok(fs.existsSync(result.backups[0]), 'backup directory exists on disk');
    } finally {
      cleanup(dir);
    }
  });

  test('backup directory contains original v3 router.yaml', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const result = await runMigrations(dir);

      const backedUp = path.join(result.backups[0], 'router.yaml');
      assert.ok(fs.existsSync(backedUp), 'router.yaml present in backup');

      const content = fs.readFileSync(backedUp, 'utf8');
      assert.ok(content.includes('version: 3'), 'backup has original v3 content');
    } finally {
      cleanup(dir);
    }
  });
});

describe('runMigrations: v1 → v4', () => {
  test('applies migration to v1 config and produces v4 output', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V1_ROUTER_YAML);

      const result = await runMigrations(dir);

      assert.ok(result.applied.includes('001'), 'migration 001 applied on v1 config');

      const raw = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(raw.includes('version: 4'), 'router.yaml has version: 4 after v1 migration');
    } finally {
      cleanup(dir);
    }
  });

  test('v1 migration creates profile files', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V1_ROUTER_YAML);

      await runMigrations(dir);

      const profilesDir = path.join(dir, 'profiles');
      assert.ok(fs.existsSync(profilesDir), 'profiles/ directory exists after v1 migration');

      // v1 profiles land in profiles/legacy/ (catalog named 'legacy' by the normalizer)
      // so we search recursively for any .router.yaml under profiles/
      function findRouterYamlFiles(base) {
        const results = [];
        for (const entry of fs.readdirSync(base)) {
          const full = path.join(base, entry);
          if (fs.statSync(full).isDirectory()) {
            results.push(...findRouterYamlFiles(full));
          } else if (entry.endsWith('.router.yaml')) {
            results.push(full);
          }
        }
        return results;
      }

      const profileFiles = findRouterYamlFiles(profilesDir);
      assert.ok(profileFiles.length > 0, 'profile files created from v1 migration');
    } finally {
      cleanup(dir);
    }
  });
});

describe('runMigrations: idempotent re-run', () => {
  test('second run returns empty applied list (no changes)', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      await runMigrations(dir);

      // Second run
      const result2 = await runMigrations(dir);

      assert.deepEqual(result2.applied, [], 'second run has no applied migrations');
      assert.equal(result2.plan.pending.length, 0, 'second run has empty plan');
    } finally {
      cleanup(dir);
    }
  });
});

describe('runMigrations: dry run', () => {
  test('dryRun:true returns plan without modifying files', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      const result = await runMigrations(dir, { dryRun: true });

      assert.deepEqual(result.applied, [], 'no migrations applied in dry run');
      assert.ok(result.plan, 'plan is returned in dry run');
      assert.ok(result.plan.pending.length > 0, 'plan has pending migrations in dry run');

      // router.yaml should still be v3
      const raw = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(raw.includes('version: 3'), 'router.yaml unchanged after dry run');

      // No profiles dir created
      const profilesDir = path.join(dir, 'profiles');
      assert.ok(!fs.existsSync(profilesDir), 'profiles/ not created in dry run');

      // Registry not created
      const registryPath = path.join(dir, '.migrations.yaml');
      assert.ok(!fs.existsSync(registryPath), '.migrations.yaml not created in dry run');
    } finally {
      cleanup(dir);
    }
  });
});

// ── loadMigrationsRegistry: legacy array format ───────────────────────────────

describe('loadMigrationsRegistry: legacy array format', () => {
  test('loadMigrationsRegistry handles legacy array format gracefully', () => {
    const dir = makeTempDir();

    try {
      // Write a registry using the legacy array format (applied as a list of objects).
      writeRegistryYaml(dir, [
        'schema_version: 1',
        'applied:',
        '  - id: "001"',
        '    applied_at: "2026-01-01T00:00:00.000Z"',
      ].join('\n') + '\n');

      // loadMigrationsRegistry must not throw — it should handle or convert the format.
      let registry;
      let thrownError = null;
      try {
        registry = loadMigrationsRegistry(dir);
      } catch (err) {
        thrownError = err;
      }

      // The function must either: (a) succeed and return a usable registry, or
      // (b) throw a clear error. In both cases it must not silently corrupt state.
      if (thrownError === null) {
        assert.ok(registry, 'registry was returned');
        assert.ok(typeof registry.applied === 'object', 'applied is an object');
      } else {
        // Acceptable: function rejects unrecognized format with an error
        assert.ok(thrownError instanceof Error, 'error is an Error instance');
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe('runMigrations: rollback on failure', () => {
  test('restoreBackup restores original state after simulated failure', () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      // Create backup of original state
      const backupPath = createBackup(dir, '001');

      // Simulate partial migration: overwrite router.yaml with v4 content
      writeRouterYaml(dir, 'version: 4\nactive_preset: balanced\nactivation_state: active\n');

      // Also create a profiles dir (simulating partial write)
      const profilesDir = path.join(dir, 'profiles');
      fs.mkdirSync(profilesDir, { recursive: true });
      fs.writeFileSync(
        path.join(profilesDir, 'balanced.router.yaml'),
        'name: balanced\nphases:\n  orchestrator: []\n',
        'utf8'
      );

      // Restore from backup (as runMigrations would do on failure)
      restoreBackup(dir, backupPath);

      // Verify original state is restored
      const content = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(content.includes('version: 3'), 'router.yaml restored to v3 after rollback');

      assert.ok(!fs.existsSync(profilesDir), 'profiles/ removed after rollback');
    } finally {
      cleanup(dir);
    }
  });

  test('full runMigrations flow: rollback restores v3 config when migration throws', async () => {
    const dir = makeTempDir();
    const profilesDir = path.join(dir, 'profiles');

    // Inject a failing migration at position 0 so it runs BEFORE migration 001.
    // This guarantees the backup is taken from the original v3 state and the
    // rollback must restore v3.
    const failingMigration = {
      id: '000',
      name: 'always-fails',
      description: 'This migration always throws to test rollback',
      fromVersion: 3,
      toVersion: 4,
      canApply: () => true,
      apply: () => {
        throw new Error('Simulated migration failure for rollback test');
      },
    };

    MIGRATIONS.unshift(failingMigration);

    try {
      writeRouterYaml(dir, V3_ROUTER_YAML);

      let thrownError = null;
      try {
        await runMigrations(dir);
      } catch (err) {
        thrownError = err;
      }

      // Error must have been thrown
      assert.ok(thrownError !== null, 'runMigrations threw an error when migration failed');
      assert.ok(
        thrownError.message.includes('Simulated migration failure'),
        'thrown error is the migration error'
      );

      // Original v3 config must be restored from backup
      const contentAfterRollback = fs.readFileSync(path.join(dir, 'router.yaml'), 'utf8');
      assert.ok(
        contentAfterRollback.includes('version: 3'),
        'router.yaml restored to v3 after rollback'
      );

      // .migrations.yaml must NOT mark the failing migration as applied
      const registryAfterRollback = loadMigrationsRegistry(dir);
      assert.ok(
        !('000' in registryAfterRollback.applied),
        'failing migration 000 is not recorded in registry after rollback'
      );

      // profiles/ dir must not exist (rollback removed any partial writes)
      assert.ok(
        !fs.existsSync(profilesDir),
        'profiles/ directory not present after rollback'
      );
    } finally {
      // Always remove the injected migration regardless of test outcome
      const idx = MIGRATIONS.indexOf(failingMigration);
      if (idx !== -1) {
        MIGRATIONS.splice(idx, 1);
      }
      cleanup(dir);
    }
  });

  test('no-op when plan is already empty (v4 config)', async () => {
    const dir = makeTempDir();

    try {
      writeRouterYaml(dir, V4_ROUTER_YAML);

      const result = await runMigrations(dir);

      assert.deepEqual(result.applied, [], 'no migrations for v4 config');
      assert.equal(result.plan.pending.length, 0, 'empty plan for v4 config');
    } finally {
      cleanup(dir);
    }
  });
});
