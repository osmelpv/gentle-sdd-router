import React, { useEffect, useReducer } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { ModelPicker } from '../components/model-picker.js';
import { SplitPanelPicker } from '../components/split-panel-picker.js';
import { PhaseComposer } from '../components/phase-composer.js';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { CANONICAL_PHASES, PHASE_METADATA } from '../../../core/phases.js';

const h = React.createElement;

const PROFILE_TYPES = [
  { value: 'mono', label: 'Single model for all phases', description: 'One model handles every phase. Simplest setup.' },
  { value: 'per-phase', label: 'One model per phase', description: 'Different model for each phase. More control.' },
  { value: 'multi-agent', label: 'Multi-agent (primary + judge)', description: 'Two models per phase. Judge validates primary.' },
  { value: 'multi-full', label: 'Multi-agent full (primary + judge + radar)', description: 'Three models per phase. Radar catches blind spots.' },
  { value: 'custom-compose', label: 'Custom composition per phase', description: 'Configure each phase individually with any combination of agents, judge, radar, and specialized roles.' },
];

const PHASE_DESCRIPTIONS = {
  orchestrator: {
    what: 'Coordinates the full SDD pipeline. Routes tasks, manages context, delegates to sub-agents.',
    advice: 'Best: high intelligence, 200K+ context. Claude Opus, GPT-5, Gemini Pro.',
  },
  explore: {
    what: 'Investigates the codebase and maps affected areas before any code changes.',
    advice: 'Best: large context (1M+), good reasoning. Gemini Pro, Claude Sonnet 4.6.',
  },
  propose: {
    what: 'Structures a formal proposal from exploration: scope, risk, approach.',
    advice: 'Best: clear structured writing. Claude Opus, GPT-5.',
  },
  spec: {
    what: 'Writes formal requirements and acceptance scenarios.',
    advice: 'Best: precise structured writing. Claude Opus, GPT-5.',
  },
  design: {
    what: 'Produces technical architecture, module design, and key decisions.',
    advice: 'Best: deep reasoning. Claude Opus, GPT-5, o3.',
  },
  tasks: {
    what: 'Breaks the design into a concrete, ordered task checklist.',
    advice: 'Best: structured output, fast. Claude Sonnet, GPT-4.1, Gemini Flash.',
  },
  apply: {
    what: 'Implements tasks: writes, edits, and creates files following spec and design.',
    advice: 'Best: strong coding, large context. Claude Sonnet, GPT-5, GPT-5 Codex.',
  },
  verify: {
    what: 'Validates implementation against the spec. Runs tests. Reports gaps.',
    advice: 'Best: critical reasoning, judge role. o3, Claude Opus, GPT-5.',
  },
  debug: {
    what: 'Diagnoses bugs found by verify. Full mini-SDD cycle internally.',
    advice: 'Best: strong debugging. GPT-5 Codex, Claude Sonnet, o3.',
  },
  archive: {
    what: 'Syncs delta specs to main docs and archives the completed change.',
    advice: 'Best: cheap and fast. Gemini Flash, Claude Haiku, GPT-4.1 Mini.',
  },
};

const initialState = {
  step: 1,           // 1=Name, 2=Type, 3=Models, 4=Fallbacks, 5=Review, 6=Save
  name: '',
  type: null,        // 'mono' | 'per-phase' | 'multi-agent' | 'multi-full'
  phases: {},        // { orchestrator: [{ target, role, kind, phase }], ... }
  phaseIndex: 0,     // which canonical phase we're configuring
  laneRole: 'primary', // which role we're picking for in current phase
  fallbackMode: null,  // 'yes' | 'no'
  fallbackRole: 'primary',
  fallbackPhaseIndex: 0,
  fallbackLaneIndex: 0,
  pickingFallback: false, // true after SET_FALLBACK to show "add another?" menu
  saving: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.value, error: null };
    case 'SET_TYPE': return { ...state, type: action.value, step: 3, phaseIndex: 0, laneRole: 'primary' };
    case 'SET_MODEL': {
      // Add the model to the current phase/role, advance
      const phaseName = CANONICAL_PHASES[state.phaseIndex];
      const lane = { target: action.value, role: state.laneRole, kind: 'lane', phase: phaseName };
      const currentLanes = state.phases[phaseName] || [];
      const updatedLanes = [...currentLanes, lane];
      const newPhases = { ...state.phases, [phaseName]: updatedLanes };

      // Figure out next step
      if (state.type === 'mono') {
        // Apply same model to all phases
        const allPhases = {};
        for (const p of CANONICAL_PHASES) {
          allPhases[p] = [{ target: action.value, role: 'primary', kind: 'lane', phase: p }];
        }
        return { ...state, phases: allPhases, step: 4 };
      }

      // Need next role for this phase?
      if (state.type === 'multi-agent' && state.laneRole === 'primary') {
        return { ...state, phases: newPhases, laneRole: 'judge' };
      }
      if (state.type === 'multi-full' && state.laneRole === 'primary') {
        return { ...state, phases: newPhases, laneRole: 'judge' };
      }
      if (state.type === 'multi-full' && state.laneRole === 'judge') {
        return { ...state, phases: newPhases, laneRole: 'radar' };
      }

      // Next phase
      const nextPhaseIndex = state.phaseIndex + 1;
      if (nextPhaseIndex >= CANONICAL_PHASES.length) {
        return { ...state, phases: newPhases, step: 4 };
      }
      return { ...state, phases: newPhases, phaseIndex: nextPhaseIndex, laneRole: 'primary' };
    }
    case 'SET_FALLBACK_MODE':
      if (action.value === 'no') {
        return { ...state, fallbackMode: 'no', step: 5 };
      }
      return { ...state, fallbackMode: 'yes', fallbackPhaseIndex: 0, fallbackLaneIndex: 0 };
    case 'SET_FALLBACK': {
      const phaseName = CANONICAL_PHASES[state.fallbackPhaseIndex];
      const lanes = [...(state.phases[phaseName] || [])];
      if (lanes[state.fallbackLaneIndex]) {
        const currentFallbacks = Array.isArray(lanes[state.fallbackLaneIndex].fallbacks)
          ? lanes[state.fallbackLaneIndex].fallbacks
          : lanes[state.fallbackLaneIndex].fallbacks
            ? [lanes[state.fallbackLaneIndex].fallbacks]
            : [];
        lanes[state.fallbackLaneIndex] = {
          ...lanes[state.fallbackLaneIndex],
          fallbacks: [...currentFallbacks, action.value],
        };
      }
      const newPhases = { ...state.phases, [phaseName]: lanes };
      return { ...state, phases: newPhases, pickingFallback: true };
    }
    case 'CONTINUE_FALLBACK': {
      // Move to next lane or phase
      const phaseName = CANONICAL_PHASES[state.fallbackPhaseIndex];
      const lanes = state.phases[phaseName] || [];
      const nextLaneIndex = state.fallbackLaneIndex + 1;
      if (nextLaneIndex < lanes.length) {
        return { ...state, fallbackLaneIndex: nextLaneIndex, pickingFallback: false };
      }
      const nextPhaseIndex = state.fallbackPhaseIndex + 1;
      if (nextPhaseIndex >= CANONICAL_PHASES.length) {
        return { ...state, step: 5, pickingFallback: false };
      }
      return { ...state, fallbackPhaseIndex: nextPhaseIndex, fallbackLaneIndex: 0, pickingFallback: false };
    }
    case 'PICK_MORE_FALLBACK': return { ...state, pickingFallback: false };
    case 'SET_ALL_PHASES': return { ...state, phases: action.value };
    case 'SET_LANE_ROLE': return { ...state, laneRole: action.value };
    case 'SET_FALLBACK_ROLE': return { ...state, fallbackRole: action.value };
    case 'SET_FALLBACK_MODE_RESET': return { ...state, fallbackMode: null, fallbackRole: 'primary' };
    case 'SKIP_FALLBACK': {
      // Skip this lane's fallback, advance same as CONTINUE_FALLBACK
      const phaseName = CANONICAL_PHASES[state.fallbackPhaseIndex];
      const lanes = state.phases[phaseName] || [];
      const nextLaneIndex = state.fallbackLaneIndex + 1;
      if (nextLaneIndex < lanes.length) {
        return { ...state, fallbackLaneIndex: nextLaneIndex, pickingFallback: false };
      }
      const nextPhaseIndex = state.fallbackPhaseIndex + 1;
      if (nextPhaseIndex >= CANONICAL_PHASES.length) {
        return { ...state, step: 5, pickingFallback: false };
      }
      return { ...state, fallbackPhaseIndex: nextPhaseIndex, fallbackLaneIndex: 0, pickingFallback: false };
    }
    case 'GO_TO_STEP': return { ...state, step: action.value };
    case 'SET_SAVING': return { ...state, saving: true };
    case 'SET_ERROR': return { ...state, error: action.value, saving: false };
    case 'BACK': {
      if (state.step === 1) return state; // can't go back from step 1
      if (state.step === 3 && state.phaseIndex === 0 && state.laneRole === 'primary') return { ...state, step: 2 };
      if (state.step === 3) {
        // Go back one step in model selection
        if (state.laneRole !== 'primary') {
          // Go back to primary of same phase
          const phaseName = CANONICAL_PHASES[state.phaseIndex];
          const lanes = (state.phases[phaseName] || []).slice(0, -1);
          const newPhases = { ...state.phases, [phaseName]: lanes.length > 0 ? lanes : undefined };
          // Clean up undefined
          for (const k of Object.keys(newPhases)) { if (!newPhases[k]) delete newPhases[k]; }
          const prevRole = state.laneRole === 'radar' ? 'judge' : 'primary';
          return { ...state, phases: newPhases, laneRole: prevRole };
        }
        // Go back to previous phase
        const prevIndex = state.phaseIndex - 1;
        if (prevIndex < 0) return { ...state, step: 2 };
        const prevPhaseName = CANONICAL_PHASES[prevIndex];
        const prevLanes = (state.phases[prevPhaseName] || []).slice(0, -1);
        const newPhases = { ...state.phases };
        delete newPhases[CANONICAL_PHASES[state.phaseIndex]];
        if (prevLanes.length > 0) newPhases[prevPhaseName] = prevLanes;
        else delete newPhases[prevPhaseName];
        return { ...state, phases: newPhases, phaseIndex: prevIndex, laneRole: 'primary' };
      }
      return { ...state, step: state.step - 1 };
    }
    default: return state;
  }
}

export function CreateProfileWizard({ configPath, router, setDescription, showResult, reloadConfig, catalogName }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pickerActive = state.step === 3 || (state.step === 4 && state.fallbackMode === 'yes');

  // Handle ESC for back navigation
  useInput((input, key) => {
    if (key.escape) {
      if (pickerActive) {
        return;
      }
      if (state.step === 1) {
        router.pop(); // Cancel wizard entirely
      } else {
        dispatch({ type: 'BACK' });
      }
    }
  });

  const routerDir = configPath ? configPath.replace(/\/router\.yaml$/, '') : null;

  useEffect(() => {
    if (!setDescription) return;
    if (state.step === 1) {
      setDescription('Enter a name for the new profile. Must be unique.');
      return;
    }
    if (state.step === 5) {
      setDescription('Review your profile configuration. Save if everything looks correct, or go back to adjust it.');
    }
  }, [state.step, setDescription]);


  // Step 1: Name
  if (state.step === 1) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Step 1/6 — Profile Name'),
      h(Text, null, ''),
      state.error ? h(Text, { color: colors.red }, state.error, '\n') : null,
      h(TextInput, {
        placeholder: 'my-custom-profile',
        onSubmit: (value) => {
          if (!value || !value.trim()) {
            dispatch({ type: 'SET_ERROR', value: 'Name is required.' });
            return;
          }
          dispatch({ type: 'SET_NAME', value: value.trim() });
          dispatch({ type: 'GO_TO_STEP', value: 2 });
        },
      }),
    );
  }

  // Step 2: Type
  if (state.step === 2) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Step 2/6 — Profile Type for "${state.name}"`),
      h(Text, null, ''),
      h(Menu, {
        items: PROFILE_TYPES,
        onSelect: (value) => dispatch({ type: 'SET_TYPE', value }),
        setDescription,
      }),
    );
  }

  // Step 3: Models
  if (state.step === 3) {
    if (state.type === 'custom-compose') {
      return h(PhaseComposer, {
        phases: state.phases,
        onPhasesChange: (newPhases) => dispatch({ type: 'SET_ALL_PHASES', value: newPhases }),
        onSave: () => dispatch({ type: 'GO_TO_STEP', value: 4 }),
        onCancel: () => dispatch({ type: 'BACK' }),
        setDescription,
        title: 'Step 3/6 — Custom Phase Composition',
      });
    }

    if (state.type === 'mono') {
      // Show a simple single ModelPicker for mono (not split panel)
      return h(Box, { flexDirection: 'column' },
        h(Text, { bold: true, color: colors.lavender }, 'Step 3/6 — Select Model (all phases)'),
        h(Text, { color: colors.subtext }, 'Pick one model — it will be used for all 10 phases.'),
        h(Text, null, ''),
        h(ModelPicker, {
          key: 'mono-model',
          onSelect: (modelId) => dispatch({ type: 'SET_MODEL', value: modelId }),
          onCancel: () => dispatch({ type: 'BACK' }),
          setDescription,
        }),
      );
    }

    // For per-phase, multi-agent, multi-full: use SplitPanelPicker
    const roleLabel = state.laneRole === 'primary' ? 'primary model' : `${state.laneRole}`;

    return h(SplitPanelPicker, {
      key: `step3-${state.laneRole}`,
      phases: state.phases,
      onPhasesChange: (newPhases) => dispatch({ type: 'SET_ALL_PHASES', value: newPhases }),
      onComplete: () => {
        // Check if we need more roles
        if (state.type === 'multi-agent' && state.laneRole === 'primary') {
          dispatch({ type: 'SET_LANE_ROLE', value: 'judge' });
        } else if (state.type === 'multi-full' && state.laneRole === 'primary') {
          dispatch({ type: 'SET_LANE_ROLE', value: 'judge' });
        } else if (state.type === 'multi-full' && state.laneRole === 'judge') {
          dispatch({ type: 'SET_LANE_ROLE', value: 'radar' });
        } else {
          dispatch({ type: 'GO_TO_STEP', value: 4 });
        }
      },
      onCancel: () => dispatch({ type: 'BACK' }),
      setDescription,
      profileType: state.type,
      currentRole: state.laneRole,
      phaseDescriptions: PHASE_DESCRIPTIONS,
      mode: 'models',
      title: `Step 3/6 — Select ${roleLabel} for each phase`,
    });
  }

  // Step 4: Fallbacks
  if (state.step === 4 && !state.fallbackMode) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Step 4/6 — Fallback Models'),
      h(Text, { color: colors.subtext }, 'Fallbacks are used when the primary model is unavailable.'),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Configure fallbacks for each model', value: 'yes', description: 'Pick a fallback model for each lane in every phase.' },
          { label: 'No fallbacks', value: 'no', description: 'Skip fallback configuration. Models have no backup.' },
        ],
        onSelect: (value) => dispatch({ type: 'SET_FALLBACK_MODE', value }),
        setDescription,
      }),
    );
  }

  // Mono fallback: single picker applied to all phases
  if (state.step === 4 && state.fallbackMode === 'yes' && state.type === 'mono') {
    const primaryTarget = state.phases.orchestrator?.[0]?.target ?? null;

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Step 4/6 — Fallback Model (all phases)'),
      h(Text, { color: colors.subtext }, 'Pick one fallback model — it will be applied to all 10 phases.'),
      h(Text, null, ''),
      h(ModelPicker, {
        key: 'mono-fallback',
        onSelect: (modelId) => {
          const newPhases = {};
          for (const p of CANONICAL_PHASES) {
            const lanes = (state.phases[p] || []).map(lane => ({ ...lane, fallbacks: [modelId] }));
            newPhases[p] = lanes;
          }
          dispatch({ type: 'SET_ALL_PHASES', value: newPhases });
          dispatch({ type: 'GO_TO_STEP', value: 5 });
        },
        onCancel: () => dispatch({ type: 'SET_FALLBACK_MODE_RESET' }),
        setDescription,
        excludeTarget: primaryTarget,
      }),
    );
  }

  // Non-mono fallback: SplitPanelPicker for per-phase fallback selection
  if (state.step === 4 && state.fallbackMode === 'yes' && state.type !== 'mono') {
    return h(SplitPanelPicker, {
      key: `step4-${state.fallbackRole}`,
      phases: state.phases,
      onPhasesChange: (newPhases) => dispatch({ type: 'SET_ALL_PHASES', value: newPhases }),
      onComplete: () => {
        // Check if there are more roles that need fallback configuration
        const rolesInProfile = new Set();
        for (const lanes of Object.values(state.phases)) {
          if (Array.isArray(lanes)) {
            for (const lane of lanes) {
              if (lane.role) rolesInProfile.add(lane.role);
            }
          }
        }
        const roleOrder = ['primary', 'judge', 'radar'];
        const currentIdx = roleOrder.indexOf(state.fallbackRole);
        for (let i = currentIdx + 1; i < roleOrder.length; i++) {
          if (rolesInProfile.has(roleOrder[i])) {
            dispatch({ type: 'SET_FALLBACK_ROLE', value: roleOrder[i] });
            return;
          }
        }
        // All roles covered
        dispatch({ type: 'GO_TO_STEP', value: 5 });
      },
      onCancel: () => dispatch({ type: 'SET_FALLBACK_MODE_RESET' }),
      setDescription,
      profileType: state.type,
      currentRole: state.fallbackRole,
      phaseDescriptions: PHASE_DESCRIPTIONS,
      mode: 'fallbacks',
      title: 'Step 4/6 — Select Fallback Models',
    });
  }

  // Step 5: Review
  if (state.step === 5) {
    const lines = [];
    lines.push(`Profile: ${state.name}`);
    lines.push(`Type: ${PROFILE_TYPES.find(t => t.value === state.type)?.label ?? state.type}`);
    lines.push('');

    for (const phaseName of CANONICAL_PHASES) {
      const lanes = state.phases[phaseName] || [];
      if (lanes.length === 0) continue;
      lines.push(`  ${phaseName}:`);
      for (const lane of lanes) {
        const fallbackList = Array.isArray(lane.fallbacks)
          ? lane.fallbacks
          : lane.fallbacks
            ? [lane.fallbacks]
            : [];
        const fb = fallbackList.length > 0 ? ` -> fallback: ${fallbackList.join(', ')}` : '';
        const roleTag = lanes.length > 1 ? `[${lane.role}] ` : '';
        lines.push(`    ${roleTag}${lane.target}${fb}`);
      }
    }

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Step 5/6 — Review'),
      h(Text, null, ''),
      h(Text, null, lines.join('\n')),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Save profile', value: 'save', description: 'Write this profile to disk.' },
          { label: 'Go back', value: 'back', description: 'Return to edit.' },
        ],
        onSelect: async (value) => {
          if (value === 'back') { dispatch({ type: 'BACK' }); return; }
          dispatch({ type: 'SET_SAVING' });
          try {
            const mod = await import('../../../router-config.js');
            mod.createProfile(state.name, routerDir, catalogName ? { catalog: catalogName } : {});
            mod.updateProfile(state.name, state.phases, routerDir);
            await reloadConfig();
            router.pop();
            showResult(`Profile '${state.name}' created successfully!\n\n${lines.join('\n')}`);
          } catch (err) {
            dispatch({ type: 'SET_ERROR', value: err.message });
            dispatch({ type: 'GO_TO_STEP', value: 5 });
          }
        },
        setDescription,
      }),
    );
  }

  // Step 6: Saving
  if (state.step === 6 || state.saving) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Step 6/6 — Saving...'),
      h(Text, { color: colors.green }, 'Writing profile to disk...'),
    );
  }

  return h(Text, { color: colors.red }, 'Unknown wizard state');
}
