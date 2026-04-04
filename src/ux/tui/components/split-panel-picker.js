import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ModelPicker } from './model-picker.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { CANONICAL_PHASES, PHASE_METADATA } from '../../../core/phases.js';

const h = React.createElement;

export function SplitPanelPicker({
  phases,
  onPhasesChange,
  onComplete,
  onCancel,
  setDescription,
  profileType,
  currentRole,
  phaseDescriptions,
  excludeTarget,
  excludeTargets,
  mode,
  title,
}) {
  const [activePanel, setActivePanel] = useState('left'); // 'left' | 'right'
  const [phaseCursor, setPhaseCursor] = useState(0);
  const [pickerKey, setPickerKey] = useState(0); // force re-mount ModelPicker on phase change

  const activePhaseName = CANONICAL_PHASES[phaseCursor];
  const phaseInfo = phaseDescriptions?.[activePhaseName];

  // Count how many phases are assigned
  const assignedCount = CANONICAL_PHASES.filter(p => {
    const lanes = phases[p] || [];
    if (mode === 'fallbacks') {
      const lane = lanes.find(l => l.role === currentRole);
      return lane?.fallbacks && (Array.isArray(lane.fallbacks) ? lane.fallbacks.length > 0 : true);
    }
    return lanes.some(l => l.role === currentRole && l.target);
  }).length;

  // Get the current phase's primary target for fallback exclusion
  const currentPrimaryTarget = (() => {
    if (mode !== 'fallbacks') return excludeTarget || null;
    const lanes = phases[activePhaseName] || [];
    const primary = lanes.find(l => l.role === 'primary');
    return primary?.target || excludeTarget || null;
  })();

  // Get already-selected fallbacks for the current phase
  const currentExcludeTargets = (() => {
    if (mode !== 'fallbacks') return excludeTargets || [];
    const lanes = phases[activePhaseName] || [];
    const lane = lanes.find(l => l.role === currentRole);
    if (!lane) return excludeTargets || [];
    const fb = lane.fallbacks;
    if (!fb) return excludeTargets || [];
    return Array.isArray(fb) ? fb.map(f => f) : [fb];
  })();

  // Update footer description based on active phase
  useEffect(() => {
    if (activePanel === 'left' && phaseInfo && setDescription) {
      setDescription(`${phaseInfo.what} ${phaseInfo.advice}`);
    }
  }, [phaseCursor, activePanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle input on the LEFT panel
  useInput((input, key) => {
    if (activePanel !== 'left') return;

    if (key.escape) {
      if (onCancel) onCancel();
      return;
    }

    if (key.leftArrow && activePanel === 'left') {
      if (onCancel) onCancel();
      return;
    }

    if (key.upArrow || input === 'k') {
      setPhaseCursor(prev => (prev > 0 ? prev - 1 : CANONICAL_PHASES.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setPhaseCursor(prev => (prev < CANONICAL_PHASES.length - 1 ? prev + 1 : 0));
    }
    if (key.return || key.rightArrow) {
      setActivePanel('right');
      setPickerKey(prev => prev + 1); // force fresh picker
    }

    // 'c' or 'd' to mark complete (when all phases have assignments)
    if (input === 'c' || input === 'd') {
      if (assignedCount >= CANONICAL_PHASES.length) {
        if (onComplete) onComplete();
      }
    }
  });

  const handleModelSelect = (modelId) => {
    const phaseName = CANONICAL_PHASES[phaseCursor];

    // Don't assign non-primary roles to alwaysMono phases
    if (currentRole !== 'primary' && currentRole !== 'agent' && PHASE_METADATA[phaseName]?.alwaysMono) {
      return; // silently skip
    }

    if (mode === 'fallbacks') {
      // Add fallback to the lane matching currentRole
      // Treat undefined role as 'primary'
      const effectiveRole = currentRole === 'agent' ? 'primary' : currentRole;
      const lanes = [...(phases[phaseName] || [])];
      const laneIdx = lanes.findIndex(l => (l.role ?? 'primary') === effectiveRole);
      if (laneIdx >= 0) {
        const lane = lanes[laneIdx];
        const currentFallbacks = Array.isArray(lane.fallbacks) ? lane.fallbacks : (lane.fallbacks ? [lane.fallbacks] : []);
        lanes[laneIdx] = { ...lane, fallbacks: [...currentFallbacks, modelId] };
      }
      const newPhases = { ...phases, [phaseName]: lanes };
      onPhasesChange(newPhases);
    } else {
      // Add or replace the lane for currentRole
      const effectiveRole = currentRole === 'agent' ? 'primary' : currentRole;
      const lanes = [...(phases[phaseName] || [])];
      const existingIdx = lanes.findIndex(l => (l.role ?? 'primary') === effectiveRole);
      const newLane = { target: modelId, role: currentRole, kind: 'lane', phase: phaseName };
      if (existingIdx >= 0) {
        lanes[existingIdx] = newLane;
      } else {
        lanes.push(newLane);
      }
      const newPhases = { ...phases, [phaseName]: lanes };
      onPhasesChange(newPhases);
    }

    // Return focus to left panel and advance to next unassigned phase
    setActivePanel('left');
    const nextUnassigned = findNextUnassigned(phaseCursor, phases, currentRole, mode);
    if (nextUnassigned !== null) {
      setPhaseCursor(nextUnassigned);
    } else {
      // All assigned — stay on current but show "all done" in description
      if (setDescription) setDescription('All phases assigned. Press "c" to continue or navigate to re-assign.');
    }
  };

  const handlePickerCancel = () => {
    setActivePanel('left');
  };

  // Render
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, title || 'Select Models'),
    h(Text, { color: colors.subtext },
      `${assignedCount}/${CANONICAL_PHASES.length} phases assigned. `,
      assignedCount >= CANONICAL_PHASES.length
        ? h(Text, { color: colors.green }, 'Press "c" to continue.')
        : h(Text, { color: colors.overlay }, 'Select a phase and pick a model.'),
    ),
    h(Text, null, ''),
    h(Box, { flexDirection: 'row' },
      // LEFT PANEL: Phase list
      h(Box, {
        flexDirection: 'column',
        width: '40%',
        borderStyle: 'single',
        borderColor: activePanel === 'left' ? colors.lavender : colors.overlay,
        paddingX: 1,
      },
        ...CANONICAL_PHASES.map((phaseName, idx) => {
          const lanes = phases[phaseName] || [];
          const lane = lanes.find(l => l.role === currentRole);
          const isActive = idx === phaseCursor;
          const prefix = isActive ? cursorChar : '  ';

          let modelLabel = '\u2014'; // em dash
          if (lane?.target) {
            const parts = lane.target.split('/');
            modelLabel = parts.length > 1 ? parts[1] : lane.target;
          }

          // For fallback mode, show fallback count
          let suffix = '';
          if (mode === 'fallbacks' && lane) {
            const fb = lane.fallbacks;
            const count = Array.isArray(fb) ? fb.length : (fb ? 1 : 0);
            if (count > 0) suffix = ` [${count} fb]`;
          }

          const isMonoPhase = PHASE_METADATA[phaseName]?.alwaysMono;
          const isSkipped = isMonoPhase && currentRole !== 'primary' && currentRole !== 'agent';
          const color = isActive
            ? (activePanel === 'left' ? colors.lavender : colors.peach)
            : isSkipped ? colors.overlay
            : lane?.target ? colors.green : colors.overlay;

          return h(Text, { key: phaseName, color, bold: isActive },
            prefix, phaseName.padEnd(14), modelLabel, suffix,
          );
        }),
      ),
      // Spacer
      h(Box, { width: 1 }),
      // RIGHT PANEL: ModelPicker or phase info
      h(Box, {
        flexDirection: 'column',
        width: '58%',
        borderStyle: 'single',
        borderColor: activePanel === 'right' ? colors.lavender : colors.overlay,
        paddingX: 1,
      },
        activePanel === 'right'
          ? h(ModelPicker, {
              key: `picker-${phaseCursor}-${currentRole}-${pickerKey}`,
              onSelect: handleModelSelect,
              onCancel: handlePickerCancel,
              setDescription,
              excludeTarget: currentPrimaryTarget,
              excludeTargets: currentExcludeTargets,
            })
          : h(Box, { flexDirection: 'column' },
              h(Text, { bold: true, color: colors.peach }, activePhaseName),
              h(Text, null, ''),
              phaseInfo ? h(Text, { color: colors.text, wrap: 'wrap' }, phaseInfo.what) : null,
              phaseInfo ? h(Text, { color: colors.blue, wrap: 'wrap' }, phaseInfo.advice) : null,
              h(Text, null, ''),
              h(Text, { color: colors.subtext }, 'Press Enter or \u2192 to pick a model.'),
            ),
      ),
    ),
  );
}

function findNextUnassigned(currentIdx, phases, role, mode) {
  // Start from next phase and wrap around
  for (let i = 1; i <= CANONICAL_PHASES.length; i++) {
    const idx = (currentIdx + i) % CANONICAL_PHASES.length;
    const phaseName = CANONICAL_PHASES[idx];
    // Skip alwaysMono phases for non-primary roles
    if (role !== 'primary' && role !== 'agent' && PHASE_METADATA[phaseName]?.alwaysMono) {
      continue;
    }
    const lanes = phases[phaseName] || [];
    const lane = lanes.find(l => l.role === role);
    if (mode === 'fallbacks') {
      // For fallbacks, "unassigned" means no fallback set yet
      if (!lane?.fallbacks || (Array.isArray(lane.fallbacks) && lane.fallbacks.length === 0)) {
        return idx;
      }
    } else {
      if (!lane?.target) {
        return idx;
      }
    }
  }
  return null; // all assigned
}
