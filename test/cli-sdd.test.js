/**
 * Integration tests for gsr sdd, gsr role, gsr phase CLI commands.
 *
 * Tests directly call the CLI functions and verify disk side effects
 * rather than going through process.chdir, following the pattern in
 * cli-import-export.test.js.
 *
 * Strict TDD: tests written FIRST (RED phase), implementation comes after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  createCustomSdd,
  loadCustomSdds,
  deleteCustomSdd,
} from '../src/core/sdd-catalog-io.js';
import {
  runSddCreate,
  runSddList,
  runSddShow,
  runSddDelete,
  runRoleCreate,
  runPhaseCreate,
} from '../src/cli.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-sdd-test-'));
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

function makeRouterDir(tmp) {
  const routerDir = path.join(tmp, 'router');
  const catalogsDir = path.join(routerDir, 'catalogs');
  const contractsDir = path.join(routerDir, 'contracts');
  fs.mkdirSync(catalogsDir, { recursive: true });
  fs.mkdirSync(contractsDir, { recursive: true });
  // Minimal router.yaml so CLI can resolve routerDir
  writeFile(routerDir, 'router.yaml', 'version: 4\nactive_preset: default\n');
  return { routerDir, catalogsDir, contractsDir };
}

// ─── gsr sdd create ──────────────────────────────────────────────────────────

describe('runSddCreate', () => {
  test('creates sdd.yaml at catalogsDir/<name>/sdd.yaml', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      runSddCreate(['my-sdd'], catalogsDir);
      assert.ok(fs.existsSync(path.join(catalogsDir, 'my-sdd', 'sdd.yaml')));
    } finally {
      cleanup(tmp);
    }
  });

  test('prints success message referencing the created path', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      const output = await captureStdout(() => runSddCreate(['my-sdd'], catalogsDir));
      assert.ok(output.includes('my-sdd'), 'Output should reference SDD name');
    } finally {
      cleanup(tmp);
    }
  });

  test('accepts --description flag', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      runSddCreate(['my-sdd', '--description', 'Custom debug workflow'], catalogsDir);
      const content = fs.readFileSync(path.join(catalogsDir, 'my-sdd', 'sdd.yaml'), 'utf8');
      assert.ok(content.includes('Custom debug workflow'));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when name is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runSddCreate([], catalogsDir), /name|required/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD already exists', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      runSddCreate(['my-sdd'], catalogsDir);
      assert.throws(() => runSddCreate(['my-sdd'], catalogsDir), /already exist|duplicate/i);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr sdd list ────────────────────────────────────────────────────────────

describe('runSddList', () => {
  test('prints no-sdds message when catalogs dir is empty', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      const output = await captureStdout(() => runSddList([], catalogsDir));
      assert.ok(
        output.toLowerCase().includes('no') ||
        output.toLowerCase().includes('empty') ||
        output.toLowerCase().includes('found'),
        `Expected empty state message, got: "${output}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('lists all custom SDDs with name and description', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'alpha', 'Alpha workflow');
      createCustomSdd(catalogsDir, 'beta', 'Beta workflow');
      const output = await captureStdout(() => runSddList([], catalogsDir));
      assert.ok(output.includes('alpha'), `Output should include 'alpha': ${output}`);
      assert.ok(output.includes('beta'), `Output should include 'beta': ${output}`);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr sdd show ────────────────────────────────────────────────────────────

describe('runSddShow', () => {
  const GAME_SDD_YAML = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define high-level game concept"
  narrative:
    intent: "Write the narrative"
    depends_on:
      - concept
  prototype:
    intent: "Build a prototype"
    depends_on:
      - narrative
`;

  test('prints SDD name, description, and all phases', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      writeFile(catalogsDir, 'game-design/sdd.yaml', GAME_SDD_YAML);
      const output = await captureStdout(() => runSddShow(['game-design'], catalogsDir));
      assert.ok(output.includes('game-design'));
      assert.ok(output.includes('concept'));
      assert.ok(output.includes('narrative'));
      assert.ok(output.includes('prototype'));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD does not exist', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runSddShow(['missing'], catalogsDir), /not found|missing/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when name argument is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runSddShow([], catalogsDir), /name|required/i);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr sdd delete ──────────────────────────────────────────────────────────

describe('runSddDelete', () => {
  test('deletes existing SDD with --yes flag', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'my-sdd');
      runSddDelete(['my-sdd', '--yes'], catalogsDir);
      assert.ok(!fs.existsSync(path.join(catalogsDir, 'my-sdd')));
    } finally {
      cleanup(tmp);
    }
  });

  test('prints success message after deletion', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'my-sdd');
      const output = await captureStdout(() => runSddDelete(['my-sdd', '--yes'], catalogsDir));
      assert.ok(output.includes('my-sdd'));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws for non-existent SDD', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runSddDelete(['ghost', '--yes'], catalogsDir), /not found|ghost/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when name is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runSddDelete(['--yes'], catalogsDir), /name|required/i);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr role create ─────────────────────────────────────────────────────────

describe('runRoleCreate', () => {
  test('creates role contract .md file with YAML frontmatter', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      runRoleCreate(['narrative-designer', '--sdd', 'game-design'], catalogsDir);
      const rolePath = path.join(catalogsDir, 'game-design', 'contracts', 'roles', 'narrative-designer.md');
      assert.ok(fs.existsSync(rolePath));
      const content = fs.readFileSync(rolePath, 'utf8');
      assert.ok(content.includes('narrative-designer') || content.includes('name:'));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --sdd option is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runRoleCreate(['my-role'], catalogsDir), /--sdd|catalog/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when catalog does not exist', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runRoleCreate(['my-role', '--sdd', 'ghost'], catalogsDir), /not found|ghost/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when role name is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      assert.throws(() => runRoleCreate(['--sdd', 'game-design'], catalogsDir), /name|required/i);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr phase create ────────────────────────────────────────────────────────

describe('runPhaseCreate', () => {
  test('creates phase contract .md file with YAML frontmatter', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      runPhaseCreate(['concept', '--sdd', 'game-design'], catalogsDir);
      const phasePath = path.join(catalogsDir, 'game-design', 'contracts', 'phases', 'concept.md');
      assert.ok(fs.existsSync(phasePath));
      const content = fs.readFileSync(phasePath, 'utf8');
      assert.ok(content.includes('concept') || content.includes('name:'));
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --sdd option is missing', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runPhaseCreate(['my-phase'], catalogsDir), /--sdd|catalog/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when catalog does not exist', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      assert.throws(() => runPhaseCreate(['concept', '--sdd', 'ghost'], catalogsDir), /not found|ghost/i);
    } finally {
      cleanup(tmp);
    }
  });

  test('does NOT overwrite existing phase contract (prints warning)', async () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      // Create first time
      runPhaseCreate(['concept', '--sdd', 'game-design'], catalogsDir);
      // Write distinct content
      const phasePath = path.join(catalogsDir, 'game-design', 'contracts', 'phases', 'concept.md');
      fs.writeFileSync(phasePath, '# Original\n', 'utf8');
      // Try to create again — should NOT overwrite
      const output = await captureStdout(() => runPhaseCreate(['concept', '--sdd', 'game-design'], catalogsDir));
      const afterContent = fs.readFileSync(phasePath, 'utf8');
      // Either warns (without overwriting) or throws
      const unchanged = afterContent === '# Original\n';
      const warnedOrThrew = output.toLowerCase().includes('exist') ||
                            output.toLowerCase().includes('warn') ||
                            output.toLowerCase().includes('skip');
      assert.ok(unchanged || warnedOrThrew, 'Should not overwrite existing phase contract');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── CLI Help text for sdd/role/phase commands ───────────────────────────────

import { runSddCommand, runRoleCommand, runPhaseCommand } from '../src/cli.js';

describe('CLI help — gsr sdd/role/phase help text', () => {
  test('gsr sdd help prints usage line for sdd subcommands', async () => {
    const output = await captureStdout(() => runSddCommand(['help']));
    assert.ok(output.length > 0, 'gsr sdd help must produce output');
    assert.ok(
      output.toLowerCase().includes('sdd') || output.toLowerCase().includes('usage'),
      `gsr sdd help output must mention 'sdd' or 'usage': "${output.trim()}"`
    );
    assert.ok(
      output.includes('create') || output.includes('list') || output.includes('delete'),
      `gsr sdd help must mention at least one subcommand (create/list/delete): "${output.trim()}"`
    );
  });

  test('gsr role help prints usage line for role subcommands', async () => {
    const output = await captureStdout(() => runRoleCommand(['help']));
    assert.ok(output.length > 0, 'gsr role help must produce output');
    assert.ok(
      output.toLowerCase().includes('role') || output.toLowerCase().includes('usage'),
      `gsr role help must mention 'role' or 'usage': "${output.trim()}"`
    );
    assert.ok(
      output.includes('create'),
      `gsr role help must mention 'create' subcommand: "${output.trim()}"`
    );
  });

  test('gsr phase help prints usage line for phase subcommands', async () => {
    const output = await captureStdout(() => runPhaseCommand(['help']));
    assert.ok(output.length > 0, 'gsr phase help must produce output');
    assert.ok(
      output.toLowerCase().includes('phase') || output.toLowerCase().includes('usage'),
      `gsr phase help must mention 'phase' or 'usage': "${output.trim()}"`
    );
    assert.ok(
      output.includes('create'),
      `gsr phase help must mention 'create' subcommand: "${output.trim()}"`
    );
  });
});
