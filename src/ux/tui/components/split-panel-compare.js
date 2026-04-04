import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, cursor as cursorChar } from '../theme.js';
import { CANONICAL_PHASES } from '../../../core/phases.js';

const h = React.createElement;

export function SplitPanelCompare({ presetA, presetB, nameA, nameB, onBack, setDescription }) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) { if (onBack) onBack(); return; }
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : CANONICAL_PHASES.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < CANONICAL_PHASES.length - 1 ? prev + 1 : 0));
    }
  });

  const getPhaseModel = (preset, phaseName) => {
    const lanes = preset?.phases?.[phaseName];
    if (!Array.isArray(lanes) || lanes.length === 0) return '(none)';
    const primary = lanes.find(l => l.role === 'primary' || !l.role);
    return primary?.target || lanes[0]?.target || '(none)';
  };

  const getExtraLanes = (preset, phaseName) => {
    const lanes = preset?.phases?.[phaseName];
    if (!Array.isArray(lanes) || lanes.length <= 1) return '';
    return ` +${lanes.length - 1}`;
  };

  // Update description based on cursor
  const phaseName = CANONICAL_PHASES[cursor];
  const modelA = getPhaseModel(presetA, phaseName);
  const modelB = getPhaseModel(presetB, phaseName);
  const isDiff = modelA !== modelB;

  React.useEffect(() => {
    if (setDescription) {
      setDescription(isDiff
        ? `${phaseName}: DIFFERENT — ${nameA}: ${modelA} vs ${nameB}: ${modelB}`
        : `${phaseName}: same model — ${modelA}`
      );
    }
  }, [cursor]);

  const renderPanel = (preset, name, side) => {
    return h(Box, { flexDirection: 'column', width: '49%', borderStyle: 'single', borderColor: colors.overlay, paddingX: 1 },
      h(Text, { bold: true, color: colors.lavender }, name),
      h(Text, null, ''),
      ...CANONICAL_PHASES.map((p, idx) => {
        const model = getPhaseModel(preset, p);
        const extra = getExtraLanes(preset, p);
        const isActive = idx === cursor;
        const prefix = isActive ? cursorChar : '  ';

        // Highlight differences
        const otherPreset = side === 'left' ? presetB : presetA;
        const otherModel = getPhaseModel(otherPreset, p);
        const different = model !== otherModel;

        const textColor = isActive ? colors.lavender
          : different ? colors.peach
          : colors.green;

        return h(Text, { key: p, color: textColor, bold: isActive },
          prefix, p.padEnd(14), model.split('/').pop() || model, extra,
        );
      }),
    );
  };

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Compare Presets'),
    h(Text, { color: colors.subtext }, isDiff ? 'Differences highlighted in orange.' : 'Models match for this phase.'),
    h(Text, null, ''),
    h(Box, { flexDirection: 'row' },
      renderPanel(presetA, nameA, 'left'),
      h(Box, { width: 2 }),
      renderPanel(presetB, nameB, 'right'),
    ),
  );
}
