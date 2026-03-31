import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';

const h = React.createElement;

export function Footer({ description, canGoBack }) {
  const keys = [];
  keys.push('up/down: navigate');
  keys.push('enter: select');
  if (canGoBack) keys.push('esc: back');
  keys.push('q: quit');

  return h(Box, { flexDirection: 'column', paddingX: 2 },
    h(Text, { color: colors.overlay }, '─'.repeat(60)),
    description ? h(Text, { color: colors.subtext }, description) : null,
    h(Text, { color: colors.overlay }, keys.join('  ')),
  );
}
