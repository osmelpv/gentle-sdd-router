/**
 * Tests for persona-and-pricing feature:
 * - resolvePersona in controller.js
 * - pricing display in renderStatus (via CLI output)
 * - pricing fields accepted in validateProfileFile
 * - pricing fields preserved through load/save round-trip (assembleV4Config)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  detectGentleAi,
  resolvePersona,
  resetControllerCache,
} from '../src/core/controller.js';
import { validateProfileFile, assembleV4Config, loadV4Profiles } from '../src/core/router-v4-io.js';
import { runCli } from '../src/cli.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-persona-pricing-'));
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

// ── resolvePersona ────────────────────────────────────────────────────────────

describe('resolvePersona', () => {
  test('returns config.persona override when explicitly set', () => {
    resetControllerCache();
    assert.equal(resolvePersona({ persona: 'gentleman' }), 'gentleman');
    assert.equal(resolvePersona({ persona: 'neutral' }), 'neutral');
    assert.equal(resolvePersona({ persona: 'custom' }), 'custom');
  });

  test('config.persona override takes priority over gentle-ai detection', () => {
    resetControllerCache();
    // Even if gentle-ai is in PATH, explicit override wins
    assert.equal(resolvePersona({ persona: 'neutral' }), 'neutral');
  });

  test('treats "auto" persona value as no override — falls back to detection', () => {
    resetControllerCache();
    const detected = detectGentleAi();
    resetControllerCache();
    const result = resolvePersona({ persona: 'auto' });
    if (detected) {
      assert.equal(result, 'gentleman');
    } else {
      assert.equal(result, 'neutral');
    }
  });

  test('returns "gentleman" when no config but gentle-ai detected', () => {
    resetControllerCache();
    const detected = detectGentleAi();
    resetControllerCache();
    if (detected) {
      assert.equal(resolvePersona(null), 'gentleman');
    } else {
      // Not detected in this env — test the fallback path instead
      assert.equal(resolvePersona(null), 'neutral');
    }
  });

  test('returns "neutral" when no config and gentle-ai not installed', () => {
    resetControllerCache();
    const detected = detectGentleAi();
    resetControllerCache();
    if (!detected) {
      assert.equal(resolvePersona(null), 'neutral');
      assert.equal(resolvePersona(), 'neutral');
    } else {
      // Skip this assertion — gentle-ai IS installed in this env
      assert.equal(resolvePersona({ persona: 'neutral' }), 'neutral');
    }
  });

  test('resolvePersona returns a string', () => {
    resetControllerCache();
    const result = resolvePersona(null);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  test('resolvePersona with empty config object falls back to detection', () => {
    resetControllerCache();
    const detected = detectGentleAi();
    resetControllerCache();
    const result = resolvePersona({});
    if (detected) {
      assert.equal(result, 'gentleman');
    } else {
      assert.equal(result, 'neutral');
    }
  });
});

// ── Pricing in validateProfileFile ────────────────────────────────────────────

describe('validateProfileFile: pricing fields in lanes', () => {
  test('profile with inputPerMillion and outputPerMillion on a lane passes validation', () => {
    const profile = {
      name: 'priced',
      phases: {
        orchestrator: [
          {
            target: 'anthropic/claude-opus',
            kind: 'lane',
            phase: 'orchestrator',
            role: 'primary',
            inputPerMillion: 15,
            outputPerMillion: 75,
          },
        ],
      },
    };

    const result = validateProfileFile(profile, '/fake/priced.router.yaml');
    assert.equal(result, profile);
  });

  test('profile with pricing on some lanes and not others passes validation', () => {
    const profile = {
      name: 'partial-priced',
      phases: {
        orchestrator: [
          {
            target: 'anthropic/claude-opus',
            kind: 'lane',
            phase: 'orchestrator',
            role: 'primary',
            inputPerMillion: 15,
            outputPerMillion: 75,
          },
        ],
        apply: [
          {
            target: 'anthropic/claude-sonnet',
            kind: 'lane',
            phase: 'apply',
            role: 'primary',
            // No pricing fields — should still pass
          },
        ],
      },
    };

    const result = validateProfileFile(profile, '/fake/partial-priced.router.yaml');
    assert.equal(result, profile);
  });

  test('profile without any pricing fields passes validation', () => {
    const profile = {
      name: 'no-pricing',
      phases: {
        orchestrator: [
          { target: 'anthropic/claude-sonnet', phase: 'orchestrator', role: 'primary' },
        ],
      },
    };

    const result = validateProfileFile(profile, '/fake/no-pricing.router.yaml');
    assert.equal(result, profile);
  });
});

// ── Pricing preserved through assembleV4Config round-trip ─────────────────────

describe('pricing fields preserved through load/assemble round-trip', () => {
  const PRICED_PROFILE_YAML = `name: priced
availability: stable
phases:
  orchestrator:
    - target: anthropic/claude-opus
      kind: lane
      phase: orchestrator
      role: primary
      inputPerMillion: 15
      outputPerMillion: 75
  apply:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: apply
      role: primary
      inputPerMillion: 3
      outputPerMillion: 15
`;

  test('inputPerMillion and outputPerMillion survive load and assemble', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/priced.router.yaml', PRICED_PROFILE_YAML);

      const profiles = loadV4Profiles(dir);
      const assembled = assembleV4Config(
        { version: 4, active_preset: 'priced', activation_state: 'active' },
        profiles
      );

      const orchestratorLanes = assembled.catalogs.default.presets.priced.phases.orchestrator;
      assert.ok(Array.isArray(orchestratorLanes), 'orchestrator lanes is an array');
      assert.equal(orchestratorLanes[0].inputPerMillion, 15);
      assert.equal(orchestratorLanes[0].outputPerMillion, 75);

      const applyLanes = assembled.catalogs.default.presets.priced.phases.apply;
      assert.equal(applyLanes[0].inputPerMillion, 3);
      assert.equal(applyLanes[0].outputPerMillion, 15);
    } finally {
      cleanup(dir);
    }
  });

  test('lanes without pricing fields remain undefined after assembly', () => {
    const UNPRICED_YAML = `name: unpriced
phases:
  orchestrator:
    - target: openai/gpt
      kind: lane
      phase: orchestrator
      role: primary
`;
    const dir = makeTempDir();
    try {
      writeFile(dir, 'profiles/unpriced.router.yaml', UNPRICED_YAML);

      const profiles = loadV4Profiles(dir);
      const assembled = assembleV4Config(
        { version: 4, active_preset: 'unpriced', activation_state: 'active' },
        profiles
      );

      const lanes = assembled.catalogs.default.presets.unpriced.phases.orchestrator;
      assert.equal(lanes[0].inputPerMillion, undefined);
      assert.equal(lanes[0].outputPerMillion, undefined);
    } finally {
      cleanup(dir);
    }
  });
});

// ── Pricing display in CLI status output ──────────────────────────────────────

describe('pricing display in gsr status output', () => {
  /**
   * Build a minimal v3 config with pricing on orchestrator phase.
   */
  function makeV3ConfigWithPricing() {
    return {
      version: 3,
      active_catalog: 'default',
      active_preset: 'test',
      activation_state: 'active',
      catalogs: {
        default: {
          availability: 'stable',
          presets: {
            test: {
              availability: 'stable',
              phases: {
                orchestrator: [
                  {
                    target: 'anthropic/claude-opus',
                    kind: 'lane',
                    phase: 'orchestrator',
                    role: 'primary',
                    inputPerMillion: 15,
                    outputPerMillion: 75,
                  },
                ],
                apply: [
                  {
                    target: 'anthropic/claude-sonnet',
                    kind: 'lane',
                    phase: 'apply',
                    role: 'primary',
                    // No pricing
                  },
                ],
              },
            },
          },
        },
      },
    };
  }

  test('resolvePersona exported from router-config barrel', async () => {
    const { resolvePersona: fromBarrel } = await import('../src/router-config.js');
    assert.equal(typeof fromBarrel, 'function');
  });

  test('gsr list with v4 actual config runs without error and shows profiles', async () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function capture(chunk) {
      chunks.push(String(chunk));
      return true;
    };

    try {
      await runCli(['list']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    assert.match(output, /Profiles:/);
    assert.match(output, /multivendor/);
  });

  test('gsr status --verbose with v4 actual config shows resolved routes without crashing', async () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function capture(chunk) {
      chunks.push(String(chunk));
      return true;
    };

    try {
      await runCli(['status', '--verbose']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    assert.match(output, /Resolved routes:/);
    assert.match(output, /orchestrator:/);
  });

  test('gsr status --verbose shows pricing for multivendor preset (orchestrator has $15\\.00/$75)', async () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function capture(chunk) {
      chunks.push(String(chunk));
      return true;
    };

    try {
      await runCli(['status', '--verbose']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    // orchestrator: anthropic/claude-opus should have pricing ($15/$75)
    assert.match(output, /orchestrator:.*\(\$15\/\$75\)/);
  });

  test('gsr status --verbose shows pricing for archive phase (google/gemini-flash $0.075/$0.3)', async () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function capture(chunk) {
      chunks.push(String(chunk));
      return true;
    };

    try {
      await runCli(['status', '--verbose']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    // archive phase should show small pricing
    assert.match(output, /archive:.*\(\$0\.075\/\$0\.3\)/);
  });
});

// ── persona in overlay-generator description ──────────────────────────────────

describe('persona in overlay-generator description', () => {
  test('overlay description includes persona bracket hint', async () => {
    const { generateOpenCodeOverlay } = await import('../src/adapters/opencode/overlay-generator.js');

    const config = {
      version: 3,
      active_catalog: 'default',
      active_preset: 'test',
      // persona: neutral (will be used by resolvePersona if no gentle-ai)
      persona: 'neutral',
      catalogs: {
        default: {
          presets: {
            test: {
              availability: 'stable',
              phases: {
                orchestrator: [{ target: 'openai/gpt', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
              },
            },
          },
        },
      },
    };

    const { agent } = generateOpenCodeOverlay(config);
    // The description must include a persona hint
    assert.match(agent['gsr-test'].description, /\[neutral\]$/);
  });

  test('overlay description uses "gentleman" persona from config override', async () => {
    const { generateOpenCodeOverlay } = await import('../src/adapters/opencode/overlay-generator.js');

    const config = {
      version: 3,
      persona: 'gentleman',
      catalogs: {
        default: {
          presets: {
            mypreset: {
              availability: 'stable',
              phases: {
                orchestrator: [{ target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' }],
              },
            },
          },
        },
      },
    };

    const { agent } = generateOpenCodeOverlay(config);
    assert.match(agent['gsr-mypreset'].description, /\[gentleman\]$/);
  });
});
