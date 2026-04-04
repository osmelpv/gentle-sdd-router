import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assembleV4Config,
  buildV4WritePlan,
  disassembleV4Config,
  loadV4Profiles,
  validateProfileFile,
} from '../src/core/router-v4-io.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-v4-io-test-'));
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

const TURBO_PROFILE_YAML = `name: turbo
phases:
  orchestrator:
    - target: openai/gpt-4o
      phase: orchestrator
      role: primary
`;

const RESTRICTED_HIDDEN_PROFILE_YAML = `name: internal
hidden: true
permissions:
  read: true
  write: false
  edit: true
  bash: false
  delegate: false
phases:
  orchestrator:
    - target: openai/o3
      phase: orchestrator
      role: primary
`;

const MINIMAL_CORE_CONFIG = {
  version: 4,
  active_preset: 'balanced',
  activation_state: 'active',
};

describe('validateProfileFile', () => {
  test('valid profile passes without throwing', () => {
    const profile = {
      name: 'balanced',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'anthropic/claude-sonnet' }],
      },
    };

    const result = validateProfileFile(profile, '/fake/balanced.router.yaml');
    assert.equal(result, profile);
  });

  test('missing name throws', () => {
    const profile = {
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'model/x' }],
      },
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/x.router.yaml'),
      /requires a non-empty "name" field/
    );
  });

  test('empty name throws', () => {
    const profile = {
      name: '  ',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'model/x' }],
      },
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/x.router.yaml'),
      /requires a non-empty "name" field/
    );
  });

  test('missing phases throws', () => {
    const profile = { name: 'balanced' };

    assert.throws(
      () => validateProfileFile(profile, '/fake/balanced.router.yaml'),
      /requires "phases" as a non-empty object/
    );
  });

  test('empty phases object throws', () => {
    const profile = { name: 'balanced', phases: {} };

    assert.throws(
      () => validateProfileFile(profile, '/fake/balanced.router.yaml'),
      /requires "phases" as a non-empty object/
    );
  });

  test('execution hints in profile throws', () => {
    const profileWithInstructions = {
      name: 'bad',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'model/x' }],
      },
      instructions: 'do this now',
    };

    assert.throws(
      () => validateProfileFile(profileWithInstructions, '/fake/bad.router.yaml'),
      /execution-oriented field "instructions"/
    );
  });

  test('execution hints: execute field throws', () => {
    const profile = {
      name: 'bad',
      phases: { orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'model/x' }] },
      execute: 'something',
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/bad.router.yaml'),
      /execution-oriented field "execute"/
    );
  });

  test('profile with valid permissions passes validation', () => {
    const profile = {
      name: 'safety',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
      permissions: {
        read: true,
        write: false,
        edit: false,
        bash: false,
        delegate: true,
      },
    };

    const result = validateProfileFile(profile, '/fake/safety.router.yaml');
    assert.equal(result, profile);
    assert.deepEqual(result.permissions, profile.permissions);
  });

  test('profile with partial permissions passes validation', () => {
    const profile = {
      name: 'restricted',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
      permissions: { write: false, edit: false },
    };

    const result = validateProfileFile(profile, '/fake/restricted.router.yaml');
    assert.equal(result, profile);
  });

  test('profile with hidden:true passes validation', () => {
    const profile = {
      name: 'internal',
      hidden: true,
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
    };

    const result = validateProfileFile(profile, '/fake/internal.router.yaml');
    assert.equal(result, profile);
    assert.equal(result.hidden, true);
  });

  test('profile with hidden:false passes validation', () => {
    const profile = {
      name: 'visible',
      hidden: false,
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
    };

    const result = validateProfileFile(profile, '/fake/visible.router.yaml');
    assert.equal(result, profile);
  });

  test('profile with non-boolean hidden throws', () => {
    const profile = {
      name: 'bad',
      hidden: 'yes',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/bad.router.yaml'),
      /"hidden" but it must be a boolean/
    );
  });

  test('profile with unknown permission key throws', () => {
    const profile = {
      name: 'bad',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
      permissions: { read: true, execute: true },
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/bad.router.yaml'),
      /unknown permission key "execute"/
    );
  });

  test('profile with non-boolean permission value throws', () => {
    const profile = {
      name: 'bad',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
      permissions: { read: 'yes' },
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/bad.router.yaml'),
      /non-boolean value for permission "read"/
    );
  });

  test('profile with permissions as non-object throws', () => {
    const profile = {
      name: 'bad',
      phases: {
        orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'openai/gpt' }],
      },
      permissions: 'all',
    };

    assert.throws(
      () => validateProfileFile(profile, '/fake/bad.router.yaml'),
      /"permissions" but it must be an object/
    );
  });
});

describe('loadV4Profiles', () => {
  test('loads profile files from profiles/ directory', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      assert.equal(profiles.length, 2);

      const balanced = profiles.find((p) => p.content.name === 'balanced');
      const safety = profiles.find((p) => p.content.name === 'safety');

      assert.ok(balanced, 'balanced profile loaded');
      assert.equal(balanced.catalogName, 'default');
      assert.ok(balanced.fileName.endsWith('.router.yaml'));
      assert.ok(balanced.filePath.includes('profiles'));

      assert.ok(safety, 'safety profile loaded');
      assert.equal(safety.catalogName, 'default');
    } finally {
      cleanup(dir);
    }
  });

  test('infers catalog from subdirectory name', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/experimental/turbo.router.yaml', TURBO_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      assert.equal(profiles.length, 2);

      const balanced = profiles.find((p) => p.content.name === 'balanced');
      const turbo = profiles.find((p) => p.content.name === 'turbo');

      assert.equal(balanced.catalogName, 'default');
      assert.equal(turbo.catalogName, 'experimental');
    } finally {
      cleanup(dir);
    }
  });

  test('ignores non-.router.yaml files in profiles directory', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/README.md', '# docs');
      writeFile(dir, 'profiles/.gitkeep', '');

      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      assert.equal(profiles.length, 1);
      assert.equal(profiles[0].content.name, 'balanced');
    } finally {
      cleanup(dir);
    }
  });

  test('throws when profiles/ directory does not exist', () => {
    const dir = makeTempDir();

    try {
      assert.throws(
        () => loadV4Profiles(dir, { includeGlobal: false }),
        /No profiles directory found/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('throws when no .router.yaml files found', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/.gitkeep', '');

      assert.throws(
        () => loadV4Profiles(dir, { includeGlobal: false }),
        /No profile files found/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('throws when a profile file fails validation', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/bad.router.yaml', 'name: bad\n');

      assert.throws(
        () => loadV4Profiles(dir, { includeGlobal: false }),
        /requires "phases" as a non-empty object/
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe('assembleV4Config', () => {
  test('produces a v3-compatible structure from core config and profiles', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      assert.equal(assembled.version, 3);
      assert.equal(assembled.active_preset, 'balanced');
      assert.equal(assembled.activation_state, 'active');
      assert.ok(isObject(assembled.catalogs), 'catalogs is an object');
      assert.ok(isObject(assembled.catalogs.default), 'default catalog exists');
      assert.ok(isObject(assembled.catalogs.default.presets), 'presets exist');
      assert.ok(assembled.catalogs.default.presets.balanced, 'balanced preset exists');
      assert.ok(assembled.catalogs.default.presets.safety, 'safety preset exists');
    } finally {
      cleanup(dir);
    }
  });

  test('_v4Source is non-enumerable on assembled config', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      const descriptor = Object.getOwnPropertyDescriptor(assembled, '_v4Source');
      assert.ok(descriptor, '_v4Source property exists');
      assert.equal(descriptor.enumerable, false, '_v4Source is not enumerable');

      const keys = Object.keys(assembled);
      assert.ok(!keys.includes('_v4Source'), '_v4Source not in Object.keys()');
    } finally {
      cleanup(dir);
    }
  });

  test('groups profiles into catalogs by subdirectory', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/experimental/turbo.router.yaml', TURBO_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      assert.ok(assembled.catalogs.default?.presets?.balanced, 'balanced in default catalog');
      assert.ok(assembled.catalogs.experimental?.presets?.turbo, 'turbo in experimental catalog');
    } finally {
      cleanup(dir);
    }
  });

  test('preserves permissions and hidden fields in the assembled normalized config', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/internal.router.yaml', RESTRICTED_HIDDEN_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const preset = assembled.catalogs.default.presets.internal;

      assert.equal(preset.hidden, true);
      assert.deepEqual(preset.permissions, {
        read: true,
        write: false,
        edit: true,
        bash: false,
        delegate: false,
      });
    } finally {
      cleanup(dir);
    }
  });

  test('throws on duplicate preset names across files', () => {
    const DUPLICATE_BALANCED_YAML = `name: balanced
phases:
  orchestrator:
    - target: openai/gpt-4
      phase: orchestrator
      role: primary
`;

    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/experimental/balanced.router.yaml', DUPLICATE_BALANCED_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });

      assert.throws(
        () => assembleV4Config(MINIMAL_CORE_CONFIG, profiles),
        /Duplicate preset name "balanced"/
      );
    } finally {
      cleanup(dir);
    }
  });

  test('uses catalog availability from coreConfig.catalogs when defined', () => {
    const coreWithCatalogMeta = {
      ...MINIMAL_CORE_CONFIG,
      catalogs: {
        default: {
          availability: 'experimental',
        },
      },
    };

    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(coreWithCatalogMeta, profiles);

      assert.equal(assembled.catalogs.default.availability, 'experimental');
    } finally {
      cleanup(dir);
    }
  });

  test('defaults catalog availability to stable when not in coreConfig', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      assert.equal(assembled.catalogs.default.availability, 'stable');
    } finally {
      cleanup(dir);
    }
  });
});

describe('disassembleV4Config', () => {
  test('round-trip: assemble then disassemble preserves preset content', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const { coreFields, profiles: disassembled } = disassembleV4Config(assembled);

      assert.equal(coreFields.version, 5);
      assert.equal(coreFields.active_preset, 'balanced');
      assert.equal(coreFields.activation_state, 'active');
      assert.equal(coreFields.active_sdd, 'agent-orchestrator');

      assert.equal(disassembled.length, 2);

      const balancedOut = disassembled.find((p) => p.name === 'balanced');
      const safetyOut = disassembled.find((p) => p.name === 'safety');

      assert.ok(balancedOut, 'balanced preserved');
      assert.equal(balancedOut.catalog, 'default');
      assert.equal(balancedOut.sdd, 'agent-orchestrator');
      assert.ok(balancedOut.content.phases, 'phases preserved');

      assert.ok(safetyOut, 'safety preserved');
      assert.equal(safetyOut.catalog, 'default');
      assert.equal(safetyOut.sdd, 'agent-orchestrator');
    } finally {
      cleanup(dir);
    }
  });

  test('disassembled profile content includes name field', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const { profiles: disassembled } = disassembleV4Config(assembled);

      assert.equal(disassembled[0].content.name, 'balanced');
    } finally {
      cleanup(dir);
    }
  });

  test('throws when config has no _v4Source', () => {
    const plain = { version: 3, catalogs: {}, active_preset: 'x' };

    assert.throws(
      () => disassembleV4Config(plain),
      /_v4Source metadata/
    );
  });

  test('disassemble preserves filePath from _v4Source profileMap', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const assembled = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const { profiles: disassembled } = disassembleV4Config(assembled);

      assert.ok(disassembled[0].filePath, 'filePath is preserved');
      assert.ok(disassembled[0].filePath.endsWith('balanced.router.yaml'));
    } finally {
      cleanup(dir);
    }
  });
});

describe('buildV4WritePlan', () => {
  test('core-only change produces coreChanged=true and no profile writes', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const oldConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const newConfig = assembleV4Config(
        { ...MINIMAL_CORE_CONFIG, active_preset: 'balanced', activation_state: 'inactive' },
        profiles
      );

      const plan = buildV4WritePlan(oldConfig, newConfig);

      assert.equal(plan.coreChanged, true);
      assert.equal(plan.profileWrites.length, 0);
      assert.equal(plan.profileDeletes.length, 0);
      assert.equal(plan.writeOrder, 'profiles-first-core-last');
    } finally {
      cleanup(dir);
    }
  });

  test('profile change produces profile write and coreChanged=false when core unchanged', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const oldConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      const MODIFIED_BALANCED_YAML = `name: balanced
phases:
  orchestrator:
    - target: openai/gpt-4o
      phase: orchestrator
      role: primary
`;
      writeFile(dir, 'profiles/balanced.router.yaml', MODIFIED_BALANCED_YAML);
      const newProfiles = loadV4Profiles(dir, { includeGlobal: false });
      const newConfig = assembleV4Config(MINIMAL_CORE_CONFIG, newProfiles);

      const plan = buildV4WritePlan(oldConfig, newConfig);

      assert.equal(plan.coreChanged, false);
      assert.equal(plan.profileWrites.length, 1);
      assert.equal(plan.profileWrites[0].presetName, 'balanced');
      assert.equal(plan.profileDeletes.length, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('new profile in new config produces profile write', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      const profilesOld = loadV4Profiles(dir, { includeGlobal: false });
      const oldConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profilesOld);

      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);
      const profilesNew = loadV4Profiles(dir, { includeGlobal: false });
      const newConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profilesNew);

      const plan = buildV4WritePlan(oldConfig, newConfig);

      const safetyWrite = plan.profileWrites.find((w) => w.presetName === 'safety');
      assert.ok(safetyWrite, 'safety profile write present');
    } finally {
      cleanup(dir);
    }
  });

  test('removed profile in new config produces profile delete', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);
      writeFile(dir, 'profiles/safety.router.yaml', SAFETY_PROFILE_YAML);
      const profilesOld = loadV4Profiles(dir, { includeGlobal: false });
      const oldConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profilesOld);

      fs.unlinkSync(path.join(dir, 'profiles/safety.router.yaml'));
      const profilesNew = loadV4Profiles(dir, { includeGlobal: false });
      const newConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profilesNew);

      const plan = buildV4WritePlan(oldConfig, newConfig);

      const safetyDelete = plan.profileDeletes.find((d) => d.presetName === 'safety');
      assert.ok(safetyDelete, 'safety profile delete present');
    } finally {
      cleanup(dir);
    }
  });

  test('no changes when old and new configs are identical', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const config = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);

      const plan = buildV4WritePlan(config, config);

      assert.equal(plan.coreChanged, false);
      assert.equal(plan.profileWrites.length, 0);
      assert.equal(plan.profileDeletes.length, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('write plan coreContent has version 5', () => {
    const dir = makeTempDir();

    try {
      writeFile(dir, 'profiles/balanced.router.yaml', BALANCED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir, { includeGlobal: false });
      const oldConfig = assembleV4Config(MINIMAL_CORE_CONFIG, profiles);
      const newConfig = assembleV4Config(
        { ...MINIMAL_CORE_CONFIG, activation_state: 'inactive' },
        profiles
      );

      const plan = buildV4WritePlan(oldConfig, newConfig);

      assert.equal(plan.coreContent.version, 5);
      assert.equal(plan.coreContent.activation_state, 'inactive');
      assert.equal(plan.coreContent.active_sdd, 'agent-orchestrator');
    } finally {
      cleanup(dir);
    }
  });
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ── identity section validation (Task 1.5) ────────────────────────────────────

describe('validateProfileFile — identity section', () => {
  const BASE_PHASES = {
    orchestrator: [{ phase: 'orchestrator', role: 'primary', target: 'model/x' }],
  };

  test('profile with valid identity section passes validation', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: {
        context: 'Custom context',
        prompt: '',
        inherit_agents_md: true,
        persona: 'gentleman',
      },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/identity-test.router.yaml'));
  });

  test('profile with only inherit_agents_md in identity passes', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { inherit_agents_md: false },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/identity-test.router.yaml'));
  });

  test('profile with only context in identity passes', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { context: 'Hello' },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/identity-test.router.yaml'));
  });

  test('profile with empty identity object passes', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: {},
    };
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/identity-test.router.yaml'));
  });

  test('identity.inherit_agents_md must be boolean — throws for non-boolean', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { inherit_agents_md: 'yes' },
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*inherit_agents_md.*boolean/i
    );
  });

  test('identity.context must be string or null — throws for non-string', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { context: 42 },
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*context.*string/i
    );
  });

  test('identity.prompt must be string or null — throws for non-string', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { prompt: true },
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*prompt.*string/i
    );
  });

  test('unknown identity field throws', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { unknownField: 'value' },
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*unknown.*field|unknown.*identity/i
    );
  });

  test('identity must be an object — throws for array', () => {
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: ['context'],
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*object/i
    );
  });

  test('identity execution hints are rejected', () => {
    // 'instructions' is an execution hint — must not be in identity
    const profile = {
      name: 'identity-test',
      phases: BASE_PHASES,
      identity: { instructions: 'do this' },
    };
    assert.throws(
      () => validateProfileFile(profile, '/fake/identity-test.router.yaml'),
      /identity.*unknown.*field|unknown.*identity|execution-oriented/i
    );
  });
});

// ── identity.overrides forwarding through assembleV4Config ────────────────────
// Spec: identity.overrides in router.yaml (coreConfig) must appear in assembled config

describe('assembleV4Config — identity.overrides forwarding', () => {
  const MINIMAL_PROFILE = {
    filePath: '/fake/balanced.router.yaml',
    fileName: 'balanced.router.yaml',
    catalogName: 'default',
    content: {
      name: 'balanced',
      phases: {
        orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
      },
    },
  };

  test('identity.overrides from coreConfig is forwarded to assembled config', () => {
    const coreConfig = {
      version: 4,
      active_catalog: 'default',
      active_preset: 'balanced',
      identity: {
        overrides: {
          'gsr-balanced': { prompt: 'Router-level prompt for balanced' },
        },
      },
    };

    const assembled = assembleV4Config(coreConfig, [MINIMAL_PROFILE]);

    assert.ok(assembled.identity, 'assembled config must have identity field');
    assert.ok(assembled.identity.overrides, 'assembled config must have identity.overrides');
    assert.equal(
      assembled.identity.overrides['gsr-balanced'].prompt,
      'Router-level prompt for balanced',
      'override prompt must be forwarded from coreConfig'
    );
  });

  test('assembled config without identity in coreConfig has no identity field', () => {
    const coreConfig = {
      version: 4,
      active_catalog: 'default',
      active_preset: 'balanced',
      // No identity field
    };

    const assembled = assembleV4Config(coreConfig, [MINIMAL_PROFILE]);

    // identity field should be absent (not null, not {}) to maintain backward compat
    assert.ok(
      assembled.identity === undefined || !assembled.identity?.overrides,
      'assembled config must not add identity.overrides when coreConfig has none'
    );
  });
});
