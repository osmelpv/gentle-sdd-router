import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function CatalogsScreen({ config, configPath, router, setDescription, showResult, reloadConfig, setSelectedCatalog }) {
  const [subView, setSubView] = useState('menu'); // 'menu' | 'creating' | 'toggling'
  const [lastMessage, setLastMessage] = useState(null);

  useInput((input, key) => {
    if (!key.escape) return;
    if (subView !== 'menu') {
      setSubView('menu');
      return;
    }
    router.pop();
  });

  const configCatalogs = config?.catalogs ?? {};
  const catalogs = [];

  for (const [name, catalog] of Object.entries(configCatalogs)) {
    const presetCount = Object.keys(catalog.presets ?? {}).length;
    const displayName = name === 'default'
      ? (catalog.displayName ?? 'SDD-Orchestrator') + ' (default)'
      : (catalog.displayName ?? name);
    const enabled = catalog.enabled !== false;

    catalogs.push({
      label: `${displayName} — ${presetCount} preset(s)`,
      value: name,
      tag: enabled ? 'visible' : 'hidden',
      description: `Browse presets in ${displayName}. ${presetCount} preset(s).`,
    });
  }

  if (catalogs.length === 0) {
    catalogs.push({ label: 'No preset sources found', value: '__none__', description: 'Install gsr first.' });
  }

  catalogs.push({ label: 'Create source (legacy)', value: '__create__', description: 'Create a new internal source grouping (legacy/advanced).' });
  catalogs.push({ label: 'Show/Hide source (legacy)', value: '__toggle__', description: 'Toggle source visibility in the host (legacy/advanced).' });

  // Sub-view: TextInput for creating a new catalog
  if (subView === 'creating') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Create Preset Source (legacy)'),
      h(Text, { color: colors.subtext }, 'Enter the internal source name (press Enter to confirm, empty to cancel):'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'catalog-name',
        onSubmit: async (name) => {
          if (!name.trim()) { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const path = await import('node:path');
            const routerDir = path.dirname(configPath);
            const createdName = name.trim();
            mod.createCatalog(createdName, routerDir);
            await reloadConfig();
            setSelectedCatalog(createdName);
            setSubView('menu');
            router.push('catalog-profiles');
            return;
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView('menu');
        },
      }),
    );
  }

  // Sub-view: Menu for toggling enable/disable
  if (subView === 'toggling') {
    const toggleItems = Object.entries(configCatalogs).map(([name, catalog]) => {
      const enabled = catalog.enabled !== false;
      const displayName = name === 'default'
        ? (catalog.displayName ?? 'SDD-Orchestrator') + ' (default)'
        : (catalog.displayName ?? name);
      return {
        label: `${displayName} — ${enabled ? 'visible' : 'hidden'}`,
        value: name,
        tag: enabled ? 'visible' : 'hidden',
        description: `Click to ${enabled ? 'hide' : 'show'} '${name}' in the host.`,
      };
    });

    if (toggleItems.length === 0) {
      toggleItems.push({ label: 'No preset sources to toggle', value: '__none__', description: 'No sources found.' });
    }

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Show/Hide Preset Source (legacy)'),
      h(Text, { color: colors.subtext }, 'Select an internal source to toggle host visibility.'),
      h(Text, null, ''),
      h(Menu, {
        items: toggleItems,
        onSelect: async (value) => {
          if (value === '__back__' || value === '__none__') { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const path = await import('node:path');
            const routerDir = path.dirname(configPath);
            const currentEnabled = configCatalogs[value]?.enabled !== false;
            mod.setCatalogEnabled(value, !currentEnabled, routerDir);
            await reloadConfig();
            setLastMessage(`Source '${value}' is now ${!currentEnabled ? 'visible' : 'hidden'}. Run 'gsr sync' to update the host.`);
            // Stay inline — don't break flow with showResult
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView('menu');
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Presets'),
    h(Text, { color: colors.subtext }, 'Select an SDD source to browse its presets.'),
    h(Text, null, ''),
    lastMessage ? h(Text, { color: colors.peach }, lastMessage) : null,
    h(Menu, {
      items: catalogs,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__none__') return;

        if (value === '__create__') {
          setSubView('creating');
          return;
        }

        if (value === '__toggle__') {
          setSubView('toggling');
          return;
        }

        setSelectedCatalog(value);
        router.push('catalog-profiles');
      },
      setDescription,
      showBack: true,
    }),
  );
}
