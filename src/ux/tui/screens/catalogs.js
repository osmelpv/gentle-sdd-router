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
      label: `${displayName} — ${presetCount} profile(s)`,
      value: name,
      tag: enabled ? 'enabled' : 'disabled',
      description: `Browse profiles in ${displayName}. ${presetCount} profile(s).`,
    });
  }

  if (catalogs.length === 0) {
    catalogs.push({ label: 'No catalogs found', value: '__none__', description: 'Install gsr first.' });
  }

  catalogs.push({ label: 'Create catalog', value: '__create__', description: 'Create a new catalog (disabled by default).' });
  catalogs.push({ label: 'Enable/Disable catalog', value: '__toggle__', description: 'Toggle catalog visibility in TUI host TAB cycling.' });

  // Sub-view: TextInput for creating a new catalog
  if (subView === 'creating') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Create Catalog'),
      h(Text, { color: colors.subtext }, 'Enter the catalog name (press Enter to confirm, empty to cancel):'),
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
        label: `${displayName} — ${enabled ? 'enabled' : 'disabled'}`,
        value: name,
        tag: enabled ? 'enabled' : 'disabled',
        description: `Click to ${enabled ? 'disable' : 'enable'} '${name}'.`,
      };
    });

    if (toggleItems.length === 0) {
      toggleItems.push({ label: 'No catalogs to toggle', value: '__none__', description: 'No catalogs found.' });
    }

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Enable/Disable Catalog'),
      h(Text, { color: colors.subtext }, 'Select a catalog to toggle its enabled state.'),
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
            setLastMessage(`Catalog '${value}' ${!currentEnabled ? 'enabled' : 'disabled'}. Run 'gsr setup apply opencode --apply' to update OpenCode.`);
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
    h(Text, { bold: true, color: colors.lavender }, 'Catalogs'),
    h(Text, { color: colors.subtext }, 'Select a catalog to browse its profiles.'),
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
