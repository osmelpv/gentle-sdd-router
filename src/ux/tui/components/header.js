import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';

const h = React.createElement;

export function Header({ breadcrumb, config }) {
  const activePreset = config?.active_preset ?? 'none';
  const crumbs = breadcrumb.join(' > ');

  return h(Box, { flexDirection: 'column', paddingX: 2 },
    h(Box, null,
      h(Text, { bold: true, color: colors.lavender }, 'GSR'),
      h(Text, { color: colors.subtext }, ' — Gentle SDD Router'),
    ),
    h(Box, null,
      h(Text, { color: colors.subtext }, crumbs),
      h(Text, { color: colors.overlay }, '  |  '),
      h(Text, { color: colors.green }, activePreset),
      h(Text, { color: colors.subtext }, ' active'),
    ),
    h(Text, { color: colors.overlay }, '\u2500'.repeat(60)),
  );
}
