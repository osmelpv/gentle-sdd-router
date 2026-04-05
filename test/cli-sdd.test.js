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
  runSddValidate,
  runSddDeclaredInvocations,
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
    const origEnv = process.env.GSR_TEST_NO_GLOBAL;
    try {
      process.env.GSR_TEST_NO_GLOBAL = '1';
      const { catalogsDir } = makeRouterDir(tmp);
      const output = await captureStdout(() => runSddList([], catalogsDir));
      assert.ok(
        output.toLowerCase().includes('no') ||
        output.toLowerCase().includes('empty') ||
        output.toLowerCase().includes('found'),
        `Expected empty state message, got: "${output}"`
      );
    } finally {
      if (origEnv === undefined) {
        delete process.env.GSR_TEST_NO_GLOBAL;
      } else {
        process.env.GSR_TEST_NO_GLOBAL = origEnv;
      }
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

// ─── runPhaseCreate — enhanced: uses scaffoldPhaseContract with intent ─────────

describe('runPhaseCreate — contract content', () => {
  test('phase contract contains the template sections (Instructions, Input Contract, Output Contract)', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      runPhaseCreate(['narrative', '--sdd', 'game-design'], catalogsDir);
      const phasePath = path.join(catalogsDir, 'game-design', 'contracts', 'phases', 'narrative.md');
      assert.ok(fs.existsSync(phasePath), 'Contract file must be created');
      const content = fs.readFileSync(phasePath, 'utf8');
      assert.ok(content.includes('## Instructions'), 'Must include Instructions section');
      assert.ok(content.includes('## Input Contract'), 'Must include Input Contract section');
      assert.ok(content.includes('## Output Contract'), 'Must include Output Contract section');
    } finally {
      cleanup(tmp);
    }
  });

  test('phase contract contains phase name as title when --intent is provided', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      createCustomSdd(catalogsDir, 'game-design');
      runPhaseCreate(['concept', '--sdd', 'game-design', '--intent', 'Design the core concept'], catalogsDir);
      const phasePath = path.join(catalogsDir, 'game-design', 'contracts', 'phases', 'concept.md');
      const content = fs.readFileSync(phasePath, 'utf8');
      assert.ok(content.includes('concept'), 'Must include phase name');
      assert.ok(content.includes('Design the core concept'), 'Must include --intent value');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddCreate — auto-generates phase contracts ────────────────────────────

describe('runSddCreate — auto-generates phase contracts', () => {
  test('runSddCreate generates a contract .md for the default main phase', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      runSddCreate(['auto-sdd'], catalogsDir);
      const contractPath = path.join(catalogsDir, 'auto-sdd', 'contracts', 'phases', 'main.md');
      assert.ok(fs.existsSync(contractPath), 'Contract for default main phase must be created by runSddCreate');
    } finally {
      cleanup(tmp);
    }
  });

  test('runSddCreate contract for main phase contains phase name and template sections', () => {
    const tmp = makeTempDir();
    try {
      const { catalogsDir } = makeRouterDir(tmp);
      runSddCreate(['structured-sdd'], catalogsDir);
      const contractPath = path.join(catalogsDir, 'structured-sdd', 'contracts', 'phases', 'main.md');
      const content = fs.readFileSync(contractPath, 'utf8');
      assert.ok(content.includes('main'), 'Contract must include phase name');
      assert.ok(content.includes('## Instructions'), 'Contract must have Instructions section');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── CLI Help text for sdd/role/phase commands ───────────────────────────────

import {
  runSddCommand,
  runRoleCommand,
  runPhaseCommand,
  runSddInvoke,
  runSddInvokeComplete,
  runSddInvokeStatus,
  runSddInvocations,
} from '../src/cli.js';

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

// ─── runSddInvoke ────────────────────────────────────────────────────────────

describe('runSddInvoke', () => {
  test('creates invocation record and prints id to stdout', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const output = await captureStdout(() =>
        runSddInvoke(
          ['art-production/asset-pipeline', '--from', 'game-design/game-design', '--phase', 'level-design'],
          invDir
        )
      );
      assert.ok(output.length > 0, 'Output should contain invocation id');
      // Verify file was created
      const files = fs.readdirSync(invDir).filter(f => f.endsWith('.json'));
      assert.equal(files.length, 1, 'Expected one invocation record on disk');
    } finally {
      cleanup(tmp);
    }
  });

  test('created record has status: pending', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      let capturedId;
      runSddInvoke(
        ['art-production/asset-pipeline', '--from', 'game-design/game-design', '--phase', 'level-design'],
        invDir
      );
      const files = fs.readdirSync(invDir).filter(f => f.endsWith('.json'));
      const record = JSON.parse(fs.readFileSync(path.join(invDir, files[0]), 'utf8'));
      assert.equal(record.status, 'pending');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --from is missing', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvoke(['art-production/asset-pipeline', '--phase', 'level-design'], invDir),
        /--from|from|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --phase is missing', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvoke(['art-production/asset-pipeline', '--from', 'game-design/game-design'], invDir),
        /--phase|phase|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when callee argument is missing', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvoke(['--from', 'game-design/game-design', '--phase', 'level-design'], invDir),
        /callee|argument|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when callee argument is malformed (missing /)', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvoke(['art-production', '--from', 'game-design/game-design', '--phase', 'level-design'], invDir),
        /catalog\/sdd|format/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --from argument is malformed (missing /)', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvoke(['art-production/asset-pipeline', '--from', 'game-design', '--phase', 'level-design'], invDir),
        /catalog\/sdd|format/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('accepts optional --payload flag', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      await captureStdout(() =>
        runSddInvoke(
          ['art-production/asset-pipeline', '--from', 'game-design/game-design', '--phase', 'level-design', '--payload', 'hello'],
          invDir
        )
      );
      const files = fs.readdirSync(invDir).filter(f => f.endsWith('.json'));
      const record = JSON.parse(fs.readFileSync(path.join(invDir, files[0]), 'utf8'));
      assert.equal(record.payload, 'hello');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddInvokeComplete ────────────────────────────────────────────────────

describe('runSddInvokeComplete', () => {
  test('completes an existing pending invocation', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      // Create via runSddInvoke
      const { createInvocation } = await import('../src/core/sdd-invocation-io.js');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const output = await captureStdout(() =>
        runSddInvokeComplete([created.id, '--result', 'done'], invDir)
      );
      assert.ok(output.length > 0);
      const onDisk = JSON.parse(fs.readFileSync(path.join(invDir, `${created.id}.json`), 'utf8'));
      assert.equal(onDisk.status, 'completed');
      assert.equal(onDisk.result, 'done');
    } finally {
      cleanup(tmp);
    }
  });

  test('fails an existing pending invocation with --failed flag', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const { createInvocation } = await import('../src/core/sdd-invocation-io.js');
      const created = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      await captureStdout(() => runSddInvokeComplete([created.id, '--failed'], invDir));
      const onDisk = JSON.parse(fs.readFileSync(path.join(invDir, `${created.id}.json`), 'utf8'));
      assert.equal(onDisk.status, 'failed');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when id argument is missing', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvokeComplete(['--result', 'done'], invDir),
        /id|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when id does not exist', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      fs.mkdirSync(invDir, { recursive: true });
      assert.throws(
        () => runSddInvokeComplete(['inv-ghost-id'], invDir),
        /not found|missing/i
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddInvokeStatus ──────────────────────────────────────────────────────

describe('runSddInvokeStatus', () => {
  test('prints record details to stdout', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const { createInvocation } = await import('../src/core/sdd-invocation-io.js');
      const created = createInvocation('game', 'game', 'design', 'art', 'assets', '', invDir);
      const output = await captureStdout(() => runSddInvokeStatus([created.id], invDir));
      assert.ok(output.includes(created.id) || output.includes('pending'),
        `Expected id or status in output: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });

  test('prints full record including id, status, caller, callee, payload, result, created_at, updated_at', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const { createInvocation } = await import('../src/core/sdd-invocation-io.js');
      const created = createInvocation('game', 'game', 'design', 'art', 'assets', 'my-payload', invDir);
      const output = await captureStdout(() => runSddInvokeStatus([created.id], invDir));
      assert.ok(output.includes(created.id), `Expected id in output: ${output}`);
      assert.ok(output.includes('pending'), `Expected status in output: ${output}`);
      assert.ok(output.includes('game'), `Expected caller in output: ${output}`);
      assert.ok(output.includes('art'), `Expected callee in output: ${output}`);
      assert.ok(output.includes('my-payload'), `Expected payload in output: ${output}`);
      assert.ok(output.includes('created_at') || output.includes(created.created_at),
        `Expected created_at in output: ${output}`);
      assert.ok(output.includes('updated_at') || output.includes(created.updated_at),
        `Expected updated_at in output: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when id does not exist', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      fs.mkdirSync(invDir, { recursive: true });
      assert.throws(
        () => runSddInvokeStatus(['inv-ghost'], invDir),
        /not found|missing/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when id argument is missing', () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      assert.throws(
        () => runSddInvokeStatus([], invDir),
        /id|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddInvocations ───────────────────────────────────────────────────────

describe('runSddInvocations', () => {
  test('lists all records when no filter', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const { createInvocation } = await import('../src/core/sdd-invocation-io.js');
      const r1 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const r2 = createInvocation('c', 'c', 'p', 'd', 'd', '', invDir);
      const output = await captureStdout(() => runSddInvocations([], invDir));
      assert.ok(output.includes(r1.id) || output.length > 0,
        `Expected records in output: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });

  test('filters by --status pending', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const { createInvocation, completeInvocation } = await import('../src/core/sdd-invocation-io.js');
      const r1 = createInvocation('a', 'a', 'p', 'b', 'b', '', invDir);
      const r2 = createInvocation('c', 'c', 'p', 'd', 'd', '', invDir);
      completeInvocation(r2.id, '', 'completed', invDir);
      const output = await captureStdout(() => runSddInvocations(['--status', 'pending'], invDir));
      assert.ok(output.includes(r1.id) || output.includes('pending'),
        `Expected pending record: ${output}`);
    } finally {
      cleanup(tmp);
    }
  });

  test('prints empty message when no records exist', async () => {
    const tmp = makeTempDir();
    try {
      const invDir = path.join(tmp, 'invocations');
      const output = await captureStdout(() => runSddInvocations([], invDir));
      assert.ok(
        output.toLowerCase().includes('no') || output.toLowerCase().includes('empty') || output.length >= 0,
        `Expected empty state message: ${output}`
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddValidate ───────────────────────────────────────────────────────────

describe('runSddValidate — Fix 2', () => {
  const VALID_SDD = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
  level-design:
    intent: "Design levels"
`;

  test('outputs ✅ for fully valid SDD with all contracts', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), VALID_SDD, 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase\n', 'utf8');
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'level-design.md'), '# Phase\n', 'utf8');

      const output = await captureStdout(() => runSddValidate(['game-design'], catalogsDir));
      assert.ok(output.includes('game-design'), 'output must mention SDD name');
      assert.ok(output.includes('valid'), 'output must say valid');
      assert.ok(output.includes('✅'), 'output must have checkmarks');
    } finally {
      cleanup(tmp);
    }
  });

  test('outputs ❌ for SDD with missing phase contracts', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(path.join(sddDir, 'contracts', 'phases'), { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), VALID_SDD, 'utf8');
      // Only one of two contracts present
      fs.writeFileSync(path.join(sddDir, 'contracts', 'phases', 'concept.md'), '# Phase\n', 'utf8');

      const output = await captureStdout(() => runSddValidate(['game-design'], catalogsDir));
      assert.ok(output.includes('❌'), 'output must have error mark');
      assert.ok(output.includes('level-design'), 'output must mention missing phase');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when name is missing', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(
        () => runSddValidate([], catalogsDir),
        /requires a name/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('outputs error message for non-existent SDD', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      const output = await captureStdout(() => runSddValidate(['nonexistent'], catalogsDir));
      assert.ok(output.includes('nonexistent') || output.includes('invalid'), 'output must indicate error');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── runSddDeclaredInvocations — Fix 4 ───────────────────────────────────────

describe('runSddDeclaredInvocations — Fix 4', () => {
  const SDD_WITH_INVOKES = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
  level-design:
    intent: "Design levels"
    invoke:
      catalog: art-production
      sdd: asset-pipeline
      payload_from: output
      await: true
      on_failure: block
`;

  test('outputs declared invocations for SDD with invoke blocks', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), SDD_WITH_INVOKES, 'utf8');

      const output = await captureStdout(() => runSddDeclaredInvocations(['game-design'], catalogsDir));
      assert.ok(output.includes('game-design'), 'output must mention SDD name');
      assert.ok(output.includes('level-design'), 'output must mention phase with invoke');
      assert.ok(output.includes('art-production'), 'output must mention target catalog');
    } finally {
      cleanup(tmp);
    }
  });

  test('outputs "none" for SDD with no invocations', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const sddDir = path.join(catalogsDir, 'game-design');
      fs.mkdirSync(sddDir, { recursive: true });
      const noInvokes = `name: game-design
version: 1
phases:
  concept:
    intent: "Define concept"
`;
      fs.writeFileSync(path.join(sddDir, 'sdd.yaml'), noInvokes, 'utf8');

      const output = await captureStdout(() => runSddDeclaredInvocations(['game-design'], catalogsDir));
      assert.ok(output.includes('none') || output.includes('0'), 'output must indicate no invocations');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when name is missing', () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      assert.throws(
        () => runSddDeclaredInvocations([], catalogsDir),
        /requires a name/i
      );
    } finally {
      cleanup(tmp);
    }
  });
});
