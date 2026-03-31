import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  deployGsrCommands,
  generateOpenCodeOverlay,
  mapPermissions,
  mergeOverlayWithExisting,
  mergeOverlayWithFile,
  removeGsrCommands,
  writeOpenCodeConfig,
} from '../src/adapters/opencode/overlay-generator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal assembled config with the given presets. */
function makeConfig(presets = {}) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'balanced',
    catalogs: {
      default: {
        availability: 'stable',
        presets,
      },
    },
  };
}

const MULTIVENDOR_PRESET = {
  availability: 'stable',
  phases: {
    orchestrator: [
      { target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const SAFETY_PRESET = {
  availability: 'unavailable',
  permissions: {
    read: true,
    write: false,
    edit: false,
    bash: false,
    delegate: true,
  },
  phases: {
    orchestrator: [
      { target: 'openai/gpt', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const HIDDEN_PRESET = {
  availability: 'experimental',
  hidden: true,
  phases: {
    orchestrator: [
      { target: 'openai/o3', kind: 'lane', phase: 'orchestrator', role: 'primary' },
    ],
  },
};

const NO_ORCHESTRATOR_PRESET = {
  availability: 'stable',
  phases: {
    verify: [
      { target: 'anthropic/claude-opus', kind: 'lane', phase: 'verify', role: 'judge' },
    ],
  },
};

// ── mapPermissions ────────────────────────────────────────────────────────────

describe('mapPermissions', () => {
  test('defaults to all true when permissions is undefined', () => {
    const tools = mapPermissions(undefined);
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
    assert.equal(tools.delegate, true);
    assert.equal(tools.delegation_read, true);
    assert.equal(tools.delegation_list, true);
  });

  test('defaults to all true when permissions is null', () => {
    const tools = mapPermissions(null);
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
  });

  test('applies restrictive safety permissions', () => {
    const tools = mapPermissions({
      read: true,
      write: false,
      edit: false,
      bash: false,
      delegate: true,
    });
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, false);
    assert.equal(tools.delegate, true);
    assert.equal(tools.delegation_read, true);
    assert.equal(tools.delegation_list, true);
  });

  test('delegate false disables delegation_read and delegation_list', () => {
    const tools = mapPermissions({ delegate: false });
    assert.equal(tools.delegate, false);
    assert.equal(tools.delegation_read, false);
    assert.equal(tools.delegation_list, false);
  });

  test('partial permissions use defaults for missing keys', () => {
    const tools = mapPermissions({ write: false });
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
  });
});

// ── generateOpenCodeOverlay ───────────────────────────────────────────────────

describe('generateOpenCodeOverlay', () => {
  test('generates gsr-{name} agent for multivendor preset', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-multivendor'], 'gsr-multivendor key exists');
    assert.equal(agent['gsr-multivendor'].mode, 'primary');
    assert.equal(agent['gsr-multivendor'].model, 'anthropic/claude-sonnet');
    assert.equal(warnings.length, 0);
  });

  test('generates correct description format', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);
    // Description now includes persona hint in brackets
    assert.match(agent['gsr-multivendor'].description, /^gsr: multivendor — stable \[.+\]$/);
  });

  test('generates restricted tools for safety preset', () => {
    const config = makeConfig({ safety: SAFETY_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-safety'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, false);
    assert.equal(tools.edit, false);
    assert.equal(tools.bash, false);
    assert.equal(tools.delegate, true);
  });

  test('sets hidden:true for hidden preset', () => {
    const config = makeConfig({ internal: HIDDEN_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-internal'].hidden, true);
  });

  test('non-hidden preset does not have hidden key', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(Object.prototype.hasOwnProperty.call(agent['gsr-multivendor'], 'hidden'), false);
  });

  test('skips preset with no orchestrator phase and adds warning', () => {
    const config = makeConfig({ noOrch: NO_ORCHESTRATOR_PRESET });
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /noOrch.*no orchestrator phase/);
  });

  test('generates multiple agents for multiple presets', () => {
    const config = makeConfig({
      multivendor: MULTIVENDOR_PRESET,
      safety: SAFETY_PRESET,
      internal: HIDDEN_PRESET,
    });
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 3);
    assert.ok(agent['gsr-multivendor']);
    assert.ok(agent['gsr-safety']);
    assert.ok(agent['gsr-internal']);
  });

  test('handles empty catalogs gracefully', () => {
    const config = { version: 3, catalogs: {} };
    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.equal(Object.keys(agent).length, 0);
    assert.equal(warnings.length, 0);
  });

  test('handles catalogs that exist but contain no presets', () => {
    const config = {
      version: 3,
      catalogs: {
        default: {
          availability: 'stable',
          presets: {},
        },
      },
    };

    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.deepEqual(agent, {});
    assert.deepEqual(warnings, []);
  });

  test('preset without permissions gets all-true tools', () => {
    const config = makeConfig({ multivendor: MULTIVENDOR_PRESET });
    const { agent } = generateOpenCodeOverlay(config);

    const tools = agent['gsr-multivendor'].tools;
    assert.equal(tools.read, true);
    assert.equal(tools.write, true);
    assert.equal(tools.edit, true);
    assert.equal(tools.bash, true);
    assert.equal(tools.delegate, true);
  });

  test('uses availability in description', () => {
    const config = makeConfig({ safety: SAFETY_PRESET });
    const { agent } = generateOpenCodeOverlay(config);
    // Description now includes persona hint in brackets
    assert.match(agent['gsr-safety'].description, /^gsr: safety — unavailable \[.+\]$/);
  });

  test('keeps all-hidden presets in the overlay and marks each as hidden', () => {
    const config = makeConfig({
      internal: HIDDEN_PRESET,
      labs: {
        availability: 'experimental',
        hidden: true,
        phases: {
          orchestrator: [
            { target: 'google/gemini-pro', kind: 'lane', phase: 'orchestrator', role: 'primary' },
          ],
        },
      },
    });

    const { agent, warnings } = generateOpenCodeOverlay(config);

    assert.equal(warnings.length, 0);
    assert.equal(agent['gsr-internal'].hidden, true);
    assert.equal(agent['gsr-labs'].hidden, true);
  });

  test('maps mixed permissions independently per generated agent', () => {
    const config = makeConfig({
      review: {
        availability: 'stable',
        permissions: {
          read: true,
          write: false,
          edit: true,
          bash: false,
          delegate: false,
        },
        phases: {
          orchestrator: [
            { target: 'openai/o3', kind: 'lane', phase: 'orchestrator', role: 'primary' },
          ],
        },
      },
    });

    const { agent } = generateOpenCodeOverlay(config);
    const tools = agent['gsr-review'].tools;

    assert.deepEqual(tools, {
      read: true,
      write: false,
      edit: true,
      bash: false,
      delegate: false,
      delegation_read: false,
      delegation_list: false,
    });
  });
});

// ── mergeOverlayWithExisting ──────────────────────────────────────────────────

describe('mergeOverlayWithExisting', () => {
  test('preserves non-gsr-* agent keys', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };
    const existing = {
      agent: {
        'my-custom-agent': { model: 'openai/gpt-4o' },
        'gentleman': { mode: 'primary' },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.ok(result.agent['my-custom-agent'], 'my-custom-agent preserved');
    assert.ok(result.agent['gentleman'], 'gentleman preserved');
    assert.ok(result.agent['gsr-balanced'], 'gsr-balanced added');
  });

  test('removes stale gsr-* entries', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };
    const existing = {
      agent: {
        'gsr-old-preset': { mode: 'primary' },
        'gsr-another-stale': { mode: 'primary' },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(Object.prototype.hasOwnProperty.call(result.agent, 'gsr-old-preset'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.agent, 'gsr-another-stale'), false);
    assert.ok(result.agent['gsr-balanced']);
  });

  test('works with empty existing config', () => {
    const overlay = {
      agent: { 'gsr-balanced': { mode: 'primary' } },
    };

    const result = mergeOverlayWithExisting(overlay, {});

    assert.ok(result.agent['gsr-balanced']);
  });

  test('works with existing config that has no agent key', () => {
    const overlay = {
      agent: { 'gsr-safety': { mode: 'primary' } },
    };
    const existing = { theme: 'dark', someOtherKey: 42 };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(result.theme, 'dark');
    assert.equal(result.someOtherKey, 42);
    assert.ok(result.agent['gsr-safety']);
  });

  test('does not mutate the existing object', () => {
    const overlay = { agent: { 'gsr-balanced': { mode: 'primary' } } };
    const existing = {
      agent: { 'gsr-old': { mode: 'primary' } },
    };
    const existingCopy = JSON.parse(JSON.stringify(existing));

    mergeOverlayWithExisting(overlay, existing);

    // existing should be unchanged
    assert.deepEqual(existing, existingCopy);
  });

  test('overlay with multiple agents merges all', () => {
    const overlay = {
      agent: {
        'gsr-balanced': { mode: 'primary' },
        'gsr-safety': { mode: 'primary', tools: { write: false } },
      },
    };
    const existing = { agent: { 'sdd-explorer': { mode: 'primary' } } };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.ok(result.agent['gsr-balanced']);
    assert.ok(result.agent['gsr-safety']);
    assert.ok(result.agent['sdd-explorer']);
  });
});

// ── mergeOverlayWithFile / writeOpenCodeConfig (fs paths) ────────────────────

describe('mergeOverlayWithFile', () => {
  test('returns clean overlay when config file does not exist', () => {
    const nonExistentPath = path.join(os.tmpdir(), `gsr-nonexistent-${Date.now()}.json`);
    const overlay = { agent: { 'gsr-test': { mode: 'primary' } } };

    const result = mergeOverlayWithFile(overlay, nonExistentPath);

    assert.ok(result.agent['gsr-test'], 'gsr-test agent present');
    assert.equal(Object.keys(result.agent).length, 1, 'only the overlay agent is present');
  });

  test('mergeOverlayWithFile handles corrupt JSON file gracefully', () => {
    const tempPath = path.join(os.tmpdir(), `gsr-corrupt-${Date.now()}.json`);
    fs.writeFileSync(tempPath, '{ this is not valid json :::}', 'utf8');

    const overlay = { agent: { 'gsr-test': { mode: 'primary' } } };

    try {
      const result = mergeOverlayWithFile(overlay, tempPath);

      // Falls back to empty config; only overlay agent survives
      assert.ok(result.agent['gsr-test'], 'gsr-test agent present after corrupt file fallback');
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  });
});

describe('writeOpenCodeConfig', () => {
  test('creates parent directories and writes valid JSON', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-write-cfg-'));
    const nestedPath = path.join(tempDir, 'deeply', 'nested', 'opencode.json');

    try {
      const config = { agent: { 'gsr-balanced': { mode: 'primary' } } };
      const writtenPath = writeOpenCodeConfig(config, nestedPath);

      assert.equal(writtenPath, nestedPath, 'returns the written path');
      assert.ok(fs.existsSync(nestedPath), 'file was created');

      const raw = fs.readFileSync(nestedPath, 'utf8');
      // Must be valid JSON
      const parsed = JSON.parse(raw);
      assert.ok(parsed.agent, 'parsed JSON has agent key');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('writeOpenCodeConfig output can be read back as identical JSON', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-write-rt-'));
    const targetPath = path.join(tempDir, 'opencode.json');

    try {
      const config = {
        agent: {
          'gsr-fast': { mode: 'primary', model: 'anthropic/claude-sonnet' },
          'gsr-safety': { mode: 'primary', model: 'openai/gpt', tools: { write: false } },
        },
        theme: 'dark',
      };

      writeOpenCodeConfig(config, targetPath);

      const raw = fs.readFileSync(targetPath, 'utf8');
      const readBack = JSON.parse(raw);

      assert.deepEqual(readBack, config, 'read-back matches original config');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
});

// ── deployGsrCommands / removeGsrCommands ────────────────────────────────────

describe('deployGsrCommands', () => {
  test('deploys 18 markdown files including gsr.md', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-deploy-'));

    try {
      const result = deployGsrCommands({ commandsDir: tempDir });

      // No error from source-dir lookup
      assert.equal(result.error, undefined, 'no error finding source directory');

      // 17 gsr-*.md + 1 gsr.md = 18 total files in target dir
      const deployed = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      assert.equal(deployed.length, 18, `expected 18 .md files, got ${deployed.length}: ${deployed.join(', ')}`);

      // gsr.md specifically must be present
      assert.ok(deployed.includes('gsr.md'), 'gsr.md dispatcher was deployed');

      // All written count matches
      assert.equal(result.written, 18, 'deployGsrCommands reports 18 written files');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('skips identical files on re-deploy', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-redeploy-'));

    try {
      // First deploy — all 18 written
      const first = deployGsrCommands({ commandsDir: tempDir });
      assert.equal(first.written, 18, 'first deploy writes all 18 files');

      // Second deploy — all 18 skipped (identical content)
      const second = deployGsrCommands({ commandsDir: tempDir });
      assert.equal(second.written, 0, 'second deploy writes 0 files (all identical)');
      assert.equal(second.skipped, 18, 'second deploy skips all 18 identical files');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
});

describe('removeGsrCommands', () => {
  test('removes only gsr-*.md files — gsr.md survives uninstall (accepted behavior)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-remove-'));

    try {
      // Deploy all 18 files first
      deployGsrCommands({ commandsDir: tempDir });

      const beforeRemove = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      assert.equal(beforeRemove.length, 18, 'precondition: 18 files deployed');

      // Remove gsr-*.md files
      const result = removeGsrCommands({ commandsDir: tempDir });

      // 17 gsr-*.md files should be removed
      assert.equal(result.removed, 17, 'removeGsrCommands removes 17 gsr-*.md files');

      const afterRemove = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));

      // gsr.md (no hyphen after gsr) is NOT matched by gsr-* glob — it survives
      // This is documented, accepted behavior: the dispatcher is a harmless no-op
      assert.equal(afterRemove.length, 1, 'exactly 1 .md file survives (gsr.md)');
      assert.ok(afterRemove.includes('gsr.md'), 'gsr.md dispatcher survives removeGsrCommands');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('removeGsrCommands on empty dir returns zero removed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-empty-'));

    try {
      const result = removeGsrCommands({ commandsDir: tempDir });
      assert.equal(result.removed, 0, 'nothing to remove from empty dir');
      assert.deepEqual(result.files, [], 'files list is empty');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
});
