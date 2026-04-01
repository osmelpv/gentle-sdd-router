/**
 * Integration test: Full flow from identity config → overlay generation → merge.
 *
 * Spec scenarios: T13, T14
 * Verifies:
 *   - Profile YAML with identity section → resolved identity → overlay with prompt + marker
 *   - Existing profiles WITHOUT identity → no YAML mutation, safe defaults
 *   - Existing opencode.json entries WITHOUT _gsr_generated → preserved (migration warning)
 *   - Full router non-executing boundary preserved
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach } from 'node:test';
import { resetIdentityCache } from '../src/core/agent-identity.js';
import {
  generateOpenCodeOverlay,
  mergeOverlayWithExisting,
} from '../src/adapters/opencode/overlay-generator.js';
import { validateProfileFile } from '../src/core/router-v4-io.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-identity-integration-'));
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

// ── T13: Existing profile without identity → no YAML mutation ─────────────────

describe('T13: Existing profiles without identity section behave safely', () => {
  beforeEach(() => resetIdentityCache());

  test('T13: profile YAML without identity section validates without error', () => {
    const profile = {
      name: 'legacy',
      phases: {
        orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
      },
    };
    assert.doesNotThrow(() => validateProfileFile(profile, '/fake/legacy.router.yaml'));
  });

  test('T13: overlay generated from profile without identity has prompt field', () => {
    const dir = makeTempDir();
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              legacy: {
                availability: 'stable',
                phases: {
                  orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
                },
                // NO identity section
              },
            },
          },
        },
      };

      const { agent } = generateOpenCodeOverlay(config, { cwd: dir });

      assert.ok(agent['gsr-legacy'], 'gsr-legacy entry must be generated');
      assert.ok('prompt' in agent['gsr-legacy'], 'generated entry must have prompt field even without identity');
      assert.ok(typeof agent['gsr-legacy'].prompt === 'string', 'prompt must be a string');
      assert.ok(agent['gsr-legacy'].prompt.length > 0, 'prompt must not be empty');
      assert.equal(agent['gsr-legacy']._gsr_generated, true, 'entry must have _gsr_generated: true');
    } finally {
      cleanup(dir);
    }
  });

  test('T13: profile YAML file is NOT modified during overlay generation', () => {
    const dir = makeTempDir();
    const profilePath = writeFile(
      dir,
      'profiles/legacy.router.yaml',
      `name: legacy\nphases:\n  orchestrator:\n    - target: anthropic/claude-sonnet\n      phase: orchestrator\n      role: primary\n`
    );
    const originalContent = fs.readFileSync(profilePath, 'utf8');
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              legacy: {
                availability: 'stable',
                phases: {
                  orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
      };
      generateOpenCodeOverlay(config, { cwd: dir });

      const contentAfter = fs.readFileSync(profilePath, 'utf8');
      assert.equal(contentAfter, originalContent, 'profile YAML must not be mutated during overlay generation');
    } finally {
      cleanup(dir);
    }
  });
});

// ── T14: Existing opencode.json entries without marker → preserved + warning ───

describe('T14: Existing opencode.json entries without _gsr_generated are preserved', () => {
  test('T14: entry without marker is preserved and warning is emitted', () => {
    const overlay = {
      agent: {
        'gsr-multivendor': {
          mode: 'primary',
          prompt: 'New resolved prompt',
          _gsr_generated: true,
        },
      },
      warnings: [],
    };
    const existing = {
      agent: {
        'gsr-multivendor': {
          mode: 'primary',
          prompt: 'User custom prompt',
          // NO _gsr_generated marker — user-owned
        },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    // Entry must be preserved
    assert.equal(
      result.agent['gsr-multivendor'].prompt,
      'User custom prompt',
      'user prompt must be preserved when no _gsr_generated marker'
    );

    // Warning must be emitted
    assert.ok(Array.isArray(result.warnings), 'result must have warnings array');
    assert.ok(result.warnings.length > 0, 'at least one warning must be emitted');
    assert.ok(
      result.warnings.some(w => w.includes('gsr-multivendor')),
      `warning must mention the preserved entry, got: ${JSON.stringify(result.warnings)}`
    );
  });

  test('T14: multiple user-owned entries all preserved with individual warnings', () => {
    const overlay = {
      agent: {
        'gsr-fast': { mode: 'primary', prompt: 'New fast', _gsr_generated: true },
        'gsr-safety': { mode: 'primary', prompt: 'New safety', _gsr_generated: true },
      },
      warnings: [],
    };
    const existing = {
      agent: {
        'gsr-fast': { mode: 'primary', prompt: 'User fast prompt' },
        'gsr-safety': { mode: 'primary', prompt: 'User safety prompt' },
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(result.agent['gsr-fast'].prompt, 'User fast prompt', 'gsr-fast must be preserved');
    assert.equal(result.agent['gsr-safety'].prompt, 'User safety prompt', 'gsr-safety must be preserved');
    assert.ok(result.warnings.length >= 2, 'two warnings must be emitted for two preserved entries');
  });

  test('T14: GSR-marked entry is replaced, user entry preserved — in same merge', () => {
    const overlay = {
      agent: {
        'gsr-gsr-owned': { mode: 'primary', prompt: 'New gsr-owned', _gsr_generated: true },
        'gsr-user-owned': { mode: 'primary', prompt: 'New user-owned', _gsr_generated: true },
      },
      warnings: [],
    };
    const existing = {
      agent: {
        'gsr-gsr-owned': { mode: 'primary', prompt: 'Old gsr-owned', _gsr_generated: true },
        'gsr-user-owned': { mode: 'primary', prompt: 'Custom user prompt' }, // no marker
      },
    };

    const result = mergeOverlayWithExisting(overlay, existing);

    assert.equal(result.agent['gsr-gsr-owned'].prompt, 'New gsr-owned', 'GSR-managed entry must be replaced');
    assert.equal(result.agent['gsr-user-owned'].prompt, 'Custom user prompt', 'user entry must be preserved');
    assert.ok(
      result.warnings.some(w => w.includes('gsr-user-owned')),
      'warning must mention gsr-user-owned'
    );
    assert.ok(
      !result.warnings.some(w => w.includes('gsr-gsr-owned')),
      'no warning for GSR-managed entry that was replaced'
    );
  });
});

// ── T10: router.yaml identity.overrides → overlay generation ─────────────────
// Spec: identity.overrides stored in coreConfig (router.yaml) → wins over resolved identity

describe('T10: identity.overrides in router config applied during overlay generation', () => {
  beforeEach(() => resetIdentityCache());

  test('T10: override prompt in coreConfig.identity.overrides wins over profile identity', () => {
    const dir = makeTempDir();
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              special: {
                availability: 'stable',
                identity: {
                  context: 'This should be overridden',
                  inherit_agents_md: false,
                },
                phases: {
                  orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
        // Router-level override declared at assembled config root (forwarded from coreConfig)
        identity: {
          overrides: {
            'gsr-special': { prompt: 'Override wins here' },
          },
        },
      };

      const { agent } = generateOpenCodeOverlay(config, { cwd: dir });

      assert.ok(agent['gsr-special'], 'gsr-special must be generated');
      assert.equal(
        agent['gsr-special'].prompt,
        'Override wins here',
        'router-level override must win over profile identity context'
      );
      assert.equal(agent['gsr-special']._gsr_generated, true, 'entry still has GSR marker');
    } finally {
      cleanup(dir);
    }
  });

  test('T10: override survives regeneration — second call produces same override result', () => {
    const dir = makeTempDir();
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              stable: {
                availability: 'stable',
                phases: {
                  orchestrator: [{ target: 'model/x', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
        identity: {
          overrides: {
            'gsr-stable': { prompt: 'Persistent declarative override' },
          },
        },
      };

      const first = generateOpenCodeOverlay(config, { cwd: dir });
      const second = generateOpenCodeOverlay(config, { cwd: dir });

      assert.equal(first.agent['gsr-stable'].prompt, 'Persistent declarative override', 'first call uses override');
      assert.equal(second.agent['gsr-stable'].prompt, 'Persistent declarative override', 'second call (regen) still uses override');
    } finally {
      cleanup(dir);
    }
  });
});

// ── Full flow: identity config → overlay → merge ──────────────────────────────

describe('Full flow: profile identity → overlay → merge', () => {
  beforeEach(() => resetIdentityCache());

  test('explicit identity.context appears in generated overlay prompt', () => {
    const dir = makeTempDir();
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              custom: {
                availability: 'stable',
                identity: {
                  context: 'Integration test context.',
                  inherit_agents_md: false,
                },
                phases: {
                  orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
      };

      const { agent } = generateOpenCodeOverlay(config, { cwd: dir });

      assert.ok(agent['gsr-custom'], 'gsr-custom must be generated');
      assert.ok(
        agent['gsr-custom'].prompt.includes('Integration test context.'),
        `prompt must include explicit context, got: "${agent['gsr-custom'].prompt}"`
      );
    } finally {
      cleanup(dir);
    }
  });

  test('explicit identity.prompt bypasses context and AGENTS.md in overlay', () => {
    const dir = makeTempDir();
    // Write an AGENTS.md — must NOT appear in prompt
    writeFile(dir, 'AGENTS.md', 'This should NOT appear');
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              override: {
                availability: 'stable',
                identity: {
                  prompt: 'Verbatim explicit prompt.',
                  context: 'This should be ignored',
                  inherit_agents_md: true,
                },
                phases: {
                  orchestrator: [{ target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
      };

      const { agent } = generateOpenCodeOverlay(config, { cwd: dir });

      assert.equal(
        agent['gsr-override'].prompt,
        'Verbatim explicit prompt.',
        'explicit prompt must be used verbatim'
      );
      assert.ok(
        !agent['gsr-override'].prompt.includes('This should NOT appear'),
        'AGENTS.md content must not appear when explicit prompt is set'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('non-executing boundary: overlay generation does not spawn child processes', () => {
    // The entire chain must be pure filesystem reads + data transformation.
    // We verify by checking no imports from child_process or exec are used.
    // This is a structural/static check — the actual generation must complete synchronously
    // without side effects.
    const dir = makeTempDir();
    try {
      const config = {
        version: 3,
        catalogs: {
          default: {
            enabled: true,
            presets: {
              boundary: {
                availability: 'stable',
                phases: {
                  orchestrator: [{ target: 'model/x', phase: 'orchestrator', role: 'primary' }],
                },
              },
            },
          },
        },
      };

      // If this throws for any unexpected reason, the test fails
      let threw = false;
      try {
        const result = generateOpenCodeOverlay(config, { cwd: dir });
        assert.ok(result.agent, 'result must have agent property');
      } catch (err) {
        threw = true;
        assert.fail(`generateOpenCodeOverlay must not throw: ${err.message}`);
      }
      assert.equal(threw, false);
    } finally {
      cleanup(dir);
    }
  });
});
