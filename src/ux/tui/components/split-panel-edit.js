import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ModelPicker } from './model-picker.js';
import { Menu } from './menu.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { CANONICAL_PHASES } from '../../../core/phases.js';

const h = React.createElement;
const ROLES = ['primary', 'judge', 'radar', 'secondary'];

export function SplitPanelEdit({ phases, onPhasesChange, onSave, onCancel, setDescription, hasChanges }) {
  const [activePanel, setActivePanel] = useState('left'); // 'left' | 'right'
  const [phaseCursor, setPhaseCursor] = useState(0);
  const [rightView, setRightView] = useState('lanes'); // 'lanes' | 'edit-lane' | 'pick-model' | 'pick-fallback' | 'pick-role'
  const [selectedLaneIdx, setSelectedLaneIdx] = useState(null);
  const [pendingLane, setPendingLane] = useState(null);

  const activePhaseName = CANONICAL_PHASES[phaseCursor];
  const phaseLanes = phases[activePhaseName] || [];

  // Reset right panel when phase changes
  useEffect(() => {
    setRightView('lanes');
    setSelectedLaneIdx(null);
    setPendingLane(null);
  }, [phaseCursor]);

  // Left panel navigation
  useInput((input, key) => {
    if (activePanel !== 'left') return;

    if (key.escape) {
      if (onCancel) onCancel();
      return;
    }
    if (key.leftArrow) {
      if (onCancel) onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setPhaseCursor(prev => (prev > 0 ? prev - 1 : CANONICAL_PHASES.length + (hasChanges ? 0 : -1)));
    }
    if (key.downArrow || input === 'j') {
      setPhaseCursor(prev => (prev < CANONICAL_PHASES.length + (hasChanges ? 0 : -1) ? prev + 1 : 0));
    }
    if (key.return || key.rightArrow) {
      if (phaseCursor === CANONICAL_PHASES.length && hasChanges) {
        // Save button
        if (onSave) onSave();
        return;
      }
      setActivePanel('right');
      setRightView('lanes');
    }
  });

  // Right panel ESC / left arrow
  useInput((input, key) => {
    if (activePanel !== 'right') return;
    if (key.escape) {
      if (rightView === 'pick-model' || rightView === 'pick-fallback') {
        // ModelPicker handles its own ESC
        return;
      }
      if (rightView === 'edit-lane') {
        setRightView('lanes');
        return;
      }
      if (rightView === 'pick-role') {
        setPendingLane(null);
        setRightView('lanes');
        return;
      }
      // From lanes view, go back to left panel
      setActivePanel('left');
    }
    if (key.leftArrow) {
      if (rightView === 'pick-model' || rightView === 'pick-fallback') return; // ModelPicker handles it
      setActivePanel('left');
    }
  });

  // Helper: update a lane
  const updateLane = (phaseKey, laneIdx, updates) => {
    const lanes = [...(phases[phaseKey] || [])];
    lanes[laneIdx] = { ...lanes[laneIdx], ...updates };
    onPhasesChange({ ...phases, [phaseKey]: lanes });
  };

  // RENDER LEFT PANEL
  const leftItems = CANONICAL_PHASES.map((pName, idx) => {
    const lanes = phases[pName] || [];
    const primary = lanes.find(l => l.role === 'primary' || !l.role);
    const modelLabel = primary ? primary.target?.split('/').pop() || primary.target : '—';
    const multi = lanes.length > 1 ? ` +${lanes.length - 1}` : '';
    const isActive = idx === phaseCursor;
    const prefix = isActive ? cursorChar : '  ';
    const color = isActive
      ? (activePanel === 'left' ? colors.lavender : colors.peach)
      : primary?.target ? colors.green : colors.overlay;
    return h(Text, { key: pName, color, bold: isActive },
      prefix, pName.padEnd(14), modelLabel, multi,
    );
  });

  // Add save button to left panel if changes exist
  if (hasChanges) {
    const isSaveActive = phaseCursor === CANONICAL_PHASES.length;
    leftItems.push(h(Text, null, ''));
    leftItems.push(h(Text, {
      key: '__save__',
      color: isSaveActive ? colors.green : colors.peach,
      bold: isSaveActive,
    }, isSaveActive ? cursorChar : '  ', '--- Save changes ---'));
  }

  // RENDER RIGHT PANEL
  let rightContent;

  if (activePanel !== 'right') {
    // Show phase info when not editing
    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach }, activePhaseName),
      h(Text, null, ''),
      h(Text, { color: colors.subtext }, `${phaseLanes.length} lane(s) configured.`),
      h(Text, null, ''),
      h(Text, { color: colors.overlay }, 'Press Enter or \u2192 to edit lanes.'),
    );
  } else if (rightView === 'lanes') {
    const laneItems = phaseLanes.map((lane, idx) => {
      const fb = lane.fallbacks
        ? ` \u2192 ${Array.isArray(lane.fallbacks) ? lane.fallbacks.length + ' fb' : '1 fb'}`
        : '';
      return {
        label: `[${lane.role || 'primary'}] ${lane.target || '(none)'}${fb}`,
        value: `lane-${idx}`,
        description: `Edit ${lane.role || 'primary'} lane: ${lane.target || '(none)'}`,
      };
    });
    laneItems.push({ label: '+ Add lane', value: '__add__', description: 'Add a new model lane to this phase.' });
    if (phaseLanes.length > 0) {
      laneItems.push({ label: '- Remove last lane', value: '__remove__', description: 'Remove the last lane.' });
    }

    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach }, `Lanes: ${activePhaseName}`),
      h(Text, null, ''),
      h(Menu, {
        items: laneItems,
        onSelect: (value) => {
          if (value === '__back__') { setActivePanel('left'); return; }
          if (value === '__add__') {
            setPendingLane({ target: null, role: 'primary', kind: 'lane', phase: activePhaseName });
            setRightView('pick-role');
            return;
          }
          if (value === '__remove__') {
            const newLanes = phaseLanes.slice(0, -1);
            const newPhases = { ...phases };
            if (newLanes.length === 0) delete newPhases[activePhaseName];
            else newPhases[activePhaseName] = newLanes;
            onPhasesChange(newPhases);
            return;
          }
          const idx = parseInt(value.replace('lane-', ''), 10);
          setSelectedLaneIdx(idx);
          setRightView('edit-lane');
        },
        setDescription,
        showBack: true,
      }),
    );
  } else if (rightView === 'edit-lane') {
    const lane = phaseLanes[selectedLaneIdx];
    if (!lane) {
      rightContent = h(Text, { color: colors.subtext }, 'No lane selected.');
    } else {
      const editItems = [
        { label: `Model: ${lane.target || '(none)'}`, value: 'model', description: 'Change the model for this lane.' },
        { label: `Role: ${lane.role || 'primary'}`, value: 'role', description: 'Change the role.' },
        {
          label: lane.fallbacks
            ? `Fallbacks: ${Array.isArray(lane.fallbacks) ? lane.fallbacks.join(', ') : lane.fallbacks}`
            : 'Add fallback',
          value: 'fallback',
          description: 'Set or add a fallback model.',
        },
        ...(lane.fallbacks ? [{ label: 'Clear fallbacks', value: 'clear-fb', description: 'Remove all fallback models.' }] : []),
      ];
      rightContent = h(Box, { flexDirection: 'column' },
        h(Text, { bold: true, color: colors.peach }, `Edit: [${lane.role}] ${lane.target}`),
        h(Text, null, ''),
        h(Menu, {
          items: editItems,
          onSelect: (value) => {
            if (value === '__back__') { setRightView('lanes'); return; }
            if (value === 'model') { setRightView('pick-model'); return; }
            if (value === 'role') { setRightView('pick-role'); return; }
            if (value === 'fallback') { setRightView('pick-fallback'); return; }
            if (value === 'clear-fb') {
              const lanes = [...phaseLanes];
              const updated = { ...lanes[selectedLaneIdx] };
              delete updated.fallbacks;
              lanes[selectedLaneIdx] = updated;
              onPhasesChange({ ...phases, [activePhaseName]: lanes });
              setRightView('lanes');
            }
          },
          setDescription,
          showBack: true,
        }),
      );
    }
  } else if (rightView === 'pick-model') {
    rightContent = h(ModelPicker, {
      key: `edit-model-${activePhaseName}-${selectedLaneIdx ?? 'new'}`,
      onSelect: (modelId) => {
        if (pendingLane) {
          const newLane = { ...pendingLane, target: modelId };
          const newLanes = [...phaseLanes, newLane];
          onPhasesChange({ ...phases, [activePhaseName]: newLanes });
          setPendingLane(null);
        } else {
          updateLane(activePhaseName, selectedLaneIdx, { target: modelId });
        }
        setRightView('lanes');
      },
      onCancel: () => {
        setPendingLane(null);
        setRightView(pendingLane ? 'lanes' : 'edit-lane');
      },
      setDescription,
    });
  } else if (rightView === 'pick-fallback') {
    const lane = phaseLanes[selectedLaneIdx];
    const currentFb = Array.isArray(lane?.fallbacks) ? lane.fallbacks : (lane?.fallbacks ? [lane.fallbacks] : []);
    rightContent = h(ModelPicker, {
      key: `edit-fb-${activePhaseName}-${selectedLaneIdx}-${currentFb.length}`,
      onSelect: (modelId) => {
        const lanes = [...phaseLanes];
        const updated = { ...lanes[selectedLaneIdx] };
        const fb = Array.isArray(updated.fallbacks) ? updated.fallbacks : (updated.fallbacks ? [updated.fallbacks] : []);
        updated.fallbacks = [...fb, modelId];
        lanes[selectedLaneIdx] = updated;
        onPhasesChange({ ...phases, [activePhaseName]: lanes });
        setRightView('edit-lane');
      },
      onCancel: () => setRightView('edit-lane'),
      setDescription,
      excludeTarget: lane?.target,
      excludeTargets: currentFb,
    });
  } else if (rightView === 'pick-role') {
    const roleItems = ROLES.map(r => ({
      label: r.charAt(0).toUpperCase() + r.slice(1),
      value: r,
      description: r === 'primary' ? 'Main model for this phase.'
        : r === 'judge' ? 'Cross-references and validates.'
        : r === 'radar' ? 'Scans for blind spots.'
        : 'Additional redundancy.',
    }));
    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach }, 'Select role:'),
      h(Text, null, ''),
      h(Menu, {
        items: roleItems,
        onSelect: (role) => {
          if (pendingLane) {
            setPendingLane(prev => ({ ...prev, role }));
            setRightView('pick-model');
          } else {
            updateLane(activePhaseName, selectedLaneIdx, { role });
            setRightView('edit-lane');
          }
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Box, { flexDirection: 'row' },
      h(Box, { flexDirection: 'column', width: '40%', borderStyle: 'single', borderColor: activePanel === 'left' ? colors.lavender : colors.overlay, paddingX: 1 },
        ...leftItems,
      ),
      h(Box, { width: 1 }),
      h(Box, { flexDirection: 'column', width: '58%', borderStyle: 'single', borderColor: activePanel === 'right' ? colors.lavender : colors.overlay, paddingX: 1 },
        rightContent,
      ),
    ),
  );
}
