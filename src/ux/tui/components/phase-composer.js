import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ModelPicker } from './model-picker.js';
import { Menu } from './menu.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { CANONICAL_PHASES, PHASE_METADATA } from '../../../core/phases.js';
import { normalizeFallbacks } from '../../../core/router-v4-io.js';

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
  for (const [role] of Object.entries(counts)) {
    if (!['agent', 'judge', 'radar'].includes(role)) {
      parts.push(role.charAt(0).toUpperCase());
    }
  }
  return parts.join('+');
}

/**
 * Get normalized fallback model ID strings from a lane object.
 * @param {object} lane
 * @returns {string[]}
 */
function getLaneFallbacks(lane) {
  if (!lane?.fallbacks) return [];
  const normalized = normalizeFallbacks(lane.fallbacks);
  return normalized.map((item) => item.model);
}

export function PhaseComposer({ phases, onPhasesChange, onSave, onCancel, setDescription, title, configPath }) {
  const [activePanel, setActivePanel] = useState('left');
  const [phaseCursor, setPhaseCursor] = useState(0);
  // rightView: 'detail' | 'model-picker' | 'add-role' | 'fallback-manager'
  const [rightView, setRightView] = useState('detail');
  const [slotCursor, setSlotCursor] = useState(0);
  const [editingSlotIdx, setEditingSlotIdx] = useState(null);
  const [pendingRole, setPendingRole] = useState(null);
  const [pickerKey, setPickerKey] = useState(0);

  // Fallback manager state
  const [fallbackLaneIdx, setFallbackLaneIdx] = useState(0); // which lane we're editing fallbacks for
  const [fallbackCursor, setFallbackCursor] = useState(0);  // cursor within the fallback chain
  // pickerContext: 'slot' (editing slot model) | 'fallback' (adding fallback)
  const [pickerContext, setPickerContext] = useState('slot');

  const activePhaseName = phaseCursor < CANONICAL_PHASES.length ? CANONICAL_PHASES[phaseCursor] : null;
  const activeMeta = activePhaseName ? PHASE_METADATA[activePhaseName] : null;
  const phaseLanes = activePhaseName ? (phases[activePhaseName] || []) : [];
  const isMono = activeMeta?.alwaysMono === true;

  // Active fallback lane (when in fallback-manager view)
  const activeFallbackLane = phaseLanes[fallbackLaneIdx] ?? null;
  const activeFallbackChain = activeFallbackLane ? getLaneFallbacks(activeFallbackLane) : [];

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
    setFallbackLaneIdx(0);
    setFallbackCursor(0);
    setPickerContext('slot');
  }, [phaseCursor]);

  // Update footer description
  useEffect(() => {
    if (!setDescription) return;
    if (activePanel === 'left' && activeMeta) {
      setDescription(activeMeta.description);
    }
    if (activePanel === 'right' && rightView === 'detail' && phaseLanes[slotCursor]) {
      const lane = phaseLanes[slotCursor];
      setDescription(`[${lane.role || 'agent'}] ${lane.target || '(empty)'} — Enter to change model, F to manage fallbacks, x to remove (optional only)`);
    }
    if (activePanel === 'right' && rightView === 'fallback-manager') {
      const lane = phaseLanes[fallbackLaneIdx];
      const role = lane?.role || 'agent';
      setDescription(`Fallbacks for ${activePhaseName} [${role}] (lane ${fallbackLaneIdx}) — ↑↓ move cursor, D delete, A add, Esc back`);
    }
  }, [activePanel, phaseCursor, rightView, slotCursor, fallbackLaneIdx, fallbackCursor]);

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
      if (rightView === 'add-role' || rightView === 'fallback-manager') {
        setRightView('detail');
        setFallbackCursor(0);
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
          setPickerContext('slot');
          setRightView('model-picker');
          setPickerKey(prev => prev + 1);
        } else if (!isMono) {
          // "Add role" item
          setRightView('add-role');
        }
      }

      // f key — open fallback manager for the focused slot
      if ((input === 'f' || input === 'F') && slotCursor < phaseLanes.length) {
        setFallbackLaneIdx(slotCursor);
        setFallbackCursor(0);
        setRightView('fallback-manager');
        return;
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

    // ── Fallback manager keyboard handling (Task 10) ─────────────────────────
    if (rightView === 'fallback-manager') {
      const chainLen = activeFallbackChain.length;

      if (key.upArrow || input === 'k') {
        setFallbackCursor(prev => (prev > 0 ? prev - 1 : Math.max(chainLen - 1, 0)));
      }
      if (key.downArrow || input === 'j') {
        setFallbackCursor(prev => (prev < chainLen - 1 ? prev + 1 : 0));
      }

      // D — delete focused entry
      if ((input === 'd' || input === 'D') && chainLen > 0) {
        const newChain = activeFallbackChain.filter((_, idx) => idx !== fallbackCursor);
        _updateFallbackChain(newChain);
        setFallbackCursor(prev => Math.min(prev, Math.max(newChain.length - 1, 0)));
      }

      // U — move entry up in chain (swap with previous)
      if (input === 'u' && chainLen > 1 && fallbackCursor > 0) {
        const newChain = [...activeFallbackChain];
        const temp = newChain[fallbackCursor - 1];
        newChain[fallbackCursor - 1] = newChain[fallbackCursor];
        newChain[fallbackCursor] = temp;
        _updateFallbackChain(newChain);
        setFallbackCursor(prev => prev - 1);
      }

      // N — move entry down in chain (swap with next)
      if (input === 'n' && chainLen > 1 && fallbackCursor < chainLen - 1) {
        const newChain = [...activeFallbackChain];
        const temp = newChain[fallbackCursor + 1];
        newChain[fallbackCursor + 1] = newChain[fallbackCursor];
        newChain[fallbackCursor] = temp;
        _updateFallbackChain(newChain);
        setFallbackCursor(prev => prev + 1);
      }

      // A — open model picker to add a new fallback (Task 11)
      if (input === 'a' || input === 'A') {
        setPickerContext('fallback');
        setRightView('model-picker');
        setPickerKey(prev => prev + 1);
      }
    }
  });

  /**
   * Update the fallback chain for the active fallback lane (internal helper).
   * Converts array back to CSV string and calls onPhasesChange.
   */
  function _updateFallbackChain(newChain) {
    const newLanes = phaseLanes.map((lane, idx) => {
      if (idx !== fallbackLaneIdx) return lane;
      const updated = { ...lane };
      if (newChain.length === 0) {
        delete updated.fallbacks;
      } else {
        updated.fallbacks = newChain.join(', ');
      }
      return updated;
    });
    onPhasesChange({ ...phases, [activePhaseName]: newLanes });
  }

  // Handle model selection from picker (Task 11 integration)
  const handleModelSelect = (modelId) => {
    if (pickerContext === 'fallback') {
      // Adding a new fallback entry — append to chain
      const newChain = [...activeFallbackChain, modelId];
      _updateFallbackChain(newChain);
      setFallbackCursor(newChain.length - 1);
      setPickerContext('slot');
      setRightView('fallback-manager');
    } else if (pendingRole) {
      // Adding new role
      const newLane = { target: modelId, role: pendingRole, kind: 'lane', phase: activePhaseName };
      const newLanes = [...phaseLanes, newLane];
      onPhasesChange({ ...phases, [activePhaseName]: newLanes });
      setPendingRole(null);
      setRightView('detail');
    } else if (editingSlotIdx !== null) {
      // Editing existing slot
      const newLanes = [...phaseLanes];
      newLanes[editingSlotIdx] = { ...newLanes[editingSlotIdx], target: modelId };
      onPhasesChange({ ...phases, [activePhaseName]: newLanes });
      setRightView('detail');
    }
    setEditingSlotIdx(null);
  };

  const handlePickerCancel = () => {
    setPendingRole(null);
    setEditingSlotIdx(null);
    if (pickerContext === 'fallback') {
      setPickerContext('slot');
      setRightView('fallback-manager');
    } else {
      setRightView('detail');
    }
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
      const fallbackCount = getLaneFallbacks(lane).length;
      const fallbackHint = fallbackCount > 0 ? ` [${fallbackCount}fb]` : '';

      return h(Text, { key: `slot-${idx}`, color: isActive ? colors.lavender : colors.text, bold: isActive },
        prefix, h(Text, { color: roleColor }, role.padEnd(18)),
        model, fallbackHint, removeHint,
      );
    });

    // Fallback manager hint
    if (slotCursor < phaseLanes.length) {
      slotItems.push(h(Text, { key: '__fb-hint__', color: colors.overlay },
        '  ', '[F] Manage fallbacks',
      ));
    }

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
    // Build excludeTargets: current lane target + all current fallback models
    // (only when in fallback context — avoid excluding current target when editing slot)
    const currentTarget = phaseLanes[fallbackLaneIdx]?.target;
    const excludeTargets = pickerContext === 'fallback'
      ? [currentTarget, ...activeFallbackChain].filter(Boolean)
      : [];

    rightContent = h(ModelPicker, {
      key: `composer-pick-${activePhaseName}-${editingSlotIdx ?? 'new'}-${pickerKey}`,
      onSelect: handleModelSelect,
      onCancel: handlePickerCancel,
      setDescription,
      connectedOnly: true,
      configPath,
      excludeTargets,
      label: pickerContext === 'fallback' ? 'Select fallback model' : undefined,
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
          setPickerContext('slot');
          setRightView('model-picker');
          setPickerKey(prev => prev + 1);
        },
        setDescription,
        showBack: true,
      }),
    );
  } else if (rightView === 'fallback-manager') {
    // ── Fallback manager view (Task 9) ────────────────────────────────────────
    const lane = phaseLanes[fallbackLaneIdx];
    const role = lane?.role || 'agent';
    const chain = activeFallbackChain;
    const chainLen = chain.length;

    const chainItems = chain.map((model, idx) => {
      const isActive = idx === fallbackCursor;
      const prefix = isActive ? cursorChar : '  ';
      const canUp = idx > 0;
      const canDown = idx < chainLen - 1;
      const moveHints = canUp && canDown ? ' [u↑] [n↓]' : canUp ? ' [u↑]' : canDown ? ' [n↓]' : '';

      return h(Text, { key: `fb-${idx}`, color: isActive ? colors.lavender : colors.text, bold: isActive },
        prefix,
        h(Text, { color: colors.subtext }, `${idx + 1}. `),
        model,
        isActive ? h(Text, { color: colors.overlay }, `  [D] delete${moveHints}`) : null,
      );
    });

    if (chainLen === 0) {
      chainItems.push(h(Text, { key: 'empty', color: colors.overlay }, '  (no fallbacks defined)'));
    }

    rightContent = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.peach },
        `Fallbacks: ${activePhaseName} `,
        h(Text, { color: colors.overlay }, `[${role}] lane ${fallbackLaneIdx}`),
      ),
      h(Text, { key: 'sep', color: colors.overlay }, '\u2500'.repeat(36)),
      h(Text, { key: 'spacer' }, ''),
      ...chainItems,
      h(Text, { key: 'spacer2' }, ''),
      h(Text, { color: colors.blue }, '  [A] Add fallback    [Esc] Back'),
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
