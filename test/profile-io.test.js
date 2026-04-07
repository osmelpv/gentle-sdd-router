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
  // Deprecated re-export — must still be importable
  loadPresets,
  // New canonical name
  loadProfiles,
} from '../src/core/profile-io.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-profile-io-test-'));
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

const VISIBLE_PROFILE_YAML = `name: visible-preset
visible: true
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

const BUILTIN_PROFILE_YAML = `name: builtin-preset
builtin: true
phases:
  orchestrator:
    - target: anthropic/claude-sonnet
      phase: orchestrator
      role: primary
`;

const VISIBLE_AND_BUILTIN_YAML = `name: both-preset
visible: true
builtin: true
phases:
  orchestrator:
    - target: openai/gpt-4o
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

// ─── loadProfiles / loadPresets deprecation ────────────────────────────────

describe('loadProfiles and loadPresets (deprecated)', () => {
  test('loadProfiles is a function exported from profile-io', () => {
    assert.equal(typeof loadProfiles, 'function');
  });

  test('loadPresets is the same function as loadProfiles (deprecated re-export)', () => {
    assert.equal(loadPresets, loadProfiles);
  });
});

// ─── loadV4Profiles return shape — visible and builtin fields ─────────────────

describe('loadV4Profiles return shape — visible and builtin', () => {
  test('profile without visible field defaults to visible: false', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const balanced = profiles.find((p) => p.content.name === 'balanced');
      assert.ok(balanced, 'balanced profile should be loaded');
      assert.equal(balanced.visible, false, 'visible should default to false');
    } finally {
      cleanup(dir);
    }
  });

  test('profile without builtin field defaults to builtin: false', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const balanced = profiles.find((p) => p.content.name === 'balanced');
      assert.ok(balanced, 'balanced profile should be loaded');
      assert.equal(balanced.builtin, false, 'builtin should default to false');
    } finally {
      cleanup(dir);
    }
  });

  test('profile with visible: true has visible: true on result entry', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/visible-preset.router.yaml', VISIBLE_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const visible = profiles.find((p) => p.content.name === 'visible-preset');
      assert.ok(visible, 'visible-preset should be loaded');
      assert.equal(visible.visible, true, 'visible should be true when set in YAML');
    } finally {
      cleanup(dir);
    }
  });

  test('profile with builtin: true has builtin: true on result entry', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/builtin-preset.router.yaml', BUILTIN_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const builtin = profiles.find((p) => p.content.name === 'builtin-preset');
      assert.ok(builtin, 'builtin-preset should be loaded');
      assert.equal(builtin.builtin, true, 'builtin should be true when set in YAML');
    } finally {
      cleanup(dir);
    }
  });

  test('profile with both visible and builtin set correctly propagates both', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/both-preset.router.yaml', VISIBLE_AND_BUILTIN_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const both = profiles.find((p) => p.content.name === 'both-preset');
      assert.ok(both, 'both-preset should be loaded');
      assert.equal(both.visible, true, 'visible should be true');
      assert.equal(both.builtin, true, 'builtin should be true');
    } finally {
      cleanup(dir);
    }
  });

  test('multiple profiles get correct visible/builtin defaults', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/visible-preset.router.yaml', VISIBLE_PROFILE_YAML);
      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      const balanced = profiles.find((p) => p.content.name === 'balanced');
      const visible = profiles.find((p) => p.content.name === 'visible-preset');

      assert.equal(balanced.visible, false, 'balanced should not be visible by default');
      assert.equal(visible.visible, true, 'visible-preset should have visible: true');
    } finally {
      cleanup(dir);
    }
  });
});

// ─── assembleV4Config — profilesMap and visibleProfiles ───────────────────────

describe('assembleV4Config — profilesMap and visibleProfiles', () => {
  test('assembled config has profilesMap as a Map', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);

      assert.ok(config.profilesMap instanceof Map, 'profilesMap should be a Map');
    } finally {
      cleanup(dir);
    }
  });

  test('profilesMap contains all loaded profiles keyed by name', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);

      assert.ok(config.profilesMap.has('balanced'), 'profilesMap should have balanced');
      assert.ok(config.profilesMap.has('safety'), 'profilesMap should have safety');
      assert.equal(config.profilesMap.size, 2, 'profilesMap should have exactly 2 entries');
    } finally {
      cleanup(dir);
    }
  });

  test('assembled config has visibleProfiles as an array', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);

      assert.ok(Array.isArray(config.visibleProfiles), 'visibleProfiles should be an array');
    } finally {
      cleanup(dir);
    }
  });

  test('visibleProfiles is empty when no profiles have visible: true', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);

      // balanced and safety have no visible field, so both default to false
      assert.equal(config.visibleProfiles.length, 0, 'visibleProfiles should be empty when none are visible');
    } finally {
      cleanup(dir);
    }
  });

  test('visibleProfiles contains names of profiles with visible: true', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/visible-preset.router.yaml', VISIBLE_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const config = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      assert.ok(config.visibleProfiles.includes('visible-preset'), 'visible-preset should be in visibleProfiles');
      assert.ok(!config.visibleProfiles.includes('balanced'), 'balanced should NOT be in visibleProfiles');
      assert.equal(config.visibleProfiles.length, 1, 'exactly 1 visible profile');
    } finally {
      cleanup(dir);
    }
  });

  test('catalogsMap is still present after Phase 3 (compat shim preserved)', () => {
    const dir = makeTempDir();
    try {
      const config = makeAssembledConfig(dir);

      // Compat shim must NOT be removed
      assert.ok(config.catalogs, 'catalogs (catalogsMap) must still exist');
      assert.ok(config.catalogs.default, 'default catalog must still exist');
    } finally {
      cleanup(dir);
    }
  });
});

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

describe('exportAllProfiles', () => {
  test('returns a Map with all profile names', () => {
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

  test('handles profiles from multiple catalog subdirectories', () => {
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

describe('importProfileFromYaml', () => {
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

  test('--force overwrites existing profile', () => {
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

  test('--catalog creates a subdirectory for the profile', () => {
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

describe('importProfileFromCompact', () => {
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

describe('importProfileFromUrl (static validation)', () => {
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
