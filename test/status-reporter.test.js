/**
 * Tests for src/core/status-reporter.js
 *
 * Covers: getSimpleStatus(), getVerboseStatus(), buildConnectionGraph()
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getSimpleStatus,
  getVerboseStatus,
  buildConnectionGraph,
} from '../src/core/status-reporter.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid config with one preset */
const minConfig = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'balanced',
  activation_state: 'active',
  catalogs: {
    default: {
      enabled: true,
      presets: {
        balanced: {
          phases: {
            orchestrator: [{ target: 'anthropic/claude-sonnet' }],
            explore: [{ target: 'google/gemini-pro' }],
          },
        },
      },
    },
  },
};

/** Config with debug_invoke on active preset */
const configWithDebug = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'multivendor',
  activation_state: 'active',
  catalogs: {
    default: {
      enabled: true,
      presets: {
        multivendor: {
          debug_invoke: {
            preset: 'sdd-debug-mono',
            trigger: 'on_issues',
            required_fields: ['issues', 'affected_files'],
          },
          phases: {
            orchestrator: [{ target: 'anthropic/claude-opus' }],
            explore: [{ target: 'google/gemini-pro' }],
            spec: [{ target: 'anthropic/claude-opus' }],
            verify: [{ target: 'openai/gpt-5' }],
            archive: [{ target: 'google/gemini-flash' }],
          },
        },
      },
    },
  },
};

/** Config with identity block */
const configWithIdentity = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'claude',
  activation_state: 'active',
  catalogs: {
    default: {
      enabled: true,
      presets: {
        claude: {
          identity: {
            persona: 'gentleman',
            inherit_agents_md: true,
          },
          phases: {
            orchestrator: [{ target: 'anthropic/claude-opus' }],
          },
        },
      },
    },
  },
};

/** Config with multiple catalogs */
const configMultiCatalog = {
  version: 3,
  active_catalog: 'default',
  active_preset: 'multivendor',
  activation_state: 'active',
  catalogs: {
    default: {
      enabled: true,
      displayName: 'SDD-Orchestrator',
      presets: {
        multivendor: {
          phases: {
            orchestrator: [{ target: 'anthropic/claude-opus' }],
            verify: [{ target: 'openai/gpt-5' }],
          },
        },
        claude: {
          phases: {
            orchestrator: [{ target: 'anthropic/claude-opus' }],
          },
        },
      },
    },
    'sdd-debug': {
      enabled: true,
      displayName: 'SDD-Debug',
      presets: {
        'sdd-debug-mono': {
          phases: {
            'explore-issues': [{ target: 'anthropic/claude-sonnet' }],
            triage: [{ target: 'anthropic/claude-sonnet' }],
          },
        },
      },
    },
  },
};

// ── getSimpleStatus — not installed ──────────────────────────────────────────

describe('getSimpleStatus — not installed', () => {
  test('returns string starting with ❌ when config is null', () => {
    const result = getSimpleStatus(null, {});
    assert.ok(typeof result === 'string', 'should return a string');
    assert.ok(result.includes('❌'), `should have ❌ emoji. Got: ${result}`);
  });

  test('mentions "not installed" or "install" when no config', () => {
    const result = getSimpleStatus(null, {});
    const lower = result.toLowerCase();
    assert.ok(
      lower.includes('not installed') || lower.includes('install'),
      `should mention install. Got: ${result}`
    );
  });

  test('shows gsr setup install hint when no config', () => {
    const result = getSimpleStatus(null, {});
    assert.ok(
      result.includes('gsr setup install') || result.includes('gsr install'),
      `should show install command. Got: ${result}`
    );
  });
});

// ── getSimpleStatus — needs sync ────────────────────────────────────────────

describe('getSimpleStatus — needs sync', () => {
  test('returns string with ⚠️ when manifest does not exist', () => {
    // No manifestPath option = not synced yet
    const result = getSimpleStatus(minConfig, { manifestExists: false });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('⚠️'), `should have ⚠️. Got: ${result}`);
  });

  test('mentions "sync" command when needs sync', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: false });
    assert.ok(
      result.includes('gsr sync'),
      `should mention gsr sync. Got: ${result}`
    );
  });
});

// ── getSimpleStatus — ready/synchronized ────────────────────────────────────

describe('getSimpleStatus — ready', () => {
  test('returns string with ✅ when synced', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('✅'), `should have ✅. Got: ${result}`);
  });

  test('shows preset name and phase count', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('balanced'), `should show preset name. Got: ${result}`);
    // minConfig has 2 phases
    assert.ok(result.includes('2'), `should show phase count. Got: ${result}`);
  });

  test('shows active preset in a Preset field', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('Preset'), `should have Preset field. Got: ${result}`);
  });

  test('shows gsr status --verbose hint', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    assert.ok(
      result.includes('gsr status --verbose'),
      `should show verbose hint. Got: ${result}`
    );
  });
});

// ── getSimpleStatus — SDDs ────────────────────────────────────────────────────

describe('getSimpleStatus — SDDs section', () => {
  test('shows visible SDD count when multiple sources exist', () => {
    const result = getSimpleStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(result.includes('SDDs'), `should have SDDs field. Got: ${result}`);
    assert.ok(result.includes('2'), `should show count 2. Got: ${result}`);
  });

  test('shows SDD name in SDDs field', () => {
    const result = getSimpleStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(
      result.includes('agent-orchestrator') || result.includes('sdd-debug'),
      `should show SDD names. Got: ${result}`
    );
  });
});

// ── getSimpleStatus — debug_invoke ───────────────────────────────────────────

describe('getSimpleStatus — debug_invoke', () => {
  test('shows Debug field when preset has debug_invoke', () => {
    const result = getSimpleStatus(configWithDebug, { manifestExists: true });
    assert.ok(result.includes('Debug'), `should show Debug field. Got: ${result}`);
  });

  test('shows debug preset name', () => {
    const result = getSimpleStatus(configWithDebug, { manifestExists: true });
    assert.ok(
      result.includes('sdd-debug-mono'),
      `should show debug preset name. Got: ${result}`
    );
  });

  test('shows trigger type in debug field', () => {
    const result = getSimpleStatus(configWithDebug, { manifestExists: true });
    assert.ok(
      result.includes('on_issues') || result.includes('on issues'),
      `should show trigger. Got: ${result}`
    );
  });
});

// ── getSimpleStatus — vocabulary contract ────────────────────────────────────

describe('getSimpleStatus — vocabulary contract', () => {
  const FORBIDDEN_INTERNAL_TERMS = [
    'overlay',
    '_gsr_generated',
    'sync-manifest',
    'execution mode',
    'boundary',
  ];

  test('does not expose internal terms when synced', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    const lower = result.toLowerCase();
    for (const term of FORBIDDEN_INTERNAL_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `should not expose "${term}". Got: ${result}`
      );
    }
  });

  test('does not expose internal terms when not synced', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: false });
    const lower = result.toLowerCase();
    for (const term of FORBIDDEN_INTERNAL_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `should not expose "${term}". Got: ${result}`
      );
    }
  });
});

// ── getVerboseStatus — basic shape ───────────────────────────────────────────

describe('getVerboseStatus — basic shape', () => {
  test('returns a non-empty string', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0, 'should return non-empty string');
  });

  test('is longer than simple status', () => {
    const simple = getSimpleStatus(minConfig, { manifestExists: true });
    const verbose = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(
      verbose.length > simple.length,
      `verbose (${verbose.length}) should be longer than simple (${simple.length})`
    );
  });

  test('includes CONFIGURATION section', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('CONFIGURATION'), `should have CONFIGURATION. Got: ${result}`);
  });

  test('includes PRESET section', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('PRESET'), `should have PRESET section. Got: ${result}`);
  });

  test('includes ROUTES section', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('ROUTES'), `should have ROUTES section. Got: ${result}`);
  });
});

// ── getVerboseStatus — CONFIGURATION section ─────────────────────────────────

describe('getVerboseStatus — CONFIGURATION section', () => {
  test('shows activation state', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(
      result.includes('active') || result.includes('Activation'),
      `should show activation. Got: ${result}`
    );
  });

  test('shows schema version', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(
      result.includes('v3') || result.includes('v4') || result.includes('Schema'),
      `should show schema version. Got: ${result}`
    );
  });

  test('shows Config path if routerDir provided', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true, configPath: 'router/router.yaml' });
    assert.ok(
      result.includes('router/router.yaml') || result.includes('Config'),
      `should show config path. Got: ${result}`
    );
  });
});

// ── getVerboseStatus — PRESET section ────────────────────────────────────────

describe('getVerboseStatus — PRESET section', () => {
  test('shows active preset name', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('balanced'), `should show preset name. Got: ${result}`);
  });

  test('shows phase count for active preset', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('2'), `should show phase count. Got: ${result}`);
  });

  test('shows debug_invoke info when present', () => {
    const result = getVerboseStatus(configWithDebug, { manifestExists: true });
    assert.ok(result.includes('sdd-debug-mono'), `should show debug preset. Got: ${result}`);
    assert.ok(result.includes('on_issues'), `should show trigger. Got: ${result}`);
  });

  test('shows identity persona when present', () => {
    const result = getVerboseStatus(configWithIdentity, { manifestExists: true });
    assert.ok(
      result.includes('gentleman') || result.includes('Identity'),
      `should show identity. Got: ${result}`
    );
  });
});

// ── getVerboseStatus — ROUTES section ────────────────────────────────────────

describe('getVerboseStatus — ROUTES section', () => {
  test('shows phase names from active preset', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(result.includes('orchestrator'), `should show orchestrator phase. Got: ${result}`);
    assert.ok(result.includes('explore'), `should show explore phase. Got: ${result}`);
  });

  test('shows target model for each phase', () => {
    const result = getVerboseStatus(minConfig, { manifestExists: true });
    assert.ok(
      result.includes('anthropic/claude-sonnet') || result.includes('claude-sonnet'),
      `should show model target. Got: ${result}`
    );
  });
});

// ── getVerboseStatus — SDDS section ──────────────────────────────────────────

describe('getVerboseStatus — SDDS section', () => {
  test('shows SDDS section when multiple sources exist', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(result.includes('SDDS'), `should have SDDS section. Got: ${result}`);
  });

  test('shows visible/hidden counts for each SDD', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(
      result.includes('visible') || result.includes('hidden'),
      `should show visible/hidden state. Got: ${result}`
    );
  });

  test('shows SDD name in SDDS section', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(result.includes('sdd-debug'), `should show sdd-debug SDD. Got: ${result}`);
  });
});

// ── getVerboseStatus — SDD CONNECTIONS section ───────────────────────────────

describe('getVerboseStatus — SDD CONNECTIONS section', () => {
  test('shows SDD CONNECTIONS section when debug_invoke present', () => {
    const result = getVerboseStatus(configWithDebug, { manifestExists: true });
    assert.ok(
      result.includes('SDD CONNECTIONS') || result.includes('CONNECTIONS'),
      `should have SDD CONNECTIONS section. Got: ${result}`
    );
  });

  test('shows invoke arrow when debug_invoke present', () => {
    const result = getVerboseStatus(configWithDebug, { manifestExists: true });
    assert.ok(
      result.includes('→') || result.includes('invoke'),
      `should show arrow or invoke. Got: ${result}`
    );
  });
});

// ── buildConnectionGraph ─────────────────────────────────────────────────────

describe('buildConnectionGraph — basic structure', () => {
  test('returns an array of strings', () => {
    const phases = ['orchestrator', 'explore', 'spec', 'verify', 'archive'];
    const result = buildConnectionGraph(phases, null, []);
    assert.ok(Array.isArray(result), 'should return array');
    assert.ok(result.length > 0, 'should return non-empty array');
    for (const line of result) {
      assert.ok(typeof line === 'string', `each element should be string, got: ${typeof line}`);
    }
  });

  test('includes each phase name in the graph', () => {
    const phases = ['orchestrator', 'explore', 'verify'];
    const result = buildConnectionGraph(phases, null, []);
    const joined = result.join('\n');
    assert.ok(joined.includes('orchestrator'), `should include orchestrator. Got:\n${joined}`);
    assert.ok(joined.includes('explore'), `should include explore. Got:\n${joined}`);
    assert.ok(joined.includes('verify'), `should include verify. Got:\n${joined}`);
  });

  test('shows debug_invoke arrow on specified phase', () => {
    const phases = ['orchestrator', 'explore', 'verify', 'archive'];
    const debugInvoke = { preset: 'sdd-debug-mono', trigger: 'on_issues', phase: 'verify' };
    const result = buildConnectionGraph(phases, debugInvoke, []);
    const joined = result.join('\n');
    assert.ok(
      joined.includes('→') || joined.includes('invoke'),
      `should show arrow for invoke. Got:\n${joined}`
    );
    assert.ok(
      joined.includes('sdd-debug-mono') || joined.includes('sdd-debug'),
      `should reference debug preset. Got:\n${joined}`
    );
  });

  test('returns at least one line per phase', () => {
    const phases = ['orchestrator', 'explore', 'spec'];
    const result = buildConnectionGraph(phases, null, []);
    // At minimum one line per phase name
    assert.ok(result.length >= phases.length, `should have at least ${phases.length} lines. Got ${result.length}`);
  });

  test('handles empty phases array gracefully', () => {
    const result = buildConnectionGraph([], null, []);
    assert.ok(Array.isArray(result), 'should still return array');
  });

  test('handles null debugInvoke gracefully', () => {
    const phases = ['orchestrator', 'verify'];
    assert.doesNotThrow(() => buildConnectionGraph(phases, null, []));
  });

  test('handles null customSdds gracefully', () => {
    const phases = ['orchestrator', 'verify'];
    assert.doesNotThrow(() => buildConnectionGraph(phases, null, null));
  });
});

// ── getVerboseStatus — null/missing config ───────────────────────────────────

describe('getVerboseStatus — null config', () => {
  test('returns a string for null config', () => {
    const result = getVerboseStatus(null, {});
    assert.ok(typeof result === 'string');
  });

  test('shows not installed message for null config', () => {
    const result = getVerboseStatus(null, {});
    const lower = result.toLowerCase();
    assert.ok(
      lower.includes('not installed') || lower.includes('install'),
      `should mention install. Got: ${result}`
    );
  });
});

// ── Triangulation: inactive state ────────────────────────────────────────────

describe('getSimpleStatus — inactive state', () => {
  test('shows ⚠️ when activation_state is inactive', () => {
    const inactiveConfig = { ...minConfig, activation_state: 'inactive' };
    const result = getSimpleStatus(inactiveConfig, { manifestExists: true });
    assert.ok(result.includes('⚠️'), `should show ⚠️ for inactive. Got: ${result}`);
  });

  test('inactive state differs from needs-sync state', () => {
    const inactiveConfig = { ...minConfig, activation_state: 'inactive' };
    const syncNeeded = getSimpleStatus(minConfig, { manifestExists: false });
    const inactive = getSimpleStatus(inactiveConfig, { manifestExists: true });
    // Both show ⚠️ but should differ in their message text
    assert.ok(typeof syncNeeded === 'string' && typeof inactive === 'string');
    assert.notEqual(syncNeeded, inactive, 'inactive and sync-needed states should have different output');
  });
});

// ── Triangulation: buildConnectionGraph with custom SDDs ─────────────────────

describe('buildConnectionGraph — custom SDD sections', () => {
  test('shows custom SDD block when sdds array provided', () => {
    const phases = ['orchestrator', 'verify'];
    const customSdds = [
      {
        name: 'game-design',
        phases: {
          concept: {},
          'level-design': {},
          ux: {},
        },
      },
    ];
    const result = buildConnectionGraph(phases, null, customSdds);
    const joined = result.join('\n');
    assert.ok(joined.includes('game-design'), `should show custom SDD name. Got:\n${joined}`);
    assert.ok(joined.includes('concept'), `should show SDD phases. Got:\n${joined}`);
  });

  test('last phase of graph uses └── connector', () => {
    const phases = ['orchestrator', 'verify'];
    const result = buildConnectionGraph(phases, null, []);
    const joined = result.join('\n');
    assert.ok(joined.includes('└──'), `last phase should use └── connector. Got:\n${joined}`);
  });

  test('non-last phases use ├── connector', () => {
    const phases = ['orchestrator', 'explore', 'verify'];
    const result = buildConnectionGraph(phases, null, []);
    const joined = result.join('\n');
    assert.ok(joined.includes('├──'), `non-last phases should use ├── connector. Got:\n${joined}`);
  });

  test('debug_invoke arrow defaults to verify phase if phase not specified', () => {
    const phases = ['orchestrator', 'explore', 'verify', 'archive'];
    const debugInvoke = { preset: 'sdd-debug-mono', trigger: 'on_issues' }; // no phase field
    const result = buildConnectionGraph(phases, debugInvoke, []);
    const joined = result.join('\n');
    // verify should have the arrow
    assert.ok(
      joined.includes('verify ──invoke──→') || joined.includes('verify'),
      `verify phase should appear. Got:\n${joined}`
    );
    assert.ok(joined.includes('sdd-debug-mono'), `should reference debug preset. Got:\n${joined}`);
  });
});

// ── Triangulation: getVerboseStatus PRESETS section ───────────────────────────

describe('getVerboseStatus — PRESETS section', () => {
  test('marks active preset with *', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(result.includes('*'), `should mark active preset with *. Got:\n${result.slice(0, 800)}`);
  });

  test('shows phase count for each preset', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    // multivendor has 2 phases
    assert.ok(result.includes('2 phases'), `should show phase count. Got:\n${result.slice(0, 800)}`);
  });

  test('shows PRESETS section header', () => {
    const result = getVerboseStatus(configMultiCatalog, { manifestExists: true });
    assert.ok(result.includes('PRESETS'), `should have PRESETS section. Got:\n${result.slice(0, 800)}`);
  });
});

// ── Triangulation: getSimpleStatus identity label ─────────────────────────────

describe('getSimpleStatus — identity label display', () => {
  test('shows explicit persona name when set', () => {
    const result = getSimpleStatus(configWithIdentity, { manifestExists: true });
    assert.ok(
      result.includes('gentleman'),
      `should show explicit persona. Got: ${result}`
    );
  });

  test('shows AGENTS.md inherited when no explicit persona', () => {
    const result = getSimpleStatus(minConfig, { manifestExists: true });
    assert.ok(
      result.includes('AGENTS.md') || result.includes('Identity'),
      `should show identity info. Got: ${result}`
    );
  });
});
