/**
 * Agent Identity Editor screen.
 *
 * Allows editing the identity section of a profile:
 *   - Context input (free text)
 *   - Custom prompt input (free text; if set, bypasses all inheritance)
 *   - Inherit AGENTS.md toggle (default: true)
 *   - Preview of the resolved prompt (read-only)
 *
 * Steps:
 *   1. Context input
 *   2. Custom prompt input
 *   3. Inherit AGENTS.md toggle
 *   4. Preview + save/cancel
 *
 * ESC at any step cancels and returns to previous screen.
 */
import React, { useReducer, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { resolveIdentity } from '../../../core/agent-identity.js';
import { getActivePresetOwner } from '../../../core/public-preset-metadata.js';

const h = React.createElement;

// ── Initial state and reducer ─────────────────────────────────────────────────

export const identityEditorInitialState = {
  step: 1,               // 1=Context, 2=Prompt, 3=Inherit toggle, 4=Preview
  context: '',
  prompt: '',
  inherit_agents_md: true,
  saving: false,
  error: null,
};

export function identityEditorReducer(state, action) {
  switch (action.type) {
    case 'SET_CONTEXT':
      return { ...state, context: action.value, error: null, step: 2 };
    case 'SET_PROMPT':
      return { ...state, prompt: action.value, error: null, step: 3 };
    case 'SET_INHERIT_AGENTS_MD':
      return { ...state, inherit_agents_md: action.value, step: 4 };
    case 'TOGGLE_INHERIT':
      return { ...state, inherit_agents_md: !state.inherit_agents_md };
    case 'SET_ERROR':
      return { ...state, error: action.value, saving: false };
    case 'SET_SAVING':
      return { ...state, saving: true };
    case 'BACK':
      if (state.step <= 1) return state;
      return { ...state, step: state.step - 1, error: null };
    default:
      return state;
  }
}

/**
 * Pure helper for ESC key handling.
 * ESC always cancels the editor and returns to previous screen.
 */
export function identityEditorHandleEscape(router) {
  router.pop();
}

// ── AgentIdentityEditor component ─────────────────────────────────────────────

export function AgentIdentityEditor({
  router,
  configPath,
  setDescription,
  showResult,
  reloadConfig,
  selectedProfile,
  selectedCatalog,
}) {
  const [state, dispatch] = useReducer(identityEditorReducer, identityEditorInitialState);

  useInput((input, key) => {
    if (key.escape) {
      identityEditorHandleEscape(router);
    }
  });

  useEffect(() => {
    if (!setDescription) return;
    const descs = {
      1: 'Enter optional agent context (extra info about this profile). Press Enter to skip.',
      2: 'Enter a custom prompt. If set, bypasses all inheritance. Press Enter to skip.',
      3: 'Choose whether to inherit AGENTS.md content (default: yes).',
      4: 'Review the resolved identity and save or cancel.',
    };
    setDescription(descs[state.step] ?? '');
  }, [state.step, setDescription]);

  // Step 1: Context input
  if (state.step === 1) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Edit Identity — ${selectedProfile || ''}: Step 1/4: Agent Context`),
      h(Text, { color: colors.subtext }, 'Optional free-text context injected into the agent prompt. Press Enter to skip.'),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error) : null,
      h(TextInput, {
        placeholder: 'e.g. "Project: MyApp. Boundary: report-only."',
        onSubmit: (value) => {
          dispatch({ type: 'SET_CONTEXT', value: value.trim() });
        },
      }),
    );
  }

  // Step 2: Custom prompt input
  if (state.step === 2) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Edit Identity — ${selectedProfile || ''}: Step 2/4: Custom Prompt`),
      h(Text, { color: colors.subtext }, 'If set, this prompt is used verbatim — all inheritance is skipped. Press Enter to skip.'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'e.g. "You are a senior architect using SDD methodology."',
        onSubmit: (value) => {
          dispatch({ type: 'SET_PROMPT', value: value.trim() });
        },
      }),
    );
  }

  // Step 3: Inherit AGENTS.md toggle
  if (state.step === 3) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Edit Identity — ${selectedProfile || ''}: Step 3/4: Inherit AGENTS.md`),
      h(Text, null, ''),
      h(Text, null, `Current: ${state.inherit_agents_md ? 'Yes (inherit AGENTS.md)' : 'No (skip AGENTS.md)'}`),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Yes — inherit AGENTS.md (recommended)', value: 'true', description: 'Include AGENTS.md content in the resolved agent context.' },
          { label: 'No — skip AGENTS.md', value: 'false', description: 'Do not read AGENTS.md. Use only explicit context and fallback.' },
        ],
        onSelect: (value) => {
          dispatch({ type: 'SET_INHERIT_AGENTS_MD', value: value === 'true' });
        },
        setDescription,
        showBack: false,
      }),
    );
  }

  // Step 4: Preview + save
  if (state.step === 4) {
    // Build a preview config to show what will be resolved
    const previewProfileConfig = {
      identity: {
        context: state.context || null,
        prompt: state.prompt || null,
        inherit_agents_md: state.inherit_agents_md,
      },
    };
    const cwd = configPath ? configPath.replace(/\/router\.yaml$/, '') : process.cwd();
    const resolved = resolveIdentity(previewProfileConfig, { cwd, _skipGentleAi: false });

    const identityToSave = {};
    if (state.context) identityToSave.context = state.context;
    if (state.prompt) identityToSave.prompt = state.prompt;
    identityToSave.inherit_agents_md = state.inherit_agents_md;

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Edit Identity — ${selectedProfile || ''}: Step 4/4: Preview`),
      h(Text, null, ''),
      h(Text, { color: colors.peach }, 'Resolved prompt preview:'),
      h(Text, { color: colors.text }, resolved.prompt.slice(0, 200) + (resolved.prompt.length > 200 ? '...' : '')),
      h(Text, null, ''),
      h(Text, { color: colors.subtext }, `Sources: ${resolved.sources.join(', ')}`),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error) : null,
      h(Menu, {
        items: [
          { label: 'Save identity', value: 'save', description: 'Write identity section to profile YAML.' },
          { label: 'Cancel', value: 'cancel', description: 'Discard changes and go back.' },
        ],
        onSelect: async (value) => {
          if (value === 'cancel') {
            router.pop();
            return;
          }
          dispatch({ type: 'SET_SAVING' });
          try {
            const mod = await import('../../../../src/router-config.js').catch(
              () => import('../../../router-config.js')
            );
            const pathMod = await import('node:path');
            const routerDir = configPath ? pathMod.dirname(configPath) : process.cwd();
            const loadedConfig = mod.loadRouterConfig(configPath);
            const activeOwner = getActivePresetOwner(loadedConfig);
            const profileData = loadedConfig?.catalogs?.[selectedCatalog || activeOwner?.catalogName || 'default']?.presets?.[selectedProfile];

            if (!profileData) {
              dispatch({ type: 'SET_ERROR', value: `Profile '${selectedProfile}' not found.` });
              return;
            }

            const updatedPreset = { ...profileData, identity: identityToSave };
            mod.updateProfile(selectedProfile, updatedPreset, routerDir);
            await reloadConfig?.();
            showResult?.(`Identity updated for profile '${selectedProfile}'.`);
            router.pop();
          } catch (err) {
            dispatch({ type: 'SET_ERROR', value: err.message });
          }
        },
        setDescription,
        showBack: false,
      }),
    );
  }

  return h(Text, { color: colors.red }, 'Unknown identity editor state');
}
