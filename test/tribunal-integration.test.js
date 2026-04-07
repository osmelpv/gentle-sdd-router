/**
 * Integration and smoke tests for tribunal components working together.
 *
 * Spec reference: SDD-4 tribunal-logic — Phase 6
 *
 * T6.1 — Integration: generateOpenCodeOverlay with tribunal-enabled v3 config
 * T6.2 — Smoke: TribunalChannel write + read (full lifecycle)
 * T6.3 — Smoke: compression flow (write → compress → cleanup)
 * T6.4 — Backward compat: non-tribunal profile generates only orchestrator
 * T6.5 — Schema round-trip: valid config passes, invalid config fails with clear message
 * T6.6 — Context templates: buildJudgeContext includes fallback section
 * T6.7 — Context templates: buildMinisterContext includes heartbeat instructions
 * T6.8 — Context templates: buildRadarContext includes polling protocol
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TribunalChannel } from '../src/core/tribunal-channel.js';
import { generateOpenCodeOverlay } from '../src/adapters/opencode/overlay-generator.js';
import { validateRouterSchemaV3 } from '../src/core/router-schema-v3.js';
import { buildJudgeContext, buildMinisterContext, buildRadarContext } from '../src/core/tribunal-context.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'gsr-integration-test-'));
}

function cleanupDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a minimal v3 config with a single profile preset that has tribunal enabled.
 * Matches the exact shape expected by generateOpenCodeOverlay (v3 mode, no profilesMap).
 */
function makeTribunalConfig(profileName = 'my-profile') {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: profileName,
    catalogs: {
      default: {
        availability: 'stable',
        presets: {
          [profileName]: {
            availability: 'stable',
            phases: {
              orchestrator: [
                { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
              ],
              explore: {
                lanes: [
                  { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
                ],
                tribunal: {
                  enabled: true,
                  max_rounds: 3,
                  escalate_after: 3,
                },
                judge: {
                  model: 'anthropic/claude-opus',
                },
                ministers: [
                  { model: 'openai/gpt-5' },
                  { model: 'google/gemini-pro' },
                ],
                radar: {
                  model: 'google/gemini-1.5-pro',
                  enabled: true,
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build a plain v3 config with NO tribunal fields (backward compat fixture).
 */
function makePlainConfig(profileName = 'balanced') {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: profileName,
    catalogs: {
      default: {
        availability: 'stable',
        presets: {
          [profileName]: {
            availability: 'stable',
            phases: {
              orchestrator: [
                { target: 'anthropic/claude-sonnet', kind: 'lane', phase: 'orchestrator', role: 'primary' },
              ],
              explore: [
                { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
              ],
            },
          },
        },
      },
    },
  };
}

/**
 * Build a valid v3 config that validateRouterSchemaV3 accepts (tribunal phase variant).
 */
function makeValidSchemaConfig(overrides = {}) {
  return {
    version: 3,
    active_catalog: 'default',
    active_preset: 'latest',
    catalogs: {
      default: {
        presets: {
          latest: {
            phases: {
              explore: {
                lanes: [
                  { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
                ],
                tribunal: {
                  enabled: true,
                  max_rounds: 4,
                  escalate_after: 4,
                },
                judge: {
                  model: 'anthropic/claude-opus',
                },
                ministers: [
                  { model: 'openai/gpt-5' },
                  { model: 'google/gemini-pro' },
                ],
                ...overrides,
              },
            },
          },
        },
      },
    },
  };
}

// ── T6.1: Integration — generateOpenCodeOverlay with tribunal profiles ────────

describe('T6.1 — Integration: generateOpenCodeOverlay with tribunal-enabled profile', () => {
  it('generates orchestrator agent for the profile', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(
      agent['gsr-my-profile'],
      'orchestrator agent gsr-my-profile must be present'
    );
  });

  it('generates judge sub-agent with hidden:true and _gsr_generated:true', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    const judge = agent['gsr-my-profile-judge'];
    assert.ok(judge, 'gsr-my-profile-judge must be present');
    assert.equal(judge.hidden, true, 'judge must have hidden:true');
    assert.equal(judge._gsr_generated, true, 'judge must have _gsr_generated:true');
  });

  it('generates minister sub-agents with hidden:true and _gsr_generated:true', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    const m1 = agent['gsr-my-profile-minister-1'];
    const m2 = agent['gsr-my-profile-minister-2'];

    assert.ok(m1, 'minister-1 must be present');
    assert.ok(m2, 'minister-2 must be present');
    assert.equal(m1.hidden, true, 'minister-1 must have hidden:true');
    assert.equal(m2.hidden, true, 'minister-2 must have hidden:true');
    assert.equal(m1._gsr_generated, true);
    assert.equal(m2._gsr_generated, true);
  });

  it('generates radar sub-agent when radar.enabled is true', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    const radar = agent['gsr-my-profile-radar'];
    assert.ok(radar, 'radar must be present when enabled:true');
    assert.equal(radar.hidden, true, 'radar must have hidden:true');
    assert.equal(radar._gsr_generated, true);
  });

  it('judge model matches the tribunal config', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(
      agent['gsr-my-profile-judge'].model,
      'anthropic/claude-opus',
      'judge model must match config'
    );
  });

  it('minister models match their order in config', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    assert.equal(agent['gsr-my-profile-minister-1'].model, 'openai/gpt-5');
    assert.equal(agent['gsr-my-profile-minister-2'].model, 'google/gemini-pro');
  });

  it('tribunal sub-agents have correct per-role tools', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    // Judge: full access (needs to delegate, read/write channel, use bash)
    const judgeTools = agent['gsr-my-profile-judge']?.tools;
    assert.ok(judgeTools, 'judge must have tools');
    assert.equal(judgeTools.read, true, 'judge tools.read must be true');
    assert.equal(judgeTools.write, true, 'judge tools.write must be true');
    assert.equal(judgeTools.edit, true, 'judge tools.edit must be true');
    assert.equal(judgeTools.bash, true, 'judge tools.bash must be true');

    // Ministers: read + write + bash (for channel I/O and polling sleep)
    for (const role of ['minister-1', 'minister-2']) {
      const t = agent[`gsr-my-profile-${role}`]?.tools;
      assert.ok(t, `${role} must have tools`);
      assert.equal(t.read, true, `${role} tools.read must be true`);
      assert.equal(t.write, true, `${role} tools.write must be true`);
      assert.equal(t.edit, false, `${role} tools.edit must be false`);
      assert.equal(t.bash, true, `${role} tools.bash must be true`);
    }

    // Radar: read + write + bash (for investigation and channel I/O)
    const radarTools = agent['gsr-my-profile-radar']?.tools;
    assert.ok(radarTools, 'radar must have tools');
    assert.equal(radarTools.read, true, 'radar tools.read must be true');
    assert.equal(radarTools.write, true, 'radar tools.write must be true');
    assert.equal(radarTools.edit, false, 'radar tools.edit must be false');
    assert.equal(radarTools.bash, true, 'radar tools.bash must be true');
  });

  it('orchestrator is unchanged — has mode:primary and _gsr_generated:true', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    const orch = agent['gsr-my-profile'];
    assert.equal(orch.mode, 'primary');
    assert.equal(orch._gsr_generated, true);
    // Orchestrator is NOT hidden
    assert.ok(!orch.hidden, 'orchestrator must not be hidden');
  });

  it('total agents = 1 orchestrator + 1 judge + 2 ministers + 1 radar = 5', () => {
    const config = makeTribunalConfig('my-profile');
    const { agent } = generateOpenCodeOverlay(config);

    const profileKeys = Object.keys(agent).filter(k => k.startsWith('gsr-my-profile'));
    assert.equal(profileKeys.length, 5, 'expected 5 total agents for tribunal profile');
  });
});

// ── T6.2: Smoke — TribunalChannel write + read ───────────────────────────────

describe('T6.2 — Smoke: TribunalChannel write + read lifecycle', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanupDir(tmp); });

  it('initialize creates metadata.json; write 3 messages; readAll returns all 3', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'explore', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({
      judge: 'anthropic/claude-opus',
      ministers: ['openai/gpt-5', 'google/gemini-pro'],
      radar: null,
    });

    // Write 2 minister messages + 1 judge message
    await ch.write('minister-1', 'minister', 'response', { text: 'Minister 1 take' }, 1);
    await ch.write('minister-2', 'minister', 'response', { text: 'Minister 2 take' }, 1);
    await ch.write('judge', 'judge', 'question', { text: 'Judge question' }, 1);

    const all = await ch.readAll();
    assert.equal(all.length, 3, 'readAll() must return all 3 messages');
  });

  it('readByRole("minister") returns exactly 2 minister messages', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'explore', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({
      judge: 'model-a',
      ministers: ['model-b', 'model-c'],
      radar: null,
    });

    await ch.write('minister-1', 'minister', 'response', { text: 'R1' }, 1);
    await ch.write('minister-2', 'minister', 'response', { text: 'R2' }, 1);
    await ch.write('judge', 'judge', 'synthesis', { text: 'Synthesis' }, 1);

    const ministers = await ch.readByRole('minister');
    assert.equal(ministers.length, 2, 'readByRole("minister") must return 2');
    assert.ok(
      ministers.every(m => m.role === 'minister'),
      'all returned messages must have role=minister'
    );
  });

  it('readAll(1) filters messages to round 1 only', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'spec', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    await ch.write('minister-1', 'minister', 'response', { text: 'Round 1 msg' }, 1);
    await ch.write('minister-2', 'minister', 'response', { text: 'Round 1 msg 2' }, 1);
    await ch.write('minister-1', 'minister', 'response', { text: 'Round 2 msg' }, 2);

    const round1 = await ch.readAll(1);
    assert.equal(round1.length, 2, 'readAll(1) must return 2 messages from round 1');
    assert.ok(
      round1.every(m => m.round === 1),
      'all messages from readAll(1) must have round=1'
    );

    const round2 = await ch.readAll(2);
    assert.equal(round2.length, 1, 'readAll(2) must return 1 message from round 2');
    assert.equal(round2[0].round, 2);
  });

  it('metadata rounds_run is persisted in metadata.json', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'design', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    const meta = await ch.getMetadata();
    assert.ok(meta, 'metadata must be retrievable after initialize');
    assert.equal(meta.rounds_run, 0, 'rounds_run must start at 0');
    assert.equal(meta.status, 'open', 'status must start as open');
  });
});

// ── T6.3: Smoke — compression flow ───────────────────────────────────────────

describe('T6.3 — Smoke: TribunalChannel compression flow', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanupDir(tmp); });

  it('compress() creates compression.json with lessons, bad_ideas, context_for_next_phase', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'apply', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });
    await ch.write('minister-1', 'minister', 'response', { text: 'Insight' }, 1);
    await ch.writeDecision('Use hexagonal architecture with ports and adapters');

    await ch.compress(
      ['Lesson 1: TDD pays off', 'Lesson 2: Keep boundaries small'],
      ['Bad idea: monolith coupling'],
      'Next phase should focus on I/O contracts'
    );

    const compressionPath = join(tmp, '.tribunal', 'tribunal-logic', 'apply', 'compression.json');
    assert.ok(existsSync(compressionPath), 'compression.json must exist after compress()');

    const comp = JSON.parse(readFileSync(compressionPath, 'utf8'));
    assert.deepEqual(comp.lessons_learned, ['Lesson 1: TDD pays off', 'Lesson 2: Keep boundaries small']);
    assert.deepEqual(comp.bad_ideas, ['Bad idea: monolith coupling']);
    assert.equal(comp.context_for_next_phase, 'Next phase should focus on I/O contracts');
  });

  it('cleanup() removes round files but keeps metadata, final-decision, and compression', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'apply', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });
    await ch.write('minister-1', 'minister', 'response', { text: 'R1' }, 1);
    await ch.write('judge', 'judge', 'question', { text: 'Q1' }, 1);
    await ch.writeDecision('final decision text');
    await ch.compress(['lesson'], [], 'context');

    const baseDir = join(tmp, '.tribunal', 'tribunal-logic', 'apply');
    const beforeCleanup = readdirSync(baseDir);
    assert.ok(
      beforeCleanup.some(f => f.startsWith('round-')),
      'round files must exist before cleanup'
    );

    await ch.cleanup();

    const afterCleanup = readdirSync(baseDir);
    assert.ok(
      !afterCleanup.some(f => f.startsWith('round-')),
      'round files must be removed after cleanup'
    );

    // Required files must survive cleanup
    assert.ok(existsSync(join(baseDir, 'metadata.json')), 'metadata.json must survive cleanup');
    assert.ok(existsSync(join(baseDir, 'final-decision.json')), 'final-decision.json must survive cleanup');
    assert.ok(existsSync(join(baseDir, 'compression.json')), 'compression.json must survive cleanup');
  });

  it('metadata status transitions: open → decided → compressed', async () => {
    const ch = new TribunalChannel('tribunal-logic', 'apply', {
      useEngram: false,
      routerDir: tmp,
    });

    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    let meta = await ch.getMetadata();
    assert.equal(meta.status, 'open', 'initial status must be open');

    await ch.writeDecision('The decision');
    meta = await ch.getMetadata();
    assert.equal(meta.status, 'decided', 'status after writeDecision must be decided');

    await ch.compress(['lesson'], [], 'context');
    meta = await ch.getMetadata();
    assert.equal(meta.status, 'compressed', 'status after compress must be compressed');
  });
});

// ── T6.4: Backward compat — non-tribunal profile ─────────────────────────────

describe('T6.4 — Backward compat: non-tribunal profile generates only orchestrator', () => {
  it('plain preset generates exactly 1 agent (orchestrator only)', () => {
    const config = makePlainConfig('balanced');
    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-balanced'], 'orchestrator gsr-balanced must exist');

    // No tribunal sub-agents
    const subAgentKeys = Object.keys(agent).filter(k =>
      k.startsWith('gsr-balanced-judge') ||
      k.startsWith('gsr-balanced-minister') ||
      k.startsWith('gsr-balanced-radar')
    );
    assert.equal(subAgentKeys.length, 0, 'no tribunal sub-agents must be generated for plain preset');
    assert.equal(
      Object.keys(agent).length,
      1,
      'exactly 1 agent must be generated for plain preset'
    );
  });

  it('plain orchestrator has _gsr_generated:true and mode:primary', () => {
    const config = makePlainConfig('balanced');
    const { agent } = generateOpenCodeOverlay(config);

    const orch = agent['gsr-balanced'];
    assert.equal(orch._gsr_generated, true, '_gsr_generated must be true');
    assert.equal(orch.mode, 'primary', 'mode must be primary');
  });

  it('output for plain preset matches pre-tribunal behavior (no hidden flag)', () => {
    const config = makePlainConfig('balanced');
    const { agent } = generateOpenCodeOverlay(config);

    const orch = agent['gsr-balanced'];
    // The orchestrator should never be auto-hidden unless preset.hidden is set
    assert.ok(!orch.hidden, 'orchestrator must not have hidden:true for a plain preset');
  });

  it('tribunal-disabled preset (tribunal.enabled=false) generates only orchestrator', () => {
    const config = {
      version: 3,
      active_catalog: 'default',
      active_preset: 'my-profile',
      catalogs: {
        default: {
          availability: 'stable',
          presets: {
            'my-profile': {
              availability: 'stable',
              phases: {
                orchestrator: [
                  { target: 'anthropic/claude-opus', kind: 'lane', phase: 'orchestrator', role: 'primary' },
                ],
                explore: {
                  lanes: [{ phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' }],
                  tribunal: { enabled: false, max_rounds: 4 },
                  judge: { model: 'anthropic/claude-opus' },
                  ministers: [{ model: 'openai/gpt-5' }, { model: 'google/gemini-pro' }],
                },
              },
            },
          },
        },
      },
    };

    const { agent } = generateOpenCodeOverlay(config);

    assert.ok(agent['gsr-my-profile'], 'orchestrator must still be generated');
    const subKeys = Object.keys(agent).filter(k => k !== 'gsr-my-profile');
    assert.equal(subKeys.length, 0, 'disabled tribunal must not generate any sub-agents');
  });
});

// ── T6.5: Schema round-trip ───────────────────────────────────────────────────

describe('T6.5 — Schema round-trip: validate tribunal profile YAML content', () => {
  it('valid tribunal config with 2 ministers and judge passes validation', () => {
    const config = makeValidSchemaConfig();
    assert.doesNotThrow(
      () => validateRouterSchemaV3(config),
      'valid tribunal config must pass schema validation'
    );
  });

  it('valid tribunal config with 3 ministers also passes validation', () => {
    const config = makeValidSchemaConfig({
      ministers: [
        { model: 'openai/gpt-5' },
        { model: 'google/gemini-pro' },
        { model: 'anthropic/claude-sonnet' },
      ],
    });
    assert.doesNotThrow(
      () => validateRouterSchemaV3(config),
      'tribunal config with 3 ministers must pass schema validation'
    );
  });

  it('invalid config with only 1 minister fails with clear error message', () => {
    const config = makeValidSchemaConfig({
      ministers: [{ model: 'openai/gpt-5' }],
    });

    assert.throws(
      () => validateRouterSchemaV3(config),
      /requires at least 2 ministers/i,
      'validation must throw with a clear message about requiring >= 2 ministers'
    );
  });

  it('invalid config with missing judge.model fails validation', () => {
    const config = makeValidSchemaConfig({ judge: undefined });

    assert.throws(
      () => validateRouterSchemaV3(config),
      /requires judge\.model/i,
      'validation must throw with a clear message about missing judge.model'
    );
  });

  it('invalid config with max_rounds=0 fails validation', () => {
    const config = makeValidSchemaConfig({
      tribunal: { enabled: true, max_rounds: 0, escalate_after: 0 },
    });

    assert.throws(
      () => validateRouterSchemaV3(config),
      /max_rounds must be a positive integer/i,
      'validation must throw when max_rounds is 0'
    );
  });

  it('invalid config with escalate_after > max_rounds fails validation', () => {
    const config = makeValidSchemaConfig({
      tribunal: { enabled: true, max_rounds: 3, escalate_after: 5 },
    });

    assert.throws(
      () => validateRouterSchemaV3(config),
      /escalate_after must be <= tribunal\.max_rounds/i,
      'validation must throw when escalate_after exceeds max_rounds'
    );
  });

  it('profile with no tribunal fields passes validation (backward compat)', () => {
    const config = {
      version: 3,
      active_catalog: 'default',
      active_preset: 'plain',
      catalogs: {
        default: {
          presets: {
            plain: {
              phases: {
                explore: [
                  { phase: 'explore', role: 'primary', target: 'anthropic/claude-sonnet' },
                ],
              },
            },
          },
        },
      },
    };

    assert.doesNotThrow(
      () => validateRouterSchemaV3(config),
      'profile without tribunal fields must pass validation unchanged'
    );
  });
});

// ── T6.6: Context templates — buildJudgeContext includes fallback section ─────

describe('T6.6 — buildJudgeContext includes Fallback Protocol section', () => {
  const BASE_PARAMS = {
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Implement the heartbeat system',
    tribunalId: 'sdd/tribunal-logic/phases/apply/999',
    participants: {
      judge: 'anthropic/claude-opus',
      ministers: [
        { model: 'openai/gpt-5', name: 'minister-1' },
        { model: 'google/gemini-pro', name: 'minister-2' },
      ],
      radar: { model: 'google/gemini-1.5-pro' },
    },
    maxRounds: 4,
    routerDir: '/tmp/router',
    profileName: 'test',
  };

  it('includes "Fallback Protocol" header', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('Fallback Protocol'), 'Must contain "Fallback Protocol" section');
  });

  it('includes fallback models when provided', () => {
    const params = {
      ...BASE_PARAMS,
      fallbacks: {
        minister_fallbacks: ['openai/gpt-4o', 'google/gemini-1.5-flash'],
        radar_fallbacks: ['google/gemini-1.5-flash'],
        judge_fallbacks: ['anthropic/claude-sonnet-4-6'],
      },
    };
    const result = buildJudgeContext(params);
    assert.ok(result.includes('openai/gpt-4o'), 'Must include minister fallback model');
    assert.ok(result.includes('google/gemini-1.5-flash'), 'Must include radar fallback model');
    assert.ok(result.includes('anthropic/claude-sonnet-4-6'), 'Must include judge fallback model');
  });

  it('shows "none" when no fallbacks provided', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('none'), 'Must show "none" when fallbacks are not provided');
  });

  it('includes instructions to replace dead ministers', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(
      result.includes('replace') || result.includes('replacement_model') || result.includes('dead'),
      'Must include instructions for replacing dead ministers'
    );
  });

  it('includes "metadata.json" for recovery context', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('metadata.json'), 'Must reference metadata.json for recovery');
  });
});

// ── T6.7: Context templates — buildMinisterContext includes heartbeat bash ────

describe('T6.7 — buildMinisterContext includes heartbeat bash command', () => {
  const BASE_PARAMS = {
    ministerName: 'gsr-test-minister-1',
    ministerModel: 'openai/gpt-5',
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Analyze the implementation approach',
    tribunalId: 'sdd/tribunal-logic/phases/apply/999',
    channelDir: '/tmp/router/.tribunal/tribunal-logic/apply',
    round: 1,
  };

  it('includes "HEARTBEAT" label marked as CRITICAL', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('HEARTBEAT'), 'Must contain HEARTBEAT section');
    assert.ok(result.includes('CRITICAL'), 'Must mark heartbeat as CRITICAL');
  });

  it('includes 30-second dead threshold', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('30'), 'Must mention 30 second timeout threshold');
  });

  it('includes bash command for writing heartbeats', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(
      result.includes('date -u') || result.includes('bash') || result.includes('echo'),
      'Must include bash heartbeat command'
    );
  });

  it('includes "replace" or "DEAD" to indicate consequences', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(
      result.includes('DEAD') || result.includes('replace') || result.includes('dead'),
      'Must explain the consequence of missing heartbeats'
    );
  });

  it('includes polling loop with sleep instruction', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('sleep') || result.includes('Poll Loop') || result.includes('polling'),
      'Must include polling loop instructions'
    );
  });

  it('includes "terminate" handling', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('terminate'), 'Must include terminate handling');
  });
});

// ── T6.8: Context templates — buildRadarContext includes polling protocol ─────

describe('T6.8 — buildRadarContext includes polling protocol and heartbeat', () => {
  const BASE_PARAMS = {
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Map risks in heartbeat implementation',
    tribunalId: 'sdd/tribunal-logic/phases/apply/999',
    channelDir: '/tmp/router/.tribunal/tribunal-logic/apply',
    routerDir: '/tmp/router',
  };

  it('includes "HEARTBEAT" section', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('HEARTBEAT'), 'Must contain HEARTBEAT section');
  });

  it('includes polling loop instructions', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(
      result.includes('Polling') || result.includes('poll') || result.includes('sleep'),
      'Must include polling protocol'
    );
  });

  it('includes bash heartbeat command with date', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(
      result.includes('date -u') || result.includes('echo') || result.includes('bash'),
      'Must include bash heartbeat command'
    );
  });

  it('includes investigation techniques section', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(
      result.includes('Investigation') || result.includes('grep') || result.includes('find'),
      'Must include investigation techniques'
    );
  });

  it('includes "terminate" handling in polling loop', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('terminate'), 'Must include terminate handling');
  });

  it('includes 30-second dead threshold', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('30'), 'Must mention 30 second timeout threshold');
  });
});
