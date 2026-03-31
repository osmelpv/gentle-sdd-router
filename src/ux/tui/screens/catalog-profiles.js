import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function CatalogProfilesScreen({ config, router, setDescription, selectedCatalog, setSelectedProfile }) {
  useInput((input, key) => {
    if (key.escape) {
      router.pop();
    }
  });

  const catalog = config?.catalogs?.[selectedCatalog];
  const presets = catalog?.presets ?? {};
  const activePreset = config?.active_preset;

  // Guard: catalog might not exist yet (newly created, config reload pending)
  const displayName = !selectedCatalog
    ? 'Unknown Catalog'
    : selectedCatalog === 'default'
      ? (catalog?.displayName ?? 'SDD-Orchestrator') + ' (default)'
      : (catalog?.displayName ?? selectedCatalog);

  const items = Object.entries(presets).map(([name, preset]) => {
    const phaseCount = Object.keys(preset.phases ?? {}).length;
    const isActive = name === activePreset;
    const marker = isActive ? ' (active)' : '';
    return {
      label: `${name}${marker} — ${phaseCount} phase(s)`,
      value: name,
      description: `View or edit profile '${name}'. ${phaseCount} phases configured.`,
    };
  });

  items.push({ label: '+ Create new profile', value: '__create__', description: 'Start the guided profile creation wizard.' });

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, displayName),
    h(Text, { color: colors.subtext }, `${Object.keys(presets).length} profile(s) in this catalog.`),
    h(Text, null, ''),
    h(Menu, {
      items,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__create__') {
          router.push('create-profile');
          return;
        }
        setSelectedProfile(value);
        router.push('profile-detail');
      },
      setDescription,
      showBack: true,
    }),
  );
}
