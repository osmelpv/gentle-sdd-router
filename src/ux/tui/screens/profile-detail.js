import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { getActivePresetOwner } from '../../../core/public-preset-metadata.js';
import { appendTuiDebug } from '../../../debug/tui-debug-log.js';
import { unifiedSync } from '../../../core/unified-sync.js';
import {
  readFallbackChain, readLanePrimary, getPresetPhases,
  promoteFallback, writeFallbackChain, validateModelId,
} from '../../../core/fallback-io.js';
import { GLOBAL_PROFILES_DIR } from '../../../core/profile-io.js';

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

  // Resolve profile name: prefer explicit selectedProfile, fall back to first visible
  const activePresetName = selectedProfile
    || localConfig?.active_profile
    || localConfig?.visibleProfiles?.[0]
    || localConfig?.active_preset; // deprecated fallback

  if (!activePresetName) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Profile Detail'),
      h(Text, { color: colors.subtext }, 'No profile selected. Use the Profiles menu to select one.'),
    );
  }

  // Resolve preset content from profilesMap (new) or catalogs compat shim (legacy)
  let preset = null;
  if (localConfig?.profilesMap instanceof Map) {
    preset = localConfig.profilesMap.get(activePresetName)?.content ?? null;
  }
  if (!preset && localConfig?.catalogs) {
    // compat shim fallback
    for (const group of Object.values(localConfig.catalogs)) {
      if (group?.presets?.[activePresetName]) { preset = group.presets[activePresetName]; break; }
    }
  }

  const isActive = localConfig?.profilesMap instanceof Map
    ? (localConfig.profilesMap.get(activePresetName)?.visible === true)
    : (activePresetName === (localConfig?.active_profile ?? localConfig?.active_preset));

  if (!preset) {
    return h(Text, { color: colors.red }, `Profile '${activePresetName}' not found.`);
  }

  // Detect profile scope: local, global (user-promoted), or builtin
  const profileEntry = localConfig?.profilesMap?.get(activePresetName);
  const profileFilePath = profileEntry?.filePath ?? null;
  const isBuiltin = profileEntry?.builtin === true;
  const isGlobal = profileFilePath != null && profileFilePath.startsWith(GLOBAL_PROFILES_DIR);
  const isLocal = profileFilePath != null && !isBuiltin && !isGlobal;

  // Build phase detail lines — supports both simplified {model, fallbacks} and legacy lane array
  const phaseLines = [];
  for (const [phaseName, phaseEntry] of Object.entries(preset.phases ?? {})) {
    if (!Array.isArray(phaseEntry) && typeof phaseEntry === 'object' && phaseEntry !== null) {
      // Simplified schema: { model, fallbacks?: [] }
      const model = phaseEntry.model ?? '(none)';
      const fallbacks = Array.isArray(phaseEntry.fallbacks) ? phaseEntry.fallbacks : [];
      const fb = fallbacks.length > 0 ? ` → ${fallbacks.join(', ')}` : '';
      phaseLines.push({ phase: phaseName, text: `${model}${fb}` });
    } else if (Array.isArray(phaseEntry)) {
      // Legacy lane array
      for (let i = 0; i < phaseEntry.length; i++) {
        const lane = phaseEntry[i];
        const role = lane.role ?? 'primary';
        const target = lane.target ?? '(none)';
        const fb = lane.fallbacks ? ` → ${lane.fallbacks}` : '';
        const roleTag = phaseEntry.length > 1 ? `[${role}] ` : '';
        phaseLines.push({ phase: i === 0 ? phaseName : '', text: `${roleTag}${target}${fb}` });
      }
    }
  }

  const isVisible = localConfig?.profilesMap instanceof Map
    ? (localConfig.profilesMap.get(activePresetName)?.visible === true)
    : (preset?.hidden !== true);

  const actions = [
    { label: 'Manage fallbacks', value: 'fallbacks', description: 'View, add, remove, or promote fallback models per phase.' },
    { label: 'Edit phases', value: 'edit', description: 'Open the phase/lane editor to modify models, roles, and fallbacks.' },
    { label: 'Edit Identity', value: 'edit-identity', description: 'Configure agent context, prompt, and AGENTS.md inheritance for this preset.' },
    { label: isVisible ? 'Hide from OpenCode TAB' : 'Show in OpenCode TAB', value: 'toggle-visibility', description: isVisible ? 'Hide this preset from TAB cycling in OpenCode.' : 'Make this preset visible in TAB cycling.' },
    { label: 'Export', value: 'export', description: 'Export this preset as YAML to stdout.' },
    { label: 'Rename', value: 'rename', description: 'Rename this preset.' },
    { label: 'Copy', value: 'copy', description: 'Clone this preset with a new name.' },
    { label: 'Delete', value: 'delete', description: 'Delete this preset from disk.' },
    ...(isLocal ? [{ label: '↑ Promote to global', value: 'promote', description: 'Make available in all your projects (~/.config/gsr/profiles/).' }] : []),
    ...(isGlobal ? [{ label: '↓ Demote to project', value: 'demote', description: 'Move back to this project only.' }] : []),
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

  // Sub-view: Fallback phase picker
  if (subView === 'fallbacks') {
    let phases = [];
    try { phases = getPresetPhases(localConfigPath, activePresetName); } catch { /* empty */ }
    if (phases.length === 0) {
      return h(Box, { flexDirection: 'column' },
        h(Text, { color: colors.red }, `No phases found for preset '${activePresetName}'.`),
        h(Text, { color: colors.subtext }, 'Press ESC to go back.'),
      );
    }
    const phaseItems = phases.map(p => {
      let primary = '';
      let fbCount = 0;
      try {
        primary = readLanePrimary(localConfigPath, activePresetName, p, 0);
        fbCount = readFallbackChain(localConfigPath, activePresetName, p, 0).length;
      } catch { /* ignore */ }
      return {
        label: p,
        description: `Primary: ${primary || '(none)'}${fbCount > 0 ? ` · ${fbCount} fallback(s)` : ' · no fallbacks'}`,
      };
    });
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Fallbacks — ${activePresetName}`),
      h(Text, { color: colors.subtext }, 'Select a phase to manage its fallback chain.'),
      h(Text, null, ''),
      h(Menu, {
        items: phaseItems,
        onSelect: (value) => {
          if (value === '__back__') { setSubView('menu'); return; }
          setSubView(`fb-detail:${value}`);
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  // Sub-view: Fallback detail for a specific phase
  if (subView?.startsWith('fb-detail:')) {
    const phaseName = subView.split(':')[1];
    let primary = '';
    let chain = [];
    try {
      primary = readLanePrimary(localConfigPath, activePresetName, phaseName, 0);
      chain = readFallbackChain(localConfigPath, activePresetName, phaseName, 0);
    } catch { /* empty */ }

    const fbItems = [
      { label: `★ ${primary || '(none)'}`, value: '__primary__', description: 'Current primary model' },
      ...chain.map((fb, i) => ({
        label: `  ${i + 1}. ${typeof fb === 'string' ? fb : fb.model}`,
        value: `fb-action:${i}`,
        description: 'Select to promote or remove',
      })),
      { label: '+ Add fallback', value: '__add__', description: 'Add a new model to the chain' },
    ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `${activePresetName} / ${phaseName}`),
      h(Text, { color: colors.subtext }, `Primary: ${primary || '(none)'} · ${chain.length} fallback(s)`),
      h(Text, null, ''),
      h(Menu, {
        items: fbItems,
        onSelect: async (value) => {
          if (value === '__back__') { setSubView('fallbacks'); return; }
          if (value === '__primary__') return; // no-op
          if (value === '__add__') { setSubView(`fb-add:${phaseName}`); return; }

          // Fallback action: promote or remove
          const fbIdx = parseInt(value.split(':')[1], 10);
          setSubView(`fb-action:${phaseName}:${fbIdx}`);
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  // Sub-view: Action on a specific fallback (promote/remove)
  if (subView?.startsWith('fb-action:')) {
    const parts = subView.split(':');
    const phaseName = parts[1];
    const fbIdx = parseInt(parts[2], 10);
    let chain = [];
    try { chain = readFallbackChain(localConfigPath, activePresetName, phaseName, 0); } catch { /* */ }
    const modelName = typeof chain[fbIdx] === 'string' ? chain[fbIdx] : chain[fbIdx]?.model ?? '(unknown)';

    const actionItems = [
      { label: '⬆ Promote to primary', value: 'promote', description: `Swap ${modelName} with current primary` },
      { label: '✕ Remove from chain', value: 'remove', description: `Remove ${modelName} from fallback chain` },
    ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `${activePresetName} / ${phaseName} — ${modelName}`),
      h(Text, null, ''),
      h(Menu, {
        items: actionItems,
        onSelect: async (value) => {
          if (value === '__back__') { setSubView(`fb-detail:${phaseName}`); return; }
          try {
            if (value === 'promote') {
              await promoteFallback(localConfigPath, activePresetName, phaseName, 0, fbIdx + 1);
              showResult(`Promoted ${modelName} to primary for ${phaseName}.`);
            }
            if (value === 'remove') {
              const newChain = chain.filter((_, i) => i !== fbIdx);
              await writeFallbackChain(localConfigPath, activePresetName, phaseName, 0, newChain);
              showResult(`Removed ${modelName} from ${phaseName} fallbacks.`);
            }
            await reloadConfig();
            await unifiedSync({ configPath: localConfigPath });
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView(`fb-detail:${phaseName}`);
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  // Sub-view: Add a fallback to a phase
  if (subView?.startsWith('fb-add:')) {
    const phaseName = subView.split(':')[1];
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Add fallback — ${activePresetName} / ${phaseName}`),
      h(Text, { color: colors.subtext }, 'Enter model ID (e.g. openai/gpt-5, anthropic/claude-sonnet):'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: 'provider/model-name',
        onSubmit: async (modelId) => {
          const trimmed = (modelId || '').trim();
          if (!trimmed) { setSubView(`fb-detail:${phaseName}`); return; }
          if (!validateModelId(trimmed)) {
            showResult(`Invalid model ID "${trimmed}". Must be provider/model format.`);
            setSubView(`fb-detail:${phaseName}`);
            return;
          }
          try {
            const chain = readFallbackChain(localConfigPath, activePresetName, phaseName, 0);
            chain.push(trimmed);
            await writeFallbackChain(localConfigPath, activePresetName, phaseName, 0, chain);
            await reloadConfig();
            await unifiedSync({ configPath: localConfigPath });
            showResult(`Added ${trimmed} to ${phaseName} fallbacks.`);
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          setSubView(`fb-detail:${phaseName}`);
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

        if (value === 'fallbacks') {
          setSubView('fallbacks');
          return;
        }

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

        if (value === 'promote') {
          try {
            const profileMod = await import('../../../core/profile-io.js');
            profileMod.promoteProfile(activePresetName, routerDir);
            await reloadConfig();
            showResult(`Profile '${activePresetName}' promoted to global.`);
            router.pop();
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'demote') {
          try {
            const profileMod = await import('../../../core/profile-io.js');
            profileMod.demoteProfile(activePresetName, routerDir);
            await reloadConfig();
            showResult(`Profile '${activePresetName}' demoted to project.`);
            router.pop();
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
