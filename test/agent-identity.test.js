/**
 * Tests for src/core/agent-identity.js
 * RED phase: all tests fail because agent-identity.js does not exist yet.
 *
 * Spec scenarios: T1–T6
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach } from 'node:test';
import {
  resolveIdentity,
  readAgentsMd,
  resetIdentityCache,
} from '../src/core/agent-identity.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-identity-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function writeAgentsMd(dir, content) {
  const filePath = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── T1: Profile without identity section → defaults applied ──────────────────

describe('resolveIdentity — T1: defaults', () => {
  beforeEach(() => resetIdentityCache());

  test('profile without identity uses neutral fallback when no gentle-ai and no AGENTS.md', () => {
    const dir = makeTempDir();
    try {
      // _skipGentleAi ensures test is deterministic regardless of environment
      const result = resolveIdentity({}, { cwd: dir, _skipGentleAi: true });

      assert.equal(typeof result.prompt, 'string', 'prompt must be a string');
      assert.ok(result.prompt.length > 0, 'prompt must be non-empty');
      // neutral fallback must be present when no AGENTS.md and no gentle-ai
      assert.ok(
        result.sources.includes('neutral'),
        `sources should include "neutral", got: ${JSON.stringify(result.sources)}`
      );
    } finally {
      cleanup(dir);
    }
  });

  test('profile with no identity section returns object with required shape', () => {
    const dir = makeTempDir();
    try {
      const result = resolveIdentity({}, { cwd: dir });

      assert.equal(typeof result.prompt, 'string');
      assert.ok(Array.isArray(result.sources), 'sources must be an array');
      assert.equal(typeof result.inherit_agents_md, 'boolean');
    } finally {
      cleanup(dir);
    }
  });
});

// ── T2: Explicit prompt bypasses all inheritance ──────────────────────────────

describe('resolveIdentity — T2: explicit prompt short-circuit', () => {
  beforeEach(() => resetIdentityCache());

  test('explicit prompt is used verbatim and skips all inheritance', () => {
    const dir = makeTempDir();
    // Even with AGENTS.md present, explicit prompt must win
    writeAgentsMd(dir, 'This should NOT appear');
    try {
      const profileConfig = { identity: { prompt: 'You are a senior architect.' } };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.equal(result.prompt, 'You are a senior architect.');
      assert.ok(
        result.sources.includes('explicit-prompt'),
        `sources should include "explicit-prompt", got: ${JSON.stringify(result.sources)}`
      );
      assert.ok(
        !result.sources.includes('agents-md'),
        'explicit prompt must skip AGENTS.md'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('explicit prompt takes priority over identity.context', () => {
    const dir = makeTempDir();
    try {
      const profileConfig = {
        identity: {
          prompt: 'Custom verbatim prompt.',
          context: 'This should be ignored',
        },
      };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.equal(result.prompt, 'Custom verbatim prompt.');
    } finally {
      cleanup(dir);
    }
  });
});

// ── T3: Explicit context + AGENTS.md merge ────────────────────────────────────

describe('resolveIdentity — T3: context + AGENTS.md layering', () => {
  beforeEach(() => resetIdentityCache());

  test('explicit context and AGENTS.md content both appear in resolved prompt', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, '# AGENTS\nBe helpful.');
    try {
      const profileConfig = {
        identity: {
          context: 'Project: GSR. Boundary: report-only.',
          inherit_agents_md: true,
        },
      };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.ok(result.prompt.includes('Project: GSR'), 'explicit context must be in prompt');
      assert.ok(result.prompt.includes('Be helpful'), 'AGENTS.md content must be in prompt');
      assert.ok(result.sources.includes('explicit-context'), 'sources must include explicit-context');
      assert.ok(result.sources.includes('agents-md'), 'sources must include agents-md');
    } finally {
      cleanup(dir);
    }
  });

  test('inherit_agents_md defaults to true when not specified', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, 'From AGENTS.md');
    try {
      const profileConfig = { identity: { context: 'My context.' } };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      // Default is true so AGENTS.md should be included
      assert.ok(result.prompt.includes('From AGENTS.md'), 'AGENTS.md must be included by default');
    } finally {
      cleanup(dir);
    }
  });
});

// ── T4: inherit_agents_md=false → no AGENTS.md, no gentle-ai ─────────────────

describe('resolveIdentity — T4: inherit_agents_md=false', () => {
  beforeEach(() => resetIdentityCache());

  test('inherit_agents_md=false excludes AGENTS.md from prompt', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, 'This must NOT appear');
    try {
      const profileConfig = {
        identity: {
          context: 'My explicit context.',
          inherit_agents_md: false,
        },
      };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.ok(
        !result.prompt.includes('This must NOT appear'),
        'AGENTS.md content must not appear when inherit_agents_md=false'
      );
      assert.ok(
        !result.sources.includes('agents-md'),
        'sources must not include agents-md when inherit_agents_md=false'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('inherit_agents_md=false still uses explicit context', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, 'Should not appear');
    try {
      const profileConfig = {
        identity: {
          context: 'Keep this context.',
          inherit_agents_md: false,
        },
      };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.ok(result.prompt.includes('Keep this context.'), 'explicit context must still appear');
    } finally {
      cleanup(dir);
    }
  });
});

// ── T5: AGENTS.md missing → skipped silently ─────────────────────────────────

describe('resolveIdentity — T5: missing AGENTS.md', () => {
  beforeEach(() => resetIdentityCache());

  test('missing AGENTS.md is skipped silently, does not throw', () => {
    const dir = makeTempDir();
    // no AGENTS.md written
    try {
      const profileConfig = { identity: { context: 'Context here.', inherit_agents_md: true } };

      assert.doesNotThrow(() => {
        resolveIdentity(profileConfig, { cwd: dir });
      });
    } finally {
      cleanup(dir);
    }
  });

  test('missing AGENTS.md falls back but still includes explicit context', () => {
    const dir = makeTempDir();
    try {
      const profileConfig = { identity: { context: 'Explicit only.', inherit_agents_md: true } };
      const result = resolveIdentity(profileConfig, { cwd: dir });

      assert.ok(result.prompt.includes('Explicit only.'), 'explicit context must be present');
      assert.ok(
        !result.sources.includes('agents-md'),
        'agents-md must not appear in sources when file is missing'
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ── T6: Neutral fallback ──────────────────────────────────────────────────────

describe('resolveIdentity — T6: neutral fallback', () => {
  beforeEach(() => resetIdentityCache());

  test('empty profile with no AGENTS.md returns non-empty prompt with neutral fallback', () => {
    const dir = makeTempDir();
    // No AGENTS.md, no explicit fields, gentle-ai unavailable in this env
    try {
      const result = resolveIdentity({}, { cwd: dir, _skipGentleAi: true });

      assert.ok(result.prompt.length > 0, 'neutral fallback prompt must be non-empty');
      assert.ok(
        result.sources.includes('neutral'),
        `sources must include "neutral" for empty profile, got: ${JSON.stringify(result.sources)}`
      );
    } finally {
      cleanup(dir);
    }
  });

  test('neutral fallback contains the expected fixed string', () => {
    const dir = makeTempDir();
    try {
      const result = resolveIdentity({}, { cwd: dir, _skipGentleAi: true });

      assert.ok(
        result.prompt.includes('AI agent') || result.prompt.includes('GSR'),
        `neutral fallback must mention "AI agent" or "GSR", got: "${result.prompt}"`
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ── readAgentsMd ──────────────────────────────────────────────────────────────

describe('readAgentsMd', () => {
  beforeEach(() => resetIdentityCache());

  test('returns null when no AGENTS.md in the directory tree', () => {
    // Use a temp dir with no AGENTS.md but stop before reaching the real project root
    const dir = makeTempDir();
    try {
      // Pass a stopDir to prevent walking up into the real repo
      const result = readAgentsMd(dir, { stopAt: dir });
      assert.equal(result, null, 'should return null when AGENTS.md is absent');
    } finally {
      cleanup(dir);
    }
  });

  test('returns content when AGENTS.md is in the start directory', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, '# My AGENTS\nHello world');
    try {
      const result = readAgentsMd(dir, { stopAt: dir });

      assert.ok(result !== null, 'should return a result object');
      assert.ok(result.content.includes('Hello world'), 'content must be read correctly');
      assert.ok(result.path.endsWith('AGENTS.md'), 'path must point to AGENTS.md');
    } finally {
      cleanup(dir);
    }
  });

  test('walks up to parent directory to find AGENTS.md', () => {
    const parentDir = makeTempDir();
    const childDir = path.join(parentDir, 'child', 'nested');
    fs.mkdirSync(childDir, { recursive: true });
    writeAgentsMd(parentDir, '# Parent AGENTS\nFrom parent');
    try {
      const result = readAgentsMd(childDir, { stopAt: parentDir });

      assert.ok(result !== null, 'should find AGENTS.md in parent');
      assert.ok(result.content.includes('From parent'));
    } finally {
      cleanup(parentDir);
    }
  });

  test('prefers closest AGENTS.md (nearest ancestor wins)', () => {
    const grandparentDir = makeTempDir();
    const parentDir = path.join(grandparentDir, 'parent');
    const childDir = path.join(parentDir, 'child');
    fs.mkdirSync(childDir, { recursive: true });
    writeAgentsMd(grandparentDir, 'Grandparent content');
    writeAgentsMd(parentDir, 'Parent content');
    try {
      const result = readAgentsMd(childDir, { stopAt: grandparentDir });

      assert.ok(result !== null);
      assert.ok(result.content.includes('Parent content'), 'nearest ancestor wins');
      assert.ok(!result.content.includes('Grandparent content'), 'grandparent must not be used');
    } finally {
      cleanup(grandparentDir);
    }
  });
});

// ── W1: Full-chain deterministic test — explicit context + AGENTS.md ─────────
// Deterministic proof that explicit context AND AGENTS.md both appear in the resolved prompt.
// Note: gentle-ai detection is environment-dependent; this test proves the two deterministic layers.

describe('resolveIdentity — W1: full-chain deterministic (context + AGENTS.md)', () => {
  beforeEach(() => resetIdentityCache());

  test('explicit context + AGENTS.md both appear in resolved prompt (deterministic layers)', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, '# Project AGENTS\nBe precise.');
    try {
      const profileConfig = {
        identity: {
          context: 'Explicit context: deterministic chain test.',
          inherit_agents_md: true,
        },
      };
      // _skipGentleAi makes test fully deterministic regardless of environment
      const result = resolveIdentity(profileConfig, { cwd: dir, _skipGentleAi: true });

      // All three layers must contribute
      assert.ok(
        result.prompt.includes('Explicit context: deterministic chain test.'),
        `explicit context must appear in prompt, got: "${result.prompt.slice(0, 200)}"`
      );
      assert.ok(
        result.prompt.includes('Be precise.'),
        `AGENTS.md content must appear in prompt, got: "${result.prompt.slice(0, 200)}"`
      );
      assert.ok(result.sources.includes('explicit-context'), 'sources must include explicit-context');
      assert.ok(result.sources.includes('agents-md'), 'sources must include agents-md');
    } finally {
      cleanup(dir);
    }
  });

  test('explicit context + AGENTS.md: context comes before AGENTS.md in prompt (order preserved)', () => {
    const dir = makeTempDir();
    writeAgentsMd(dir, 'AGENTS content after context.');
    try {
      const profileConfig = {
        identity: {
          context: 'Explicit context first.',
          inherit_agents_md: true,
        },
      };
      const result = resolveIdentity(profileConfig, { cwd: dir, _skipGentleAi: true });

      const contextIdx = result.prompt.indexOf('Explicit context first.');
      const agentsIdx = result.prompt.indexOf('AGENTS content after context.');

      assert.ok(contextIdx !== -1, 'explicit context must be in prompt');
      assert.ok(agentsIdx !== -1, 'AGENTS.md content must be in prompt');
      assert.ok(
        contextIdx < agentsIdx,
        `explicit context (pos ${contextIdx}) must appear before AGENTS.md (pos ${agentsIdx})`
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ── resetIdentityCache ────────────────────────────────────────────────────────

describe('resetIdentityCache', () => {
  test('can be called without error', () => {
    assert.doesNotThrow(() => resetIdentityCache());
  });

  test('cache is cleared after reset — second call with same args re-reads', () => {
    const dir = makeTempDir();
    const agentsMdPath = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(agentsMdPath, 'First content', 'utf8');
    try {
      const first = readAgentsMd(dir, { stopAt: dir });
      assert.ok(first?.content.includes('First content'));

      // Update file and reset cache
      fs.writeFileSync(agentsMdPath, 'Updated content', 'utf8');
      resetIdentityCache();

      const second = readAgentsMd(dir, { stopAt: dir });
      assert.ok(second?.content.includes('Updated content'), 'cache miss after reset must re-read file');
    } finally {
      cleanup(dir);
    }
  });
});
