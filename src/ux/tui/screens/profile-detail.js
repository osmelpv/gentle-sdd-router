import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { getActivePresetOwner } from '../../../core/public-preset-metadata.js';

const h = React.createElement;

function formatCtx(cw) {
  if (!cw) return '';
  if (cw >= 1_000_000) return `${cw / 1_000_000}M`;
  if (cw >= 1_000) return `${cw / 1_000}K`;
  return String(cw);
}

export function ProfileDetailScreen({ config, configPath, router, setDescription, showResult, reloadConfig, selectedCatalog, selectedProfile }) {
  const [subView, setSubView] = useState('menu'); // 'menu' | 'copying'

  useInput((input, key) => {
    if (!key.escape) return;
    if (subView !== 'menu') {
      setSubView('menu');
      return;
    }
    router.pop();
  });

  const activeOwner = getActivePresetOwner(config);
  const catalog = config?.catalogs?.[selectedCatalog || activeOwner?.catalogName || config?.active_catalog || 'default'];
  const preset = catalog?.presets?.[selectedProfile];
  const isActive = selectedProfile === config?.active_preset;

  if (!preset) {
    return h(Text, { color: colors.red }, `Preset '${selectedProfile}' not found.`);
  }

  // Build phase detail lines
  const phaseLines = [];
  for (const [phaseName, lanes] of Object.entries(preset.phases ?? {})) {
    const laneArr = Array.isArray(lanes) ? lanes : [];
    for (let i = 0; i < laneArr.length; i++) {
      const lane = laneArr[i];
      const role = lane.role ?? 'primary';
      const target = lane.target ?? '(none)';
      const fb = lane.fallbacks ? ` -> ${lane.fallbacks}` : '';
      const ctx = lane.contextWindow ? ` [${formatCtx(lane.contextWindow)} ctx]` : '';
      const cost = (lane.inputPerMillion != null) ? ` ($${lane.inputPerMillion}/$${lane.outputPerMillion})` : '';
      const roleTag = laneArr.length > 1 ? `[${role}] ` : '';
      phaseLines.push({ phase: i === 0 ? phaseName : '', text: `${roleTag}${target}${cost}${ctx}${fb}` });
    }
  }

  const actions = [
    { label: 'Edit phases', value: 'edit', description: 'Open the phase/lane editor to modify models, roles, and fallbacks.' },
    { label: 'Edit Identity', value: 'edit-identity', description: 'Configure agent context, prompt, and AGENTS.md inheritance for this preset.' },
    ...(!isActive ? [{ label: 'Activate', value: 'activate', description: `Set '${selectedProfile}' as the active routing preset.` }] : []),
    { label: 'Export', value: 'export', description: 'Export this preset as YAML to stdout.' },
    { label: 'Copy', value: 'copy', description: 'Clone this preset with a new name.' },
    { label: 'Delete', value: 'delete', description: 'Delete this preset from disk.' },
  ];

  // Sub-view: TextInput for copying preset with a new name
  if (subView === 'copying') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Copy Preset: ${selectedProfile}`),
      h(Text, { color: colors.subtext }, 'Enter the new preset name (press Enter to confirm, empty to cancel):'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'new-profile-name',
        onSubmit: async (newName) => {
          if (!newName.trim()) { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const path = await import('node:path');
            const routerDir = path.dirname(configPath);
            mod.copyProfile(selectedProfile, newName.trim(), routerDir);
            await reloadConfig();
            showResult(`Preset '${selectedProfile}' copied to '${newName.trim()}'.`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView('menu');
        },
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, `${selectedProfile}`, isActive ? h(Text, { color: colors.green }, ' (active)') : null),
    h(Text, null, ''),
    // Phase detail table
    ...phaseLines.map((line, idx) =>
      h(Box, { key: idx },
        h(Text, { color: colors.peach }, ('  ' + line.phase).padEnd(16)),
        h(Text, { color: colors.text }, line.text),
      ),
    ),
    h(Text, null, ''),
    h(Menu, {
      items: actions,
      onSelect: async (value) => {
        if (value === '__back__') { router.pop(); return; }

        const mod = await import('../../../router-config.js');
        const routerDir = configPath ? configPath.replace(/\/router\.yaml$/, '') : null;

        if (value === 'edit') {
          router.push('edit-profile');
          return;
        }

        if (value === 'edit-identity') {
          router.push('agent-identity-editor');
          return;
        }

        if (value === 'activate') {
          try {
            const currentConfig = mod.loadRouterConfig(configPath);
            const nextConfig = mod.setActiveProfile(currentConfig, selectedProfile);
            mod.saveRouterConfig(nextConfig, configPath, currentConfig);
            await reloadConfig();
            showResult(`Active preset switched to: ${selectedProfile}`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'export') {
          try {
            const yaml = mod.exportPreset(config, selectedProfile);
            showResult(`# Preset: ${selectedProfile}\n${yaml}`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'copy') {
          setSubView('copying');
          return;
        }

        if (value === 'delete') {
          try {
            mod.deleteProfile(selectedProfile, routerDir);
            await reloadConfig();
            router.pop();
            showResult(`Preset '${selectedProfile}' deleted.`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
