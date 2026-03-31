import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, cursor as cursorChar } from '../theme.js';

const h = React.createElement;

export function Menu({ items, onSelect, setDescription, showBack = false }) {
  const [cursor, setCursor] = useState(0);

  // Build full list with optional back item
  const allItems = showBack
    ? [...items, { label: 'Back', value: '__back__', description: 'Return to previous menu.' }]
    : items;

  // Reset cursor when items change so it never points outside the list
  useEffect(() => {
    setCursor(prev => (prev >= allItems.length ? 0 : prev));
  }, [allItems.length]);

  useEffect(() => {
    const item = allItems[cursor];
    if (item && setDescription) {
      setDescription(item.description || '');
    }
  }, [cursor, allItems.length]);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : allItems.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < allItems.length - 1 ? prev + 1 : 0));
    }
    if (key.return) {
      const item = allItems[cursor];
      if (item) onSelect(item.value);
    }
  });

  return h(Box, { flexDirection: 'column' },
    allItems.map((item, idx) => {
      const isSelected = idx === cursor;
      const prefix = isSelected ? cursorChar : '  ';
      const color = isSelected ? colors.lavender : colors.text;
      const suffix = item.tag ? ` [${item.tag}]` : '';

      return h(Text, { key: item.value, color, bold: isSelected },
        prefix, item.label, suffix,
      );
    }),
  );
}
