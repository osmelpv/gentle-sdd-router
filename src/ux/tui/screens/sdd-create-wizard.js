/**
 * SDD Create Wizard — multi-step wizard for creating a new custom SDD.
 *
 * AI-GUIDE: When an AI creates a new SDD, it should ask:
 *   1. What is the purpose of this SDD?
 *   2. What are the phases and their intents?
 *   3. What context does each phase need?
 *   4. What roles participate in each phase?
 *   5. What outputs does each phase produce?
 *
 * Steps:
 *   1. SDD name (slug validated)
 *   2. Description (what this SDD does)
 *   3. First phase name
 *   4. Phase intent (what this phase does)
 *   5. Review + confirm
 *
 * On completion: creates router/catalogs/<name>/sdd.yaml and navigates to sdd-detail.
 * ESC at any step cancels and returns to sdd-list.
 */
import React, { useReducer, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

/**
 * Pure helper for ESC key handling — extracted for testability.
 * Spec: ESC on ANY step cancels the wizard and navigates to sdd-list (router.pop()).
 * @param {object} _state - Current wizard state (unused — ESC always cancels)
 * @param {{ pop: () => void }} router
 */
export function wizardHandleEscape(_state, router) {
  router.pop();
}

const initialState = {
  step: 1,          // 1=Name, 2=Description, 3=PhaseName, 4=PhaseIntent, 5=Review
  name: '',
  description: '',
  firstPhaseName: '',
  firstPhaseIntent: '',
  saving: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.value, error: null, step: 2 };
    case 'SET_DESCRIPTION': return { ...state, description: action.value, step: 3 };
    case 'SET_PHASE_NAME': return { ...state, firstPhaseName: action.value, error: null, step: 4 };
    case 'SET_PHASE_INTENT': return { ...state, firstPhaseIntent: action.value, step: 5 };
    case 'SET_ERROR': return { ...state, error: action.value, saving: false };
    case 'SET_SAVING': return { ...state, saving: true };
    case 'BACK':
      if (state.step <= 1) return state;
      return { ...state, step: state.step - 1, error: null };
    default: return state;
  }
}

export function SddCreateWizard({
  router,
  configPath,
  setDescription,
  showResult,
  setSelectedSdd,
  reloadConfig,
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useInput((input, key) => {
    if (key.escape) {
      wizardHandleEscape(state, router);
    }
  });

  useEffect(() => {
    if (!setDescription) return;
    const descs = {
      1: 'Enter a slug name for the new SDD (lowercase, hyphens only). Example: game-design, art-production',
      2: 'Describe what this SDD does. Example: "Game design workflow for level creation and asset pipeline"',
      3: 'Enter the name of the first phase. Example: level-design, asset-creation',
      4: 'Enter the intent (purpose) of this phase. Example: "Design game levels and encounters"',
      5: 'Review your SDD and save.',
    };
    setDescription(descs[state.step] ?? '');
  }, [state.step, setDescription]);

  // Step 1: Name
  if (state.step === 1) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Create SDD — Step 1/5: Name'),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error) : null,
      h(TextInput, {
        placeholder: 'my-custom-sdd',
        onSubmit: async (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            dispatch({ type: 'SET_ERROR', value: 'SDD name is required.' });
            return;
          }
          // Slug validation
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
            dispatch({ type: 'SET_ERROR', value: 'Name must be a slug (lowercase letters, digits, hyphens).' });
            return;
          }
          // Check for duplicate
          try {
            const pathMod = await import('node:path');
            const fsMod = await import('node:fs');
            const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
            const catalogDir = pathMod.join(catalogsDir, trimmed);
            if (fsMod.existsSync(catalogDir)) {
              dispatch({ type: 'SET_ERROR', value: `SDD '${trimmed}' already exists.` });
              return;
            }
          } catch { /* allow through */ }
          dispatch({ type: 'SET_NAME', value: trimmed });
        },
      }),
    );
  }

  // Step 2: Description
  if (state.step === 2) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Create SDD "${state.name}" — Step 2/5: Description`),
      h(Text, { color: colors.subtext }, 'Press Enter to skip.'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'Optional description...',
        onSubmit: (value) => {
          dispatch({ type: 'SET_DESCRIPTION', value: value.trim() });
        },
      }),
    );
  }

  // Step 3: First phase name
  if (state.step === 3) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Create SDD "${state.name}" — Step 3/5: First Phase Name`),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error) : null,
      h(TextInput, {
        placeholder: 'main',
        onSubmit: (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            dispatch({ type: 'SET_ERROR', value: 'Phase name is required.' });
            return;
          }
          dispatch({ type: 'SET_PHASE_NAME', value: trimmed });
        },
      }),
    );
  }

  // Step 4: Phase intent
  if (state.step === 4) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Phase "${state.firstPhaseName}" — Step 4/5: Intent`),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'Describe what this phase does...',
        onSubmit: (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            dispatch({ type: 'SET_ERROR', value: 'Phase intent is required.' });
            return;
          }
          dispatch({ type: 'SET_PHASE_INTENT', value: trimmed });
        },
      }),
    );
  }

  // Step 5: Review + save
  if (state.step === 5) {
    const reviewLines = [
      `Name: ${state.name}`,
      state.description ? `Description: ${state.description}` : 'Description: (none)',
      `Phase: ${state.firstPhaseName}`,
      `  Intent: ${state.firstPhaseIntent}`,
    ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Create SDD — Step 5/5: Review'),
      h(Text, null, ''),
      h(Text, null, reviewLines.join('\n')),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error) : null,
      h(Menu, {
        items: [
          { label: 'Create SDD', value: 'save', description: 'Write the SDD to disk.' },
          { label: 'Go back', value: 'back', description: 'Edit the SDD details.' },
        ],
        onSelect: async (value) => {
          if (value === 'back') { dispatch({ type: 'BACK' }); return; }
          dispatch({ type: 'SET_SAVING' });
          try {
            const pathMod = await import('node:path');
            const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
            const { createCustomSdd, scaffoldPhaseContract } = await import('../../../core/sdd-catalog-io.js');
            const { materializeProjectSddAgents } = await import('../../../adapters/opencode/project-sdd-agent-materializer.js');
            const { stringifyYaml } = await import('../../../core/router.js');
            const fsMod = await import('node:fs');

            // Create the directory structure (generates main.md contract as a side-effect)
            createCustomSdd(catalogsDir, state.name, state.description);

            // Write the sdd.yaml with the first phase (user-provided)
            const sddContent = {
              name: state.name,
              version: 1,
              description: state.description || '',
              phases: {
                [state.firstPhaseName]: {
                  intent: state.firstPhaseIntent,
                },
              },
            };
            const sddYamlPath = pathMod.join(catalogsDir, state.name, 'sdd.yaml');
            fsMod.writeFileSync(sddYamlPath, stringifyYaml(sddContent), 'utf8');

            // Generate contract for the user's first phase (only if different from default 'main')
            scaffoldPhaseContract(catalogsDir, state.name, state.firstPhaseName, {
              intent: state.firstPhaseIntent,
              agents: 1,
              judge: false,
              radar: false,
            });

            // Materialize project-local sdd-* agents so the new SDD is immediately usable.
            materializeProjectSddAgents(configPath);

            if (setSelectedSdd) setSelectedSdd(state.name);
            router.pop(); // back to sdd-list
            router.push('sdd-detail');
          } catch (err) {
            dispatch({ type: 'SET_ERROR', value: err.message });
          }
        },
        setDescription,
      }),
    );
  }

  return h(Text, { color: colors.red }, 'Unknown wizard state');
}
