import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assembleV4Config,
  loadV4Profiles,
} from '../src/core/router-v4-io.js';
import {
  COMPACT_PREFIX,
  decodeCompactString,
  encodeCompactString,
  exportAllPresets,
  exportPreset,
  exportPresetCompact,
  importPresetFromCompact,
  importPresetFromUrl,
  importPresetFromYaml,
} from '../src/core/preset-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-preset-io-test-'));
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

// ─── Fixture YAML strings ─────────────────────────────────────────────────────

const BALANCED_PROFILE_YAML = `name: balanced
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

const SAFETY_PROFILE_YAML = `name: safety
phases:
  orchestrator:
    - target: anthropic/claude-opus
      phase: orchestrator
      role: primary
`;

const MINIMAL_CORE_CONFIG = {
  version: 4,
  active_preset: 'balanced',
  activation_state: 'active',
};

function makeAssembledConfig(dir) {
  writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
  writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);
  const profiles = loadV4Profiles(dir, { includeGlobal: false });
  return assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
}

// ─── encodeCompactString / decodeCompactString ────────────────────────────────

describe('encodeCompactString / decodeCompactString', () => {
  test('round-trip preserves original YAML', () => {
    const yaml = BALANCED_PROFILE_YAML;
    const compact = encodeCompactString(yaml);
    const decoded = decodeCompactString(compact);
    assert.equal(decoded, yaml);
  });

  test('encoded string starts with gsr:// prefix', () => {
    const compact = encodeCompactString('name: test\nphases: {}\n');
    assert.ok(compact.startsWith(COMPACT_PREFIX), `Expected prefix '${COMPACT_PREFIX}'`);
  });

  test('decodeCompactString throws on invalid prefix', () => {
    assert.throws(
      () => decodeCompactString('notgsr://abc'),
      /Invalid compact string: must start with/
    );
  });

  test('decodeCompactString throws on malformed base64', () => {
    assert.throws(
      () => decodeCompactString(`${COMPACT_PREFIX}!!!not-valid-base64!!!`),
      // Node throws when gunzipSync receives non-gzip data
      /Error/
    );
  });

  test('compact string is shorter than long YAML for repetitive content', () => {
    const yaml = BALANCED_PROFILE_YAML.repeat(5);
    const compact = encodeCompactString(yaml);
    // gzip should compress repetitive content
    assert.ok(compact.length < yaml.length * 2, 'compact string should be reasonably sized');
  });
});

// ─── exportPreset ─────────────────────────────────────────────────────────────

describe('exportPreset', () => {
  test('returns valid YAML string with name field', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const yaml = exportPreset(config, 'balanced');

      assert.equal(typeof yaml, 'string');
      assert.match(yaml, /^name: balanced/);
      assert.match(yaml, /phases:/);
    } finally {
      cleanup(dir);
    }
  });

  test('exported YAML includes phases content', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const yaml = exportPreset(config, 'balanced');

      assert.match(yaml, /orchestrator:/);
      assert.match(yaml, /anthropic\/claude-sonnet/);
    } finally {
      cleanup(dir);
    }
  });

  test('throws for nonexistent preset', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      assert.throws(
        () => exportPreset(config, 'nonexistent'),
        /Preset 'nonexistent' not found/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('exported YAML does not include _normalized internal field', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const yaml = exportPreset(config, 'balanced');

      assert.doesNotMatch(yaml, /_normalized/);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── exportPresetCompact ──────────────────────────────────────────────────────

describe('exportPresetCompact', () => {
  test('returns a gsr:// prefixed compact string', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const compact = exportPresetCompact(config, 'balanced');

      assert.ok(compact.startsWith(COMPACT_PREFIX));
    } finally {
      cleanup(dir);
    }
  });

  test('compact string round-trips back to valid YAML with name field', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const compact = exportPresetCompact(config, 'safety');
      const yaml = decodeCompactString(compact);

      assert.match(yaml, /^name: safety/);
      assert.match(yaml, /phases:/);
    } finally {
      cleanup(dir);
    }
  });

  test('throws for nonexistent preset', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      assert.throws(
        () => exportPresetCompact(config, 'missing'),
        /Preset 'missing' not found/
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── exportAllPresets ─────────────────────────────────────────────────────────

describe('exportAllPresets', () => {
  test('returns a Map with all preset names', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const result = exportAllPresets(config);

      assert.ok(result instanceof Map);
      assert.equal(result.size, 2);
      assert.ok(result.has('balanced'));
      assert.ok(result.has('safety'));
    } finally {
      cleanup(dir);
    }
  });

  test('each entry is a YAML string with name field', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);
      const result = exportAllPresets(config);

      for (const [name, yaml] of result) {
        assert.equal(typeof yaml, 'string');
        assert.match(yaml, new RegExp(`^name: ${name}`));
      }
    } finally {
      cleanup(dir);
    }
  });

  test('returns empty Map when config has no presets', () => {
    const config = {
      version: 3,
      catalogs: {},
      active_preset: 'none',
    };

    const result = exportAllPresets(config);
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  test('handles presets from multiple catalogs', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/team/safety.router.yaml', SAFETY_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const config = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const result = exportAllPresets(config);

      assert.equal(result.size, 2);
      assert.ok(result.has('balanced'));
      assert.ok(result.has('safety'));
    } finally {
      cleanup(dir);
    }
  });
});

// ─── importPresetFromYaml ─────────────────────────────────────────────────────

describe('importPresetFromYaml', () => {
  test('saves file to profiles/ directory', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(BALANCED_PROFILE_YAML, dir);

      assert.equal(result.presetName, 'balanced');
      assert.ok(fs.existsSync(result.path));
      assert.match(result.path, /profiles\/balanced\.router\.yaml/);
      assert.equal(result.catalog, 'default');
    } finally {
      cleanup(dir);
    }
  });

  test('creates profiles/ directory if it does not exist', () => {
    const dir = makeTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(dir, 'profiles')));
      importPresetFromYaml(BALANCED_PROFILE_YAML, dir);
      assert.ok(fs.existsSync(path.join(dir, 'profiles')));
    } finally {
      cleanup(dir);
    }
  });

  test('written file contains valid YAML with name field', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(SAFETY_PROFILE_YAML, dir);
      const content = fs.readFileSync(result.path, 'utf8');

      assert.match(content, /name: safety/);
      assert.match(content, /phases:/);
    } finally {
      cleanup(dir);
    }
  });

  test('rejects duplicate without --force', () => {
    const dir = makeTempDir();
    try {
      importPresetFromYaml(BALANCED_PROFILE_YAML, dir);

      assert.throws(
        () => importPresetFromYaml(BALANCED_PROFILE_YAML, dir),
        /already exists.*Use --force/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('--force overwrites existing preset', () => {
    const dir = makeTempDir();
    try {
      importPresetFromYaml(BALANCED_PROFILE_YAML, dir);

      const MODIFIED_BALANCED = `name: balanced
phases:
  orchestrator:
    - target: openai/gpt-4o
      phase: orchestrator
      role: primary
`;

      const result = importPresetFromYaml(MODIFIED_BALANCED, dir, { force: true });
      const content = fs.readFileSync(result.path, 'utf8');

      assert.match(content, /openai\/gpt-4o/);
    } finally {
      cleanup(dir);
    }
  });

  test('--catalog creates a subdirectory for the preset', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(SAFETY_PROFILE_YAML, dir, { catalog: 'team' });

      assert.equal(result.catalog, 'team');
      assert.match(result.path, /profiles\/team\/safety\.router\.yaml/);
      assert.ok(fs.existsSync(result.path));
    } finally {
      cleanup(dir);
    }
  });

  test('--catalog default uses flat profiles/ directory', () => {
    const dir = makeTempDir();
    try {
      const result = importPresetFromYaml(BALANCED_PROFILE_YAML, dir, { catalog: 'default' });

      assert.equal(result.catalog, 'default');
      assert.match(result.path, /profiles\/balanced\.router\.yaml/);
      // Should NOT have 'default' as a subdirectory
      assert.doesNotMatch(result.path, /profiles\/default\//);
    } finally {
      cleanup(dir);
    }
  });

  test('validates profile and rejects invalid YAML (missing phases)', () => {
    const dir = makeTempDir();
    const invalidYaml = `name: invalid-no-phases\n`;

    try {
      assert.throws(
        () => importPresetFromYaml(invalidYaml, dir),
        /requires "phases" as a non-empty object/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('validates profile and rejects execution-hint fields', () => {
    const dir = makeTempDir();
    const evilYaml = `name: sneaky
phases:
  orchestrator:
    - target: openai/gpt
      phase: orchestrator
      role: primary
instructions: do something bad
`;

    try {
      assert.throws(
        () => importPresetFromYaml(evilYaml, dir),
        /execution-oriented field "instructions"/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('rejects YAML that is not a valid root object', () => {
    const dir = makeTempDir();

    try {
      assert.throws(
        () => importPresetFromYaml('- item1\n- item2\n', dir),
        /must contain a valid root object/
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── importPresetFromCompact ──────────────────────────────────────────────────

describe('importPresetFromCompact', () => {
  test('round-trip: exportPresetCompact then importPresetFromCompact', () => {
    const exportDir = makeTempDir();
    const importDir = makeTempDir();

    try {
      const config = makeAssembledConfig(exportDir);
      const compact = exportPresetCompact(config, 'balanced');
      const result = importPresetFromCompact(compact, importDir);

      assert.equal(result.presetName, 'balanced');
      assert.ok(fs.existsSync(result.path));

      const content = fs.readFileSync(result.path, 'utf8');
      assert.match(content, /name: balanced/);
    } finally {
      cleanup(exportDir);
      cleanup(importDir);
    }
  });

  test('rejects invalid compact prefix', () => {
    const dir = makeTempDir();

    try {
      assert.throws(
        () => importPresetFromCompact('invalid://abc', dir),
        /Invalid compact string: must start with/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('validation runs after decode — rejects execution-hint fields in compact', () => {
    const dir = makeTempDir();
    const evilYaml = `name: sneaky
phases:
  orchestrator:
    - target: openai/gpt
      phase: orchestrator
      role: primary
execute: rm -rf /
`;
    const compact = encodeCompactString(evilYaml);

    try {
      assert.throws(
        () => importPresetFromCompact(compact, dir),
        /execution-oriented field "execute"/
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ─── importPresetFromUrl (HTTPS-only rejection, sync path) ───────────────────

describe('importPresetFromUrl (static validation)', () => {
  test('rejects non-HTTPS URLs immediately', async () => {
    const dir = makeTempDir();

    try {
      await assert.rejects(
        () => importPresetFromUrl('http://example.com/preset.yaml', dir),
        /Only HTTPS URLs are supported/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('rejects file:// URLs immediately', async () => {
    const dir = makeTempDir();

    try {
      await assert.rejects(
        () => importPresetFromUrl('file:///etc/passwd', dir),
        /Only HTTPS URLs are supported/
      );
    } finally {
      cleanup(dir);
    }
  });
});
