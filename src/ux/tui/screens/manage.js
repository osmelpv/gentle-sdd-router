import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { SplitPanelCompare } from '../components/split-panel-compare.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function ManageScreen({ config, configPath, router, setDescription, showResult, reloadConfig }) {
  const [subView, setSubView] = useState('menu'); // 'menu' | 'switch' | 'compare-left' | 'compare-right' | 'comparing' | 'migrations'
  const [compareLeft, setCompareLeft] = useState(null);
  const [compareData, setCompareData] = useState(null); // { nameA, nameB, presetA, presetB }
  const [pendingMigrations, setPendingMigrations] = useState(null);

  useInput((input, key) => {
    if (!key.escape) return;
    if (subView === 'comparing') {
      setSubView('menu');
      setCompareData(null);
      return;
    }
    if (subView === 'compare-right') {
      setSubView('compare-left');
      return;
    }
    if (subView !== 'menu') {
      setSubView('menu');
      return;
    }
    router.pop();
  });

  const items = [
    { label: 'Switch active preset', value: 'switch', description: 'Change which preset controls model routing.' },
    { label: 'Activate routing', value: 'activate', description: 'gsr takes control of routing decisions.' },
    { label: 'Deactivate routing', value: 'deactivate', description: 'Hand routing control back to the host.' },
    { label: 'Compare presets', value: 'compare', description: 'Compare two presets side by side.' },
    { label: 'Check migrations', value: 'update', description: 'Check for pending config migrations.' },
  ];

  // Build flat preset list from all catalogs
  const allPresets = [];
  for (const [catalogName, catalog] of Object.entries(config?.catalogs ?? {})) {
    for (const [presetName] of Object.entries(catalog?.presets ?? {})) {
      allPresets.push({ catalogName, presetName, selector: `${catalogName}/${presetName}` });
    }
  }

  // Sub-view: interactive Menu to switch active preset
  if (subView === 'switch') {
    const switchItems = allPresets.map(({ presetName, selector }) => ({
      label: presetName,
      value: selector,
      tag: selector === `${config?.active_catalog ?? 'default'}/${config?.active_preset}` ? 'active' : undefined,
      description: `Switch active preset to '${presetName}'.`,
    }));

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Switch Active Preset'),
      h(Text, { color: colors.subtext }, 'Select a preset to activate.'),
      h(Text, null, ''),
      h(Menu, {
        items: switchItems,
        onSelect: async (value) => {
          if (value === '__back__') { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const currentConfig = mod.loadRouterConfig(configPath);
            // value is catalog/preset — extract just preset name
            const presetName = value.includes('/') ? value.split('/').slice(1).join('/') : value;
            const nextConfig = mod.setActiveProfile(currentConfig, presetName);
            mod.saveRouterConfig(nextConfig, configPath, currentConfig);
            reloadConfig();
            showResult(`Active preset switched to: ${presetName}`);
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

  // Sub-view: Step 1 — select left preset for comparison
  if (subView === 'compare-left') {
    const leftItems = allPresets.map(({ presetName, selector }) => ({
      label: presetName,
      value: selector,
      description: `Use '${presetName}' as the left side of the comparison.`,
    }));

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Compare Presets — Step 1 of 2'),
      h(Text, { color: colors.subtext }, 'Select the LEFT preset.'),
      h(Text, null, ''),
      h(Menu, {
        items: leftItems,
        onSelect: (value) => {
          if (value === '__back__') { setSubView('menu'); return; }
          setCompareLeft(value);
          setSubView('compare-right');
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  // Sub-view: Step 2 — select right preset for comparison (exclude left)
  if (subView === 'compare-right') {
    const rightItems = allPresets
      .filter(({ selector }) => selector !== compareLeft)
      .map(({ presetName, selector }) => ({
        label: presetName,
        value: selector,
        description: `Compare '${compareLeft}' vs '${presetName}'.`,
      }));

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Compare Presets — Step 2 of 2'),
      h(Text, { color: colors.subtext }, `Left: ${compareLeft}. Select the RIGHT preset.`),
      h(Text, null, ''),
      h(Menu, {
        items: rightItems,
        onSelect: async (value) => {
          if (value === '__back__') { setSubView('compare-left'); return; }
          // Get both presets from config
          const leftParts = compareLeft.split('/');
          const rightParts = value.split('/');
          const leftCatalog = config?.catalogs?.[leftParts[0]];
          const rightCatalog = config?.catalogs?.[rightParts[0]];
          const leftPreset = leftCatalog?.presets?.[leftParts.slice(1).join('/')];
          const rightPreset = rightCatalog?.presets?.[rightParts.slice(1).join('/')];

          setCompareData({
            nameA: compareLeft,
            nameB: value,
            presetA: leftPreset,
            presetB: rightPreset,
          });
          setSubView('comparing');
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  // Sub-view: side-by-side compare using SplitPanelCompare
  if (subView === 'comparing' && compareData) {
    return h(SplitPanelCompare, {
      presetA: compareData.presetA,
      presetB: compareData.presetB,
      nameA: compareData.nameA,
      nameB: compareData.nameB,
      onBack: () => { setSubView('menu'); setCompareData(null); },
      setDescription,
    });
  }

  // Sub-view: pending migrations + "Apply now" option
  if (subView === 'migrations' && pendingMigrations) {
    const { plan } = pendingMigrations;
    const migrationActionItems = [
      { label: 'Apply pending migrations', value: '__apply__', description: 'Run all pending migrations now.' },
      { label: 'Cancel', value: '__cancel__', description: 'Go back without applying.' },
    ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Pending Migrations'),
      h(Text, null, ''),
      ...plan.pending.map((m, idx) =>
        h(Text, { key: idx, color: colors.peach }, `  [${m.id}] ${m.name}: ${m.description}`),
      ),
      h(Text, null, ''),
      h(Menu, {
        items: migrationActionItems,
        onSelect: async (value) => {
          if (value === '__cancel__' || value === '__back__') { setSubView('menu'); return; }
          if (value === '__apply__') {
            try {
              const mod = await import('../../../router-config.js');
              const path = await import('node:path');
              const routerDir = path.dirname(configPath);
              const result = await mod.runMigrations(routerDir);
              const lines = [`Applied ${result.applied.length} migration(s):`];
              for (const id of result.applied) {
                lines.push(`  ✓ ${id}`);
              }
              reloadConfig();
              showResult(lines.join('\n'));
            } catch (err) {
              showResult(`Error: ${err.message}`);
            }
            setSubView('menu');
          }
        },
        setDescription,
      }),
    );
  }

  const handleSelect = async (value) => {
    if (value === '__back__') { router.pop(); return; }

    try {
      const mod = await import('../../../router-config.js');

      if (value === 'activate') {
        mod.activateOpenCodeCommand();
        reloadConfig();
        showResult('Routing activated. gsr is now in control.');
        return;
      }

      if (value === 'deactivate') {
        mod.deactivateOpenCodeCommand();
        reloadConfig();
        showResult('Routing deactivated. Host is now in control.');
        return;
      }

      if (value === 'switch') {
        setSubView('switch');
        return;
      }

      if (value === 'browse') {
        const contract = mod.createMultimodelBrowseContract(config);
        showResult(JSON.stringify(contract, null, 2));
        return;
      }

      if (value === 'compare') {
        setSubView('compare-left');
        return;
      }

      if (value === 'update') {
        const path = await import('node:path');
        const routerDir = path.dirname(configPath);
        const plan = mod.planMigrations(routerDir);
        if (plan.pending.length === 0) {
          showResult(`Config is up to date (version ${plan.currentVersion}).`);
        } else {
          setPendingMigrations({ plan });
          setSubView('migrations');
        }
        return;
      }
    } catch (err) {
      showResult(`Error: ${err.message}`);
    }
  };

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Manage'),
    h(Text, null, ''),
    h(Menu, { items, onSelect: handleSelect, setDescription, showBack: true }),
  );
}
