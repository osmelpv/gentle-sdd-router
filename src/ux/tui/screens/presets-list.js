import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors, cursor as cursorChar } from '../theme.js';

const h = React.createElement;

export function PresetsScreen({ config, configPath, router, setDescription, showResult, reloadConfig, setSelectedProfile }) {
  const [lastMessage, setLastMessage] = useState(null);

  const catalogs = config?.catalogs ?? {};
  const activePreset = config?.active_preset;

  const presets = [];

  for (const [catalogName, catalog] of Object.entries(catalogs)) {
    const catalogPresets = catalog?.presets ?? {};
    
    for (const [presetName, preset] of Object.entries(catalogPresets)) {
      const phaseCount = Object.keys(preset.phases ?? {}).length;
      const isActive = presetName === activePreset;
      const isVisible = preset.hidden !== true && catalog.enabled !== false;
      
      presets.push({
        label: presetName,
        displayLabel: `${presetName}${isActive ? ' [active]' : ''} — ${phaseCount} phase(s)`,
        tag: isVisible ? 'visible' : 'hidden',
        description: `${isActive ? '(currently active)' : 'Select to view details'}. ${phaseCount} phases. ${isVisible ? 'Visible in TAB cycling.' : 'Hidden from TAB cycling.'}`,
        catalogName,
        isActive,
        isVisible,
      });
    }
  }

  presets.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    return a.label.localeCompare(b.label);
  });

  if (presets.length === 0) {
    presets.push({ label: '__none__', displayLabel: 'No presets found', description: 'Install gsr first or create a preset.', isActive: false });
  }

  const handleSelect = async (value) => {
    if (value === '__none__') return;

    const preset = presets.find(p => p.label === value);
    if (!preset) return;

    setSelectedProfile(value);
    router.push('profile-detail');
  };

  const handleActivate = async (value) => {
    if (value === '__none__') return;

    const preset = presets.find(p => p.label === value);
    if (!preset) return;

    if (preset.isActive) {
      showResult(`Preset '${preset.label}' is already active.`);
      return;
    }
    
    try {
      const mod = await import('../../../router-config.js');
      
      const nextConfig = mod.setActiveProfile(config, preset.label);
      mod.saveRouterConfig(nextConfig, configPath, config);
      await reloadConfig();
      
      setLastMessage(`Preset '${preset.label}' is now active. Run 'gsr sync' to update the host.`);
    } catch (err) {
      showResult(`Error: ${err.message}`);
    }
  };

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Presets'),
    h(Text, { color: colors.subtext }, 'Browse and manage routing presets.'),
    h(Text, null, ''),
    lastMessage ? h(Text, { color: colors.peach }, lastMessage) : null,
    h(Text, { color: colors.subtext }, 'ENTER = view details | A = activate preset'),
    h(Text, null, ''),
    h(PresetMenu, {
      items: presets,
      onSelect: handleSelect,
      onActivate: handleActivate,
      setDescription,
      showBack: true,
    }),
    h(Text, null, ''),
    h(Text, { color: colors.overlay }, 'Legend: [active] = currently selected | visible/hidden = shows in TAB cycling'),
  );
}

function PresetMenu({ items, onSelect, onActivate, setDescription, showBack }) {
  const [cursor, setCursor] = useState(0);

  const allItems = showBack
    ? [...items, { label: '__back__', displayLabel: 'Back', description: 'Return to previous menu.' }]
    : items;

  useState(() => {
    setCursor(prev => (prev >= allItems.length ? 0 : prev));
  });

  useState(() => {
    const item = allItems[cursor];
    if (item && setDescription) {
      setDescription(item.description || '');
    }
  });

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : allItems.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < allItems.length - 1 ? prev + 1 : 0));
    }
    if (key.return) {
      const item = allItems[cursor];
      if (item) onSelect(item.label);
    }
    if (input === 'a' || input === 'A') {
      const item = allItems[cursor];
      if (item && item.label !== '__back__' && item.label !== '__none__' && onActivate) {
        onActivate(item.label);
      }
    }
  });

  return h(Box, { flexDirection: 'column' },
    allItems.map((item, idx) => {
      const isSelected = idx === cursor;
      const prefix = isSelected ? cursorChar : '  ';
      const isBack = item.label === '__back__';
      const isActive = item.isActive;
      const isNone = item.label === '__none__';
      
      let color = colors.text;
      if (isSelected) color = colors.lavender;
      else if (isBack) color = colors.overlay;
      else if (isActive) color = colors.green;
      
      const suffix = item.tag ? ` [${item.tag}]` : '';
      const displayText = isBack ? item.displayLabel : (item.displayLabel || item.label);

      return h(Text, { key: item.label, color, bold: isSelected && !isBack },
        prefix, displayText, isNone ? '' : suffix,
      );
    }),
  );
}
