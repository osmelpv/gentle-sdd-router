import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ModelPicker } from './model-picker.js';
import { Menu } from './menu.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { CANONICAL_PHASES, PHASE_METADATA } from '../../../core/phases.js';

const h = React.createElement;

const ROLE_COLORS = {
  agent: colors.green,
  judge: colors.lavender,
  radar: colors.blue,
  tester: colors.peach,
  'risk-detector': colors.mauve,
  'security-auditor': colors.red,
  investigator: colors.subtext,
};

const EXEC_ICONS = {
  parallel: '\u2225',     // ∥
  sequential: '\u2500',   // ─
};

function getExecIcon(phase) {
  const meta = PHASE_METADATA[phase];
  if (meta?.trigger === 'on-failure') return '\u26A1'; // ⚡
  return EXEC_ICONS[meta?.defaultExecution] || '\u2500';
}

function getCompositionBadge(lanes) {
  if (!lanes || lanes.length === 0) return '(empty)';
  const counts = {};
  for (const lane of lanes) {
    const role = lane.role || 'agent';
    counts[role] = (counts[role] || 0) + 1;
  }
  const parts = [];
  if (counts.agent) parts.push(counts.agent > 1 ? `${counts.agent}A` : 'A');
  if (counts.judge) parts.push('J');
  if (counts.radar) parts.push('R');
  for (const [role, count] of Object.entries(counts)) {
    if (!['agent', 'judge', 'radar'].includes(role)) {
      parts.push(role.charAt(0).toUpperCase());
    }
  }
  return parts.join('+');
}

export function PhaseComposer({ phases, onPhasesChange, onSave, onCancel, setDescription, title }) {
  const [activePanel, setActivePanel] = useState('left');
  const [phaseCursor, setPhaseCursor] = useState(0);
  const [rightView, setRightView] = useState('detail'); // 'detail' | 'model-picker' | 'add-role'
  const [slotCursor, setSlotCursor] = useState(0);
  const [editingSlotIdx, setEditingSlotIdx] = useState(null);
  const [pendingRole, setPendingRole] = useState(null);
  const [pickerKey, setPickerKey] = useState(0);

  const activePhaseName = phaseCursor < CANONICAL_PHASES.length ? CANONICAL_PHASES[phaseCursor] : null;
  const activeMeta = activePhaseName ? PHASE_METADATA[activePhaseName] : null;
  const phaseLanes = activePhaseName ? (phases[activePhaseName] || []) : [];
  const isMono = activeMeta?.alwaysMono === true;

  // Total item count for left panel (10 phases + save button)
  const leftItemCount = CANONICAL_PHASES.length + 1;

  // Count assigned phases
  const assignedCount = CANONICAL_PHASES.filter(p => (phases[p] || []).length > 0).length;

  // Reset right panel state when phase changes
  useEffect(() => {
    setRightView('detail');
    setSlotCursor(0);
    setEditingSlotIdx(null);
    setPendingRole(null);
  }, [phaseCursor]);

  // Update footer description
  useEffect(() => {
    if (!setDescription) return;
    if (activePanel === 'left' && activeMeta) {
      setDescription(activeMeta.description);
    }
    if (activePanel === 'right' && rightView === 'detail' && phaseLanes[slotCursor]) {
      const lane = phaseLanes[slotCursor];
      setDescription(`[${lane.role || 'agent'}] ${lane.target || '(empty)'} — Enter to change model, x to remove (optional only)`);
    }
  }, [activePanel, phaseCursor, rightView, slotCursor]);

  // LEFT panel input
  useInput((input, key) => {
    if (activePanel !== 'left') return;

    if (key.escape || key.leftArrow) {
      if (onCancel) onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setPhaseCursor(prev => (prev > 0 ? prev - 1 : leftItemCount - 1));
    }
    if (key.downArrow || input === 'j') {
      setPhaseCursor(prev => (prev < leftItemCount - 1 ? prev + 1 : 0));
    }
    if (key.return || key.rightArrow) {
      if (phaseCursor === CANONICAL_PHASES.length) {
        // Save button
        if (onSave) onSave();
        return;
      }
      setActivePanel('right');
      setRightView('detail');
      setSlotCursor(0);
    }
  });

  // RIGHT panel input (detail view only — picker has its own)
  useInput((input, key) => {
    if (activePanel !== 'right') return;
    if (rightView === 'model-picker') return; // ModelPicker handles its own input

    if (key.escape || key.leftArrow) {
      if (rightView === 'add-role') {
        setRightView('detail');
        return;
      }
      setActivePanel('left');
      return;
    }

    if (rightView === 'detail') {
      const totalSlots = phaseLanes.length + (isMono ? 0 : 1); // +1 for "Add role" if not mono
      if (key.upArrow || input === 'k') {
        setSlotCursor(prev => (prev > 0 ? prev - 1 : Math.max(totalSlots - 1, 0)));
      }
      if (key.downArrow || input === 'j') {
        setSlotCursor(prev => (prev < totalSlots - 1 ? prev + 1 : 0));
      }

      if (key.return || key.rightArrow) {
        if (slotCursor < phaseLanes.length) {
          // Edit this slot's model
          setEditingSlotIdx(slotCursor);
          setRightView('model-picker');
          setPickerKey(prev => prev + 1);
        } else if (!isMono) {
          // "Add role" item
          setRightView('add-role');
        }
      }

      // x key to remove optional slot
      if (input === 'x' && slotCursor < phaseLanes.length) {
        const lane = phaseLanes[slotCursor];
        const role = lane.role || 'agent';
        const fixedRoles = activeMeta?.fixedRoles || ['agent'];
        // Count how many of this role are fixed
        const fixedCount = fixedRoles.filter(r => r === role).length;
        const currentCount = phaseLanes.filter(l => (l.role || 'agent') === role).length;
        if (currentCount > fixedCount) {
          // Can remove — this is an optional instance
          const newLanes = [...phaseLanes];
          newLanes.splice(slotCursor, 1);
          const newPhases = { ...phases };
          if (newLanes.length === 0) delete newPhases[activePhaseName];
          else newPhases[activePhaseName] = newLanes;
          onPhasesChange(newPhases);
          setSlotCursor(prev => Math.min(prev, Math.max(newLanes.length - 1, 0)));
        }
      }
    }
  });

  // Handle model selection from picker
  const handleModelSelect = (modelId) => {
    if (pendingRole) {
      // Adding new role
      const newLane = { target: modelId, role: pendingRole, kind: 'lane', phase: activePhaseName };
      const newLanes = [...phaseLanes, newLane];
      onPhasesChange({ ...phases, [activePhaseName]: newLanes });
      setPendingRole(null);
    } else if (editingSlotIdx !== null) {
      // Editing existing slot
      const newLanes = [...phaseLanes];
      newLanes[editingSlotIdx] = { ...newLanes[editingSlotIdx], target: modelId };
      onPhasesChange({ ...phases, [activePhaseName]: newLanes });
    }
    setEditingSlotIdx(null);
    setRightView('detail');
  };

  const handlePickerCancel = () => {
    setPendingRole(null);
    setEditingSlotIdx(null);
    setRightView('detail');
  };

  // === RENDER LEFT PANEL ===
  const leftItems = CANONICAL_PHASES.map((pName, idx) => {
    const meta = PHASE_METADATA[pName];
    const lanes = phases[pName] || [];
    const isActive = idx === phaseCursor;
    const prefix = isActive ? cursorChar : '  ';
    const execIcon = getExecIcon(pName);
    const badge = getCompositionBadge(lanes);
    const monoLabel = meta?.alwaysMono ? ' mono' : '';
    const color = isActive
      ? (activePanel === 'left' ? colors.lavender : colors.peach)
      : lanes.length > 0 ? colors.green : colors.overlay;

    return h(Text, { key: pName, color, bold: isActive },
      prefix, pName.padEnd(14), execIcon, '  ', badge, monoLabel,
    );
  });

  // Save button
  const isSaveActive = phaseCursor === CANONICAL_PHASES.length;
  leftItems.push(h(Text, { key: '__spacer__' }, ''));
  leftItems.push(h(Text, {
    key: '__save__',
    color: isSaveActive ? (activePanel === 'left' ? colors.green : colors.peach) : colors.overlay,
    bold: isSaveActive,
  }, isSaveActive ? cursorChar : '  ', `Save (${assignedCount}/${CANONICAL_PHASES.length} phases)`));

  // === RENDER RIGHT PANEL ===
  let rightContent;

  if (activePanel !== 'right' || !activePhaseName) {
    // Show phase info
    rightContent = h(Box, { flexDirection: 'column' },
      activeMeta ? h(Text, { bold: true, color: colors.peach }, activePhaseName) : null,
      h(Text, { key: 'spacer1' }, ''),
      activeMeta ? h(Text, { color: colors.text, wrap: 'wrap' }, activeMeta.description) : null,
      h(Text, { key: 'spacer2' }, ''),
      activeMeta ? h(Text, { color: colors.subtext }, `Fixed: ${(activeMeta.fixedRoles || []).join(', ')}`) : null,
      activeMeta && !isMono ? h(Text, { color: colors.subtext }, `Optional: ${(activeMeta.optionalRoles || []).join(', ')}`) : null,
      isMono ? h(Text, { color: colors.overlay }, 'This phase is always single-agent.') : null,
      h(Text, { key: 'spacer3' }, ''),
      h(Text, { color: colors.overlay }, 'Press Enter or \u2192 to configure.'),
    );
  } else if (rightView === 'detail') {
    // Slot list
    const slotItems = phaseLanes.map((lane, idx) => {
      const role = lane.role || 'agent';
      const roleColor = ROLE_COLORS[role] || colors.text;
      const isActive = idx === slotCursor;
      const prefix = isActive ? cursorChar : '  ';
      const model = lane.target ? lane.target.split('/').pop() : '(empty)';
      const fixedRoles = activeMeta?.fixedRoles || ['agent'];
      const fixedCount = fixedRoles.filter(r => r === role).length;
      const currentCount = phaseLanes.filter(l => (l.role || 'agent') === role).length;
      const isRemovable = currentCount > fixedCount;
      const removeHint = isRemovable ? ' [x:rm]' : '';

      return h(Text, { key: `slot-${idx}`, color: isActive ? colors.lavender : colors.text, bold: isActive },
        prefix, h(Text, { color: roleColor }, role.padEnd(18)),
        model, removeHint,
      );
    });

    // Add role button (if not mono and there are available optional roles)
    if (!isMono) {
      const usedRoles = new Set(phaseLanes.map(l => l.role || 'agent'));
      const available = (activeMeta?.optionalRoles || []).filter(r => !usedRoles.has(r));
      const addActive = slotCursor === phaseLanes.length;
      if (available.length > 0) {
        slotItems.push(h(Text, {
          key: '__add__',
          color: addActive ? colors.lavender : colors.blue,
          bold: addActive,
        }, addActive ? cursorChar : '  ', `[a] Add role (${available.join(', ')})`));
      }
    }

    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach }, activePhaseName, '  ',
        h(Text, { color: colors.overlay }, isMono ? 'mono' : PHASE_METADATA[activePhaseName]?.defaultExecution),
      ),
      activeMeta?.trigger === 'on-failure' ? h(Text, { color: colors.red }, 'Only runs if verify fails.') : null,
      h(Text, { key: 'spacer' }, ''),
      ...slotItems,
    );
  } else if (rightView === 'model-picker') {
    rightContent = h(ModelPicker, {
      key: `composer-pick-${activePhaseName}-${editingSlotIdx ?? 'new'}-${pickerKey}`,
      onSelect: handleModelSelect,
      onCancel: handlePickerCancel,
      setDescription,
    });
  } else if (rightView === 'add-role') {
    const usedRoles = new Set(phaseLanes.map(l => l.role || 'agent'));
    const available = (activeMeta?.optionalRoles || []).filter(r => !usedRoles.has(r));
    const roleDescriptions = {
      judge: 'Debate director — synthesizes agent responses anonymously.',
      radar: 'Blind-spot scanner — finds what agents miss.',
      tester: 'TDD test writer — tests that fail first.',
      'risk-detector': 'Scans for regressions, orphaned code, incompatibilities.',
      'security-auditor': 'Detects injection, auth bypass, data exposure.',
      investigator: 'External research — APIs, prior art, industry patterns.',
    };

    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach }, 'Add optional role to ', activePhaseName),
      h(Text, { key: 'spacer' }, ''),
      h(Menu, {
        items: available.map(r => ({
          label: r,
          value: r,
          description: roleDescriptions[r] || `Add ${r} to this phase.`,
        })),
        onSelect: (role) => {
          if (role === '__back__') { setRightView('detail'); return; }
          setPendingRole(role);
          setRightView('model-picker');
          setPickerKey(prev => prev + 1);
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    title ? h(Text, { bold: true, color: colors.lavender }, title) : null,
    h(Text, { color: colors.subtext }, `${assignedCount}/${CANONICAL_PHASES.length} phases configured.`),
    h(Text, { key: 'spacer' }, ''),
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
