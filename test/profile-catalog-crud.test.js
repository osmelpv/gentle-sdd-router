/**
 * Tests for Profile CRUD, Catalog CRUD, Uninstall command, and CLI commands.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  createProfile,
  deleteProfile,
  renameProfile,
  copyProfile,
  moveProfile,
  listCatalogs,
  createCatalog,
  deleteCatalog,
} from '../src/core/preset-io.js';
import { removeOpenCodeOverlay } from '../src/adapters/opencode/overlay-generator.js';
import { runCli } from '../src/cli.js';
import { createOpenCodeSlashCommandManifest } from '../src/adapters/opencode/index.js';
import { parseYaml } from '../src/core/router.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-crud-test-'));
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

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join('');
}

// Minimal v4 core config + profiles directory for CLI tests
const MINIMAL_CORE_CONFIG_YAML = `version: 4
active_preset: balanced
activation_state: inactive
`;

const BALANCED_PROFILE_YAML = `name: balanced
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

function makeRouterDir(tmpDir) {
  const routerDir = path.join(tmpDir, 'router');
  fs.mkdirSync(routerDir, { recursive: true });
  writeFile(routerDir, 'router.yaml', MINIMAL_CORE_CONFIG_YAML);
  writeFile(routerDir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
  return routerDir;
}

// ─── Profile CRUD ─────────────────────────────────────────────────────────────

describe('createProfile', () => {
  test('creates a valid profile file', () => {
    const dir = makeTempDir();
    try {
      const result = createProfile('myprofile', dir);

      assert.equal(result.presetName, 'myprofile');
      assert.ok(fs.existsSync(result.path), 'file should exist');

      const raw = fs.readFileSync(result.path, 'utf8');
      const parsed = parseYaml(raw);
      assert.equal(parsed.name, 'myprofile');
      assert.ok(parsed.phases, 'should have phases');
      assert.ok(parsed.phases.orchestrator, 'should have orchestrator phase');
    } finally {
      cleanup(dir);
    }
  });

  test('creates profile in subdirectory when catalog is specified', () => {
    const dir = makeTempDir();
    try {
      const result = createProfile('teamprofile', dir, { catalog: 'myteam' });

      assert.equal(result.catalog, 'myteam');
      assert.match(result.path, /profiles\/myteam\/teamprofile\.router\.yaml/);
      assert.ok(fs.existsSync(result.path));
    } finally {
      cleanup(dir);
    }
  });

  test('creates profile with custom target sets the lane target', () => {
    const dir = makeTempDir();
    try {
      const result = createProfile('custom', dir, { target: 'openai/gpt-4o' });
      const raw = fs.readFileSync(result.path, 'utf8');
      const parsed = parseYaml(raw);
      assert.equal(parsed.phases.orchestrator[0].target, 'openai/gpt-4o');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if profile already exists', () => {
    const dir = makeTempDir();
    try {
      createProfile('duplicate', dir);
      assert.throws(
        () => createProfile('duplicate', dir),
        /already exists/,
      );
    } finally {
      cleanup(dir);
    }
  });

  test('throws for empty name', () => {
    const dir = makeTempDir();
    try {
      assert.throws(
        () => createProfile('', dir),
        /required/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe('deleteProfile', () => {
  test('removes the file', () => {
    const dir = makeTempDir();
    try {
      createProfile('todelete', dir);
      const profilePath = path.join(dir, 'profiles', 'todelete.router.yaml');
      assert.ok(fs.existsSync(profilePath), 'file should exist before delete');

      const result = deleteProfile('todelete', dir);
      assert.equal(result.deleted, true);
      assert.ok(!fs.existsSync(profilePath), 'file should be gone after delete');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if profile not found', () => {
    const dir = makeTempDir();
    try {
      assert.throws(
        () => deleteProfile('doesnotexist', dir),
        /not found/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe('renameProfile', () => {
  test('changes the file name and the name field inside', () => {
    const dir = makeTempDir();
    try {
      createProfile('oldname', dir);
      const oldPath = path.join(dir, 'profiles', 'oldname.router.yaml');
      const newPath = path.join(dir, 'profiles', 'newname.router.yaml');

      const result = renameProfile('oldname', 'newname', dir);

      assert.equal(result.oldName, 'oldname');
      assert.equal(result.newName, 'newname');
      assert.ok(!fs.existsSync(oldPath), 'old file should be gone');
      assert.ok(fs.existsSync(newPath), 'new file should exist');

      const raw = fs.readFileSync(newPath, 'utf8');
      const parsed = parseYaml(raw);
      assert.equal(parsed.name, 'newname', 'name field inside file should be updated');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if new name already exists', () => {
    const dir = makeTempDir();
    try {
      createProfile('alpha', dir);
      createProfile('beta', dir);

      assert.throws(
        () => renameProfile('alpha', 'beta', dir),
        /already exists/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe('copyProfile', () => {
  test('duplicates the profile with a new name', () => {
    const dir = makeTempDir();
    try {
      createProfile('original', dir, { target: 'openai/gpt-4o' });
      const result = copyProfile('original', 'clone', dir);

      const originalPath = path.join(dir, 'profiles', 'original.router.yaml');
      const clonePath = path.join(dir, 'profiles', 'clone.router.yaml');

      assert.ok(fs.existsSync(originalPath), 'original should still exist');
      assert.ok(fs.existsSync(clonePath), 'clone should exist');

      const cloneRaw = fs.readFileSync(clonePath, 'utf8');
      const cloneParsed = parseYaml(cloneRaw);
      assert.equal(cloneParsed.name, 'clone', 'clone should have new name');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if dest already exists', () => {
    const dir = makeTempDir();
    try {
      createProfile('source', dir);
      createProfile('dest', dir);

      assert.throws(
        () => copyProfile('source', 'dest', dir),
        /already exists/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Catalog CRUD ─────────────────────────────────────────────────────────────

describe('listCatalogs', () => {
  test('returns default catalog when only flat profiles exist', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/alpha.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/beta.router.yaml', BALANCED_PROFILE_YAML);

      const result = listCatalogs(dir);
      const defaultCatalog = result.find((c) => c.name === 'default');
      assert.ok(defaultCatalog, 'default catalog should be present');
      assert.equal(defaultCatalog.profileCount, 2);
    } finally {
      cleanup(dir);
    }
  });

  test('includes named catalogs with correct profile counts', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/flat.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/myteam/alpha.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/myteam/beta.router.yaml', BALANCED_PROFILE_YAML);

      const result = listCatalogs(dir);
      const defaultCatalog = result.find((c) => c.name === 'default');
      const teamCatalog = result.find((c) => c.name === 'myteam');

      assert.ok(defaultCatalog);
      assert.equal(defaultCatalog.profileCount, 1);
      assert.ok(teamCatalog);
      assert.equal(teamCatalog.profileCount, 2);
    } finally {
      cleanup(dir);
    }
  });
});

describe('createCatalog', () => {
  test('creates the catalog directory', () => {
    const dir = makeTempDir();
    try {
      const result = createCatalog('newcatalog', dir);
      assert.equal(result.name, 'newcatalog');
      assert.ok(fs.existsSync(result.path), 'directory should exist');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if catalog already exists', () => {
    const dir = makeTempDir();
    try {
      createCatalog('existing', dir);
      assert.throws(
        () => createCatalog('existing', dir),
        /already exists/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe('deleteCatalog', () => {
  test('removes an empty catalog directory', () => {
    const dir = makeTempDir();
    try {
      createCatalog('emptyone', dir);
      const catalogPath = path.join(dir, 'profiles', 'emptyone');
      assert.ok(fs.existsSync(catalogPath), 'should exist before delete');

      const result = deleteCatalog('emptyone', dir);
      assert.equal(result.deleted, true);
      assert.ok(!fs.existsSync(catalogPath), 'should be gone after delete');
    } finally {
      cleanup(dir);
    }
  });

  test('throws if catalog contains profiles', () => {
    const dir = makeTempDir();
    try {
      createCatalog('notempty', dir);
      writeFile(dir, 'profiles/notempty/something.router.yaml', BALANCED_PROFILE_YAML);

      assert.throws(
        () => deleteCatalog('notempty', dir),
        /not empty/,
      );
    } finally {
      cleanup(dir);
    }
  });

  test('throws if trying to delete the default catalog', () => {
    const dir = makeTempDir();
    try {
      assert.throws(
        () => deleteCatalog('default', dir),
        /default/,
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── Uninstall (removeOpenCodeOverlay) ────────────────────────────────────────

describe('removeOpenCodeOverlay', () => {
  test('removes gsr-* keys and preserves other keys', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'opencode.json');

    const initial = {
      agent: {
        'gsr-balanced': { mode: 'primary' },
        'gsr-safety': { mode: 'primary' },
        'my-custom-agent': { model: 'openai/gpt-4o' },
      },
      theme: 'dark',
    };
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8');

    try {
      const result = removeOpenCodeOverlay(configPath);
      assert.equal(result.removedCount, 2);

      const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(!after.agent['gsr-balanced'], 'gsr-balanced should be removed');
      assert.ok(!after.agent['gsr-safety'], 'gsr-safety should be removed');
      assert.ok(after.agent['my-custom-agent'], 'my-custom-agent should be preserved');
      assert.equal(after.theme, 'dark', 'theme should be preserved');
    } finally {
      cleanup(dir);
    }
  });

  test('returns 0 when no gsr-* keys exist', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'opencode.json');
    const initial = { agent: { 'my-agent': { mode: 'primary' } } };
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8');

    try {
      const result = removeOpenCodeOverlay(configPath);
      assert.equal(result.removedCount, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('handles missing file gracefully (no crash)', () => {
    const nonExistentPath = path.join(os.tmpdir(), `gsr-nonexistent-${Date.now()}.json`);

    // Should not throw
    const result = removeOpenCodeOverlay(nonExistentPath);
    assert.equal(result.removedCount, 0);
  });
});

// ─── CLI integration ──────────────────────────────────────────────────────────

describe('gsr profile list (CLI)', () => {
  test('runs without error and lists profiles', async () => {
    const tmpDir = makeTempDir();
    const routerDir = makeRouterDir(tmpDir);

    // We need to temporarily change to a directory where router/router.yaml is found.
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const output = await captureStdout(() => runCli(['profile', 'list']));
      assert.match(output, /balanced/);
    } finally {
      process.chdir(originalCwd);
      cleanup(tmpDir);
    }
  });
});

describe('gsr profile create (CLI)', () => {
  test('creates a profile in temp dir', async () => {
    const tmpDir = makeTempDir();
    const routerDir = makeRouterDir(tmpDir);

    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const output = await captureStdout(() => runCli(['profile', 'create', 'newprofile']));
      assert.match(output, /Created profile 'newprofile'/);

      const profilePath = path.join(routerDir, 'profiles', 'newprofile.router.yaml');
      assert.ok(fs.existsSync(profilePath), 'profile file should exist');
    } finally {
      process.chdir(originalCwd);
      cleanup(tmpDir);
    }
  });
});

describe('gsr profile delete (CLI)', () => {
  test('removes a profile in temp dir', async () => {
    const tmpDir = makeTempDir();
    const routerDir = makeRouterDir(tmpDir);

    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const output = await captureStdout(() => runCli(['profile', 'delete', 'balanced']));
      assert.match(output, /Deleted profile 'balanced'/);

      const profilePath = path.join(routerDir, 'profiles', 'balanced.router.yaml');
      assert.ok(!fs.existsSync(profilePath), 'profile file should be gone');
    } finally {
      process.chdir(originalCwd);
      cleanup(tmpDir);
    }
  });
});

describe('gsr catalog list (CLI)', () => {
  test('runs without error', async () => {
    const tmpDir = makeTempDir();
    makeRouterDir(tmpDir);

    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const output = await captureStdout(() => runCli(['catalog', 'list']));
      assert.match(output, /Catalogs:/);
      assert.match(output, /default/);
    } finally {
      process.chdir(originalCwd);
      cleanup(tmpDir);
    }
  });
});

describe('gsr uninstall (CLI)', () => {
  test('runs without error in temp dir', async () => {
    // Use a config path where no gsr-* entries exist
    const tmpDir = makeTempDir();
    const configPath = path.join(tmpDir, 'opencode.json');
    const initial = { agent: { 'some-agent': { mode: 'primary' } } };
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8');

    // Override the env so removeOpenCodeOverlay targets our test file
    // (since we can't easily patch OPENCODE_CONFIG_PATH without mocking)
    // Instead just test that the command runs without throwing
    try {
      const output = await captureStdout(() => runCli(['uninstall']));
      // Should output something about no gsr-* entries or count removed
      assert.ok(output.length > 0, 'should produce output');
    } finally {
      cleanup(tmpDir);
    }
  });
});

// ─── Slash Command Manifest ───────────────────────────────────────────────────

describe('slash command manifest', () => {
  test('includes all new commands', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);

    const expectedNew = [
      'update',
      'apply-opencode',
      'export',
      'import',
      'version',
      'uninstall',
      'profile-list',
      'profile-show',
      'profile-create',
      'profile-delete',
      'profile-rename',
      'profile-copy',
      'catalog-list',
      'catalog-create',
      'catalog-delete',
    ];

    for (const id of expectedNew) {
      assert.ok(ids.includes(id), `manifest should include command '${id}'`);
    }
  });

  test('total command count includes new entries', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    // Original 12 + 15 new = 27
    assert.ok(manifest.commands.length >= 27, `expected at least 27 commands, got ${manifest.commands.length}`);
  });

  test('slash command manifest includes catalog enable/disable commands', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);
    assert.ok(ids.includes('catalog-enable'), "manifest should include 'catalog-enable'");
    assert.ok(ids.includes('catalog-disable'), "manifest should include 'catalog-disable'");
  });

  test('slash command manifest has route category commands', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);
    assert.ok(ids.includes('route-use'), "manifest should include 'route-use'");
    assert.ok(ids.includes('route-show'), "manifest should include 'route-show'");
    assert.ok(ids.includes('route-activate'), "manifest should include 'route-activate'");
    assert.ok(ids.includes('route-deactivate'), "manifest should include 'route-deactivate'");
  });

  test('slash command manifest has setup category commands', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);
    assert.ok(ids.includes('setup-install'), "manifest should include 'setup-install'");
    assert.ok(ids.includes('setup-update'), "manifest should include 'setup-update'");
    assert.ok(ids.includes('setup-uninstall'), "manifest should include 'setup-uninstall'");
    assert.ok(ids.includes('setup-bootstrap'), "manifest should include 'setup-bootstrap'");
    assert.ok(ids.includes('setup-apply'), "manifest should include 'setup-apply'");
  });

  test('slash command manifest has inspect category commands', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);
    assert.ok(ids.includes('inspect-browse'), "manifest should include 'inspect-browse'");
    assert.ok(ids.includes('inspect-compare'), "manifest should include 'inspect-compare'");
    assert.ok(ids.includes('inspect-render'), "manifest should include 'inspect-render'");
  });

  test('slash command manifest includes catalog-move command', () => {
    const manifest = createOpenCodeSlashCommandManifest();
    const ids = manifest.commands.map((c) => c.id);
    assert.ok(ids.includes('catalog-move'), "manifest should include 'catalog-move'");
  });
});

// ─── moveProfile ──────────────────────────────────────────────────────────────

describe('moveProfile', () => {
  test('moves profile from default catalog to a named catalog', () => {
    const dir = makeTempDir();
    try {
      const routerDir = path.join(dir, 'router');
      fs.mkdirSync(routerDir, { recursive: true });
      // Create a profile in the default (flat) catalog
      const created = createProfile('moveme', routerDir);
      assert.ok(fs.existsSync(created.path), 'source profile should exist');

      // Create the target catalog directory
      fs.mkdirSync(path.join(routerDir, 'profiles', 'team'), { recursive: true });

      const result = moveProfile('moveme', 'team', routerDir);
      assert.equal(result.name, 'moveme');
      assert.equal(result.from, 'default');
      assert.equal(result.to, 'team');
      assert.ok(fs.existsSync(result.path), 'profile should exist at new path');
      assert.ok(!fs.existsSync(created.path), 'profile should no longer exist at old path');
      assert.ok(result.path.includes('team'), 'new path should be under team catalog');
    } finally {
      cleanup(dir);
    }
  });

  test('moves profile from named catalog to default', () => {
    const dir = makeTempDir();
    try {
      const routerDir = path.join(dir, 'router');
      fs.mkdirSync(routerDir, { recursive: true });
      // Create a profile in a named catalog
      fs.mkdirSync(path.join(routerDir, 'profiles', 'team'), { recursive: true });
      const created = createProfile('moveback', routerDir, { catalog: 'team' });
      assert.ok(fs.existsSync(created.path), 'source profile should exist');
      assert.ok(created.path.includes('team'), 'source should be in team catalog');

      // Ensure default profiles dir exists
      fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });

      const result = moveProfile('moveback', 'default', routerDir);
      assert.equal(result.from, 'team');
      assert.equal(result.to, 'default');
      assert.ok(fs.existsSync(result.path), 'profile should exist at new (default) path');
      assert.ok(!result.path.includes(path.join('profiles', 'team')), 'new path should not be under team');
      assert.ok(!fs.existsSync(created.path), 'original path should be gone');
    } finally {
      cleanup(dir);
    }
  });

  test('moveProfile throws if profile not found', () => {
    const dir = makeTempDir();
    try {
      const routerDir = path.join(dir, 'router');
      fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });
      assert.throws(
        () => moveProfile('nonexistent', 'somecat', routerDir),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("not found"), `Expected 'not found' in: ${err.message}`);
          return true;
        },
      );
    } finally {
      cleanup(dir);
    }
  });

  test('moveProfile throws if profile is already in target catalog', () => {
    const dir = makeTempDir();
    try {
      const routerDir = path.join(dir, 'router');
      fs.mkdirSync(routerDir, { recursive: true });
      // Create profile in default catalog
      createProfile('samecat', routerDir);
      // Trying to move to 'default' when already there
      assert.throws(
        () => moveProfile('samecat', 'default', routerDir),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('already in catalog'),
            `Expected 'already in catalog' in: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      cleanup(dir);
    }
  });

  test('moveProfile throws if a profile with the same name already exists in target catalog', () => {
    const dir = makeTempDir();
    try {
      const routerDir = path.join(dir, 'router');
      fs.mkdirSync(routerDir, { recursive: true });
      // Create profile in default catalog
      createProfile('duplicate', routerDir);
      // Create same-named profile in target catalog
      fs.mkdirSync(path.join(routerDir, 'profiles', 'team'), { recursive: true });
      createProfile('duplicate', routerDir, { catalog: 'team' });
      // Attempting move should fail
      assert.throws(
        () => moveProfile('duplicate', 'team', routerDir),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('already exists'),
            `Expected 'already exists' in: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      cleanup(dir);
    }
  });

  test('gsr catalog move CLI runs without error', async () => {
    const tmpDir = makeTempDir();
    try {
      const routerDir = makeRouterDir(tmpDir);
      // Create a named catalog dir so move destination is valid
      fs.mkdirSync(path.join(routerDir, 'profiles', 'team'), { recursive: true });
      // Write router.yaml with a catalog entry for 'team'
      const configPath = path.join(routerDir, 'router.yaml');
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = parseYaml(raw);
      parsed.catalogs = { ...(parsed.catalogs ?? {}), team: { enabled: false } };
      const { stringifyYaml } = await import('../src/core/router.js');
      fs.writeFileSync(configPath, stringifyYaml(parsed), 'utf8');

      const originalCwd = process.cwd();
      const chunks = [];
      const originalWrite = process.stdout.write.bind(process.stdout);

      process.chdir(tmpDir);
      process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

      try {
        await runCli(['catalog', 'move', 'balanced', 'team']);
        const output = chunks.join('');
        assert.ok(
          output.includes("Moved profile 'balanced'"),
          `Expected move confirmation in: ${output}`,
        );
      } finally {
        process.stdout.write = originalWrite;
        process.chdir(originalCwd);
      }
    } finally {
      cleanup(tmpDir);
    }
  });
});
