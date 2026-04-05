import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { getActivePresetOwner } from '../../../core/public-preset-metadata.js';
import { appendTuiDebug } from '../../../debug/tui-debug-log.js';
import { unifiedSync } from '../../../core/unified-sync.js';

const h = React.createElement;

function formatCtx(cw) {
  if (!cw) return '';
  if (cw >= 1_000_000) return `${cw / 1_000_000}M`;
  if (cw >= 1_000) return `${cw / 1_000}K`;
  return String(cw);
}

export function ProfileDetailScreen({ config: propConfig, configPath: propConfigPath, router, setDescription, showResult, reloadConfig, selectedCatalog, selectedProfile, setConfig }) {
  const [localConfig, setLocalConfig] = useState(propConfig);
  const [localConfigPath, setLocalConfigPath] = useState(propConfigPath);
  const [subView, setSubView] = useState('menu'); // 'menu' | 'copying' | 'renaming'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLocalConfig(propConfig);
    setLocalConfigPath(propConfigPath);
  }, [propConfig, propConfigPath]);

  useEffect(() => {
    appendTuiDebug('profile_detail_render', {
      screen: 'profile-detail',
      selectedProfile,
      selectedCatalog,
      configPath: localConfigPath,
      activePreset: localConfig?.active_preset ?? null,
    });
  }, [selectedProfile, selectedCatalog, localConfigPath, localConfig?.active_preset]);

  useEffect(() => {
    (async () => {
      try {
        const mod = await import('../../../router-config.js');
        const freshConfigPath = mod.discoverConfigPath([process.cwd()]);
        if (freshConfigPath) {
          const freshConfig = mod.loadRouterConfig(freshConfigPath);
          setLocalConfig(freshConfig);
          setLocalConfigPath(freshConfigPath);
        }
      } catch { /* use current */ }
      setLoading(false);
    })();
  }, []);

  useInput((input, key) => {
    if (!key.escape) return;
    if (subView !== 'menu') {
      setSubView('menu');
      return;
    }
    router.pop();
  });

  if (loading) {
    return h(Box, null, h(Text, { color: colors.subtext }, 'Loading preset...'));
  }

  const activePresetName = selectedProfile || localConfig?.active_preset;
  
  if (!activePresetName) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Profile Detail'),
      h(Text, { color: colors.subtext }, 'No preset selected. Use "Presets" menu to select a preset.'),
    );
  }

  const activeOwner = getActivePresetOwner(localConfig);
  const catalog = localConfig?.catalogs?.[selectedCatalog || activeOwner?.catalogName || localConfig?.active_catalog || 'default'];
  const preset = catalog?.presets?.[activePresetName];
  const isActive = activePresetName === localConfig?.active_preset;

  if (!preset) {
    return h(Text, { color: colors.red }, `Preset '${activePresetName}' not found.`);
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

  const isVisible = preset?.hidden !== true && catalog?.enabled !== false;

  const actions = [
    { label: 'Edit phases', value: 'edit', description: 'Open the phase/lane editor to modify models, roles, and fallbacks.' },
    { label: 'Edit Identity', value: 'edit-identity', description: 'Configure agent context, prompt, and AGENTS.md inheritance for this preset.' },
    { label: isVisible ? 'Hide from OpenCode TAB' : 'Show in OpenCode TAB', value: 'toggle-visibility', description: isVisible ? 'Hide this preset from TAB cycling in OpenCode.' : 'Make this preset visible in TAB cycling.' },
    { label: 'Export', value: 'export', description: 'Export this preset as YAML to stdout.' },
    { label: 'Rename', value: 'rename', description: 'Rename this preset.' },
    { label: 'Copy', value: 'copy', description: 'Clone this preset with a new name.' },
    { label: 'Delete', value: 'delete', description: 'Delete this preset from disk.' },
  ];

  // Sub-view: TextInput for copying preset with a new name
  if (subView === 'copying') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Copy Preset: ${activePresetName}`),
      h(Text, { color: colors.subtext }, 'Enter the new preset name (press Enter to confirm, empty to cancel):'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'new-profile-name',
        onSubmit: async (newName) => {
          if (!newName.trim()) { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const path = await import('node:path');
            const routerDir = path.dirname(localConfigPath);
            mod.copyProfile(activePresetName, newName.trim(), routerDir);
            await reloadConfig();
            showResult(`Preset '${activePresetName}' copied to '${newName.trim()}'.`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView('menu');
        },
      }),
    );
  }

  // Sub-view: TextInput for renaming preset
  if (subView === 'renaming') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Rename Preset: ${activePresetName}`),
      h(Text, { color: colors.subtext }, 'Enter the new name (press Enter to confirm, empty to cancel):'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: activePresetName,
        onSubmit: async (newName) => {
          if (!newName.trim()) { setSubView('menu'); return; }
          try {
            const mod = await import('../../../router-config.js');
            const path = await import('node:path');
            const routerDir = path.dirname(localConfigPath);
            mod.renameProfile(activePresetName, newName.trim(), routerDir);
            await reloadConfig();
            showResult(`Preset '${activePresetName}' renamed to '${newName.trim()}'.`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView('menu');
        },
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Box, { flexDirection: 'row' },
      h(Text, { bold: true, color: colors.lavender }, `${activePresetName}`),
      isActive ? h(Text, { color: colors.green }, ' [active]') : null,
      !isVisible ? h(Text, { color: colors.overlay }, ' [hidden]') : null,
    ),
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
        const routerDir = localConfigPath ? localConfigPath.replace(/\/router\.yaml$/, '') : null;

        if (value === 'edit') {
          router.push('edit-profile');
          return;
        }

        if (value === 'edit-identity') {
          router.push('agent-identity-editor');
          return;
        }

        if (value === 'toggle-visibility') {
          try {
            const newHidden = isVisible;
            appendTuiDebug('profile_detail_toggle_start', {
              preset: activePresetName,
              fromVisible: isVisible,
              toHidden: newHidden,
              configPath: localConfigPath,
            });
            const nextConfig = mod.setPresetMetadata(localConfig, activePresetName, { hidden: newHidden });
            mod.saveRouterConfig(nextConfig, localConfigPath, localConfig);

            const freshConfig = mod.loadRouterConfig(localConfigPath);
            const freshPreset = freshConfig?.catalogs?.[selectedCatalog || activeOwner?.catalogName || freshConfig?.active_catalog || 'default']?.presets?.[activePresetName];
            appendTuiDebug('profile_detail_toggle_reloaded', {
              preset: activePresetName,
              hiddenInFreshConfig: freshPreset?.hidden,
            });
            setLocalConfig(freshConfig);
            if (setConfig) setConfig(freshConfig);
            
            try {
              await unifiedSync({ configPath: localConfigPath });
              showResult(`Preset '${activePresetName}' is now ${newHidden ? 'hidden' : 'visible'}. OpenCode updated.`);
            } catch (syncErr) {
              showResult(`Saved. Sync failed: ${syncErr.message} — run 'gsr sync' manually.`);
            }
          } catch (err) {
            appendTuiDebug('profile_detail_toggle_error', {
              preset: activePresetName,
              error: err,
            });
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'export') {
          try {
            const yaml = mod.exportPreset(localConfig, activePresetName);
            showResult(`# Preset: ${activePresetName}\n${yaml}`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'rename') {
          setSubView('renaming');
          return;
        }

        if (value === 'copy') {
          setSubView('copying');
          return;
        }

        if (value === 'delete') {
          try {
            mod.deleteProfile(activePresetName, routerDir);
            await reloadConfig();
            router.pop();
            showResult(`Preset '${activePresetName}' deleted.`);
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
