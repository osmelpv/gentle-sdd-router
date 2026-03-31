import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

const h = React.createElement;

export function ResultScreen({ text, onBack }) {
  useInput((input, key) => {
    if (key.return || key.escape) {
      onBack();
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, null, text || '(no output)'),
    h(Text, { color: colors.subtext }, '\n', 'Press enter or esc to go back.'),
  );
}
