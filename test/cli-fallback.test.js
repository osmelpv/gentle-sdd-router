/**
 * Tests for gsr fallback CLI commands.
 *
 * Directly calls the exported CLI functions and verifies disk side effects
 * and stdout output, following the pattern in cli-sdd.test.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  runFallbackList,
  runFallbackAdd,
  runFallbackRemove,
  runFallbackMove,
  runFallbackSet,
} from '../src/cli.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-fallback-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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

/** Create a minimal v4 project with a profile and a router.yaml. */
function makeProjectDir(tmp, opts = {}) {
  const routerDir = path.join(tmp, 'router');
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  // Minimal router.yaml
  fs.writeFileSync(path.join(routerDir, 'router.yaml'),
    'version: 5\nactive_sdd: agent-orchestrator\nactive_preset: test-preset\nactivation_state: active\n',
    'utf8',
  );

  // A profile file with fallbacks
  const fallbacks = opts.fallbacks ?? 'mistral/mistral-large-3, opencode/qwen3.6-plus-free';
  const profile = `name: test-preset
sdd: agent-orchestrator
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: ${fallbacks}
  explore:
    - target: opencode-go/glm-5
      kind: lane
      phase: explore
      role: primary
`;
  fs.writeFileSync(path.join(profilesDir, 'test-preset.router.yaml'), profile, 'utf8');

  return { routerDir, configPath: path.join(routerDir, 'router.yaml') };
}

/** Read the profile content back from disk. */
function readProfile(routerDir, presetName) {
  const filePath = path.join(routerDir, 'profiles', `${presetName}.router.yaml`);
  return fs.readFileSync(filePath, 'utf8');
}

// ─── fallback-io unit tests ───────────────────────────────────────────────────

import {
  readFallbackChain,
  writeFallbackChain,
  formatFallbackList,
  validateModelId,
  getPresetPhases,
  resolveLane,
} from '../src/core/fallback-io.js';

describe('fallback-io: readFallbackChain', () => {
  test('reads CSV fallbacks from a profile file', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free',
      });
      const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
      assert.deepEqual(chain, ['mistral/mistral-large-3', 'opencode/qwen3.6-plus-free']);
    } finally {
      cleanup(tmp);
    }
  });

  test('returns empty array when no fallbacks defined', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp, { fallbacks: '' });
      // Rebuild profile without fallbacks field
      const routerDir = path.join(tmp, 'router');
      fs.writeFileSync(path.join(routerDir, 'profiles', 'test-preset.router.yaml'),
        `name: test-preset
sdd: agent-orchestrator
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
`, 'utf8');
      const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
      assert.deepEqual(chain, []);
    } finally {
      cleanup(tmp);
    }
  });

  test('throws if preset not found', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp);
      assert.throws(
        () => readFallbackChain(configPath, 'nonexistent', 'orchestrator', 0),
        /Preset 'nonexistent' not found/,
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws if phase not found', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp);
      assert.throws(
        () => readFallbackChain(configPath, 'test-preset', 'nonexistent-phase', 0),
        /Phase 'nonexistent-phase' not found/,
      );
    } finally {
      cleanup(tmp);
    }
  });
});

describe('fallback-io: writeFallbackChain', () => {
  test('writes a new CSV fallback string to the profile file', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath, routerDir } = makeProjectDir(tmp);
      const newChain = ['openai/gpt-5.4', 'anthropic/claude-haiku-3'];
      await writeFallbackChain(configPath, 'test-preset', 'orchestrator', 0, newChain);

      const profileContent = readProfile(routerDir, 'test-preset');
      assert.ok(profileContent.includes('openai/gpt-5.4, anthropic/claude-haiku-3'),
        'profile must contain new chain as CSV');
    } finally {
      cleanup(tmp);
    }
  });

  test('removes fallbacks field when newChain is empty', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath, routerDir } = makeProjectDir(tmp);
      await writeFallbackChain(configPath, 'test-preset', 'orchestrator', 0, []);

      const profileContent = readProfile(routerDir, 'test-preset');
      // The fallbacks key should no longer appear for orchestrator lane
      // (it can appear for other phases if they have fallbacks)
      const lines = profileContent.split('\n');
      const orchestratorIdx = lines.findIndex(l => l.includes('target: anthropic/claude-sonnet-4-6'));
      const nextTargetIdx = lines.findIndex((l, i) => i > orchestratorIdx && l.includes('target:'));
      const orchSection = lines.slice(orchestratorIdx, nextTargetIdx === -1 ? undefined : nextTargetIdx);
      assert.ok(!orchSection.some(l => l.includes('fallbacks:')),
        'fallbacks key must be absent after empty write');
    } finally {
      cleanup(tmp);
    }
  });
});

describe('fallback-io: formatFallbackList', () => {
  test('formats chain as numbered list', () => {
    const result = formatFallbackList(['modelA', 'modelB']);
    assert.ok(result.includes('1. modelA'));
    assert.ok(result.includes('2. modelB'));
  });

  test('returns "(none)" for empty chain', () => {
    assert.equal(formatFallbackList([]), '  (none)');
  });
});

describe('fallback-io: validateModelId', () => {
  test('returns null for valid provider/model format', () => {
    assert.equal(validateModelId('openai/gpt-5'), null);
    assert.equal(validateModelId('anthropic/claude-sonnet'), null);
    assert.equal(validateModelId('opencode-go/glm-5'), null);
  });

  test('returns error string for missing slash', () => {
    const err = validateModelId('gpt-5');
    assert.ok(typeof err === 'string');
    assert.ok(err.includes('provider/model'));
  });

  test('returns error string for empty string', () => {
    const err = validateModelId('');
    assert.ok(typeof err === 'string');
  });
});

describe('fallback-io: resolveLane', () => {
  test('returns lane at given index', () => {
    const lanes = [{ target: 'modelA' }, { target: 'modelB' }];
    const lane = resolveLane(lanes, 1, 'test');
    assert.equal(lane.target, 'modelB');
  });

  test('throws for out-of-bounds index', () => {
    const lanes = [{ target: 'modelA' }];
    assert.throws(() => resolveLane(lanes, 5, 'test'), /out of bounds/);
  });

  test('throws for empty lanes array', () => {
    assert.throws(() => resolveLane([], 0, 'test'), /no lanes/);
  });
});

describe('fallback-io: getPresetPhases', () => {
  test('returns all phase names from a preset', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp);
      const phases = getPresetPhases(configPath, 'test-preset');
      assert.ok(phases.includes('orchestrator'), 'must include orchestrator');
      assert.ok(phases.includes('explore'), 'must include explore');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws if preset not found', () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp);
      assert.throws(() => getPresetPhases(configPath, 'nonexistent'), /not found/);
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── CLI command tests ────────────────────────────────────────────────────────

describe('runFallbackList', () => {
  test('lists all phases when no phase arg', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath, routerDir } = makeProjectDir(tmp);
      // Temporarily set cwd so discoverConfigPath finds it
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() => runFallbackList(['test-preset']));
        assert.ok(out.includes('orchestrator'), 'output must include orchestrator phase');
        assert.ok(out.includes('explore'), 'output must include explore phase');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('lists specific phase with model IDs', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free',
      });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() => runFallbackList(['test-preset', 'orchestrator']));
        assert.ok(out.includes('mistral/mistral-large-3'));
        assert.ok(out.includes('opencode/qwen3.6-plus-free'));
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('shows error for missing preset name', async () => {
    await assert.rejects(
      () => runFallbackList([]),
      /requires a preset name/,
    );
  });
});

describe('runFallbackAdd', () => {
  test('appends a model to the end of the chain', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath, routerDir } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3',
      });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        await captureStdout(() =>
          runFallbackAdd(['test-preset', 'orchestrator', 'openai/gpt-5.4'])
        );
        const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
        assert.deepEqual(chain, ['mistral/mistral-large-3', 'openai/gpt-5.4']);
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('rejects model ID without slash', async () => {
    const tmp = makeTempDir();
    try {
      const { routerDir } = makeProjectDir(tmp);
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() =>
          runFallbackAdd(['test-preset', 'orchestrator', 'invalid-model'])
        );
        assert.ok(out.includes('Error'), 'must print error for invalid model ID');
        assert.ok(out.includes('provider/model'), 'error must mention expected format');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('throws if missing required arguments', async () => {
    await assert.rejects(
      () => runFallbackAdd(['test-preset']),
      /requires/,
    );
  });
});

describe('runFallbackRemove', () => {
  test('removes entry by 1-based index', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath, routerDir } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free, opencode-go/glm-5',
      });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        await captureStdout(() =>
          runFallbackRemove(['test-preset', 'orchestrator', '2'])
        );
        const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
        assert.deepEqual(chain, ['mistral/mistral-large-3', 'opencode-go/glm-5'],
          'entry at position 2 must be removed');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('shows error for out-of-bounds index', async () => {
    const tmp = makeTempDir();
    try {
      makeProjectDir(tmp, { fallbacks: 'mistral/mistral-large-3' });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() =>
          runFallbackRemove(['test-preset', 'orchestrator', '99'])
        );
        assert.ok(out.includes('out of bounds') || out.includes('Error'));
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });
});

describe('runFallbackMove', () => {
  test('moves entry from position 3 to position 1', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free, opencode-go/glm-5',
      });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        await captureStdout(() =>
          runFallbackMove(['test-preset', 'orchestrator', '3', '1'])
        );
        const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
        assert.equal(chain[0], 'opencode-go/glm-5', 'moved entry must be at position 1');
        assert.equal(chain.length, 3, 'chain length must not change');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('shows nothing-to-move when from === to', async () => {
    const tmp = makeTempDir();
    try {
      makeProjectDir(tmp, { fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free' });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() =>
          runFallbackMove(['test-preset', 'orchestrator', '1', '1'])
        );
        assert.ok(out.includes('Nothing to move'));
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });
});

describe('runFallbackSet', () => {
  test('replaces the entire chain', async () => {
    const tmp = makeTempDir();
    try {
      const { configPath } = makeProjectDir(tmp, {
        fallbacks: 'mistral/mistral-large-3, opencode/qwen3.6-plus-free',
      });
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        await captureStdout(() =>
          runFallbackSet(['test-preset', 'orchestrator', 'openai/gpt-5.4,anthropic/claude-haiku-3'])
        );
        const chain = readFallbackChain(configPath, 'test-preset', 'orchestrator', 0);
        assert.deepEqual(chain, ['openai/gpt-5.4', 'anthropic/claude-haiku-3']);
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('rejects invalid model IDs in the list', async () => {
    const tmp = makeTempDir();
    try {
      makeProjectDir(tmp);
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const out = await captureStdout(() =>
          runFallbackSet(['test-preset', 'orchestrator', 'openai/gpt-5,invalid-model'])
        );
        assert.ok(out.includes('Error'), 'must show error for invalid model ID');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      cleanup(tmp);
    }
  });

  test('throws if missing required arguments', async () => {
    await assert.rejects(
      () => runFallbackSet(['test-preset']),
      /requires/,
    );
  });
});
