import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { appendTuiDebug } from '../../../debug/tui-debug-log.js';
import { unifiedSync } from '../../../core/unified-sync.js';
import { getPublicPresetMetadata } from '../../../core/public-preset-metadata.js';
import { detectGentleAiProfiles, duplicateFromGentleAi } from '../../../core/profile-io.js';

const h = React.createElement;

export function ProfilesScreen({ config, configPath, router, setDescription, showResult, reloadConfig, setSelectedProfile, setConfig }) {
  const [lastMessage, setLastMessage] = useState(null);
  const [selectedPresetName, setSelectedPresetName] = useState(null);
  const [gentleAiProfiles, setGentleAiProfiles] = useState([]);
  const [duplicatingProfile, setDuplicatingProfile] = useState(null); // { entry: gentleAiEntry } when in duplicating sub-view
  const [duplicateName, setDuplicateName] = useState('');

  const activePreset = config?.active_profile ?? config?.visibleProfiles?.[0] ?? config?.active_preset;

  const presets = [];

  // Get scope (global/project) per preset from public metadata
  const metadataRows = getPublicPresetMetadata(config);
  const scopeMap = new Map(metadataRows.map(r => [r.name, r.scope]));

  const profilesMap = config?.profilesMap instanceof Map ? config.profilesMap : new Map();
  for (const [name, entry] of profilesMap) {
    const { content, visible, builtin, sddName } = entry;
    const phaseCount = Object.keys(content?.phases ?? {}).length;
    const isActive = name === activePreset;
    const isVisible = visible === true;
    const scope = builtin ? 'builtin' : (scopeMap.get(name) ?? 'user');
    const tag = builtin ? 'builtin' : (isVisible ? 'visible' : 'hidden');
    const displayLabel = builtin
      ? `${name}${isActive ? ' [active]' : ''} — ${phaseCount} phase(s) [builtin]`
      : `${name}${isActive ? ' [active]' : ''} — ${phaseCount} phase(s)`;

    presets.push({
      label: name,
      displayLabel,
      tag,
      scope,
      description: `${isActive ? '(currently active)' : 'Select to view details'}. ${phaseCount} phases. ${scope}. ${isVisible ? 'Visible in TAB cycling.' : 'Hidden from TAB cycling.'}`,
      sddName,
      isActive,
      isVisible,
    });
  }

  presets.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    return a.label.localeCompare(b.label);
  });

  // Append gentle-ai read-only profiles
  for (const gai of gentleAiProfiles) {
    presets.push({
      label: gai.name,
      displayLabel: `${gai.name} — [gentle-ai]`,
      tag: 'gentle-ai',
      scope: 'gentle-ai',
      description: `Read-only gentle-ai profile. Model: ${gai.model ?? 'unknown'}. Cannot be deleted or renamed.`,
      sddName: gai.name,
      isActive: false,
      isVisible: false,
      isReadOnly: true,
    });
  }

  if (presets.length === 0) {
    presets.push({ label: '__none__', displayLabel: 'No presets found', description: 'Install gsr first or create a preset.', isActive: false });
  }

  useEffect(() => {
    detectGentleAiProfiles().then(profiles => {
      setGentleAiProfiles(profiles);
    }).catch(() => {
      setGentleAiProfiles([]);
    });
  }, []);

  useEffect(() => {
    appendTuiDebug('presets_screen_render', {
      screen: 'presets',
      selectedPresetName,
      configPath,
      activePreset,
      presets: presets.map((preset) => ({
        label: preset.label,
        isVisible: preset.isVisible ?? null,
        isActive: preset.isActive ?? null,
        tag: preset.tag ?? null,
      })),
    });
  }, [config, configPath, activePreset, selectedPresetName]);

  useEffect(() => {
    if (selectedPresetName && !presets.some(p => p.label === selectedPresetName)) {
      setSelectedPresetName(null);
    }
  }, [selectedPresetName, presets]);

  const handleSelect = async (value) => {
    if (value === '__none__') return;
    if (value === '__back__') { router.pop(); return; }
    appendTuiDebug('presets_select', { value });
    setSelectedPresetName(value);
  };

  const handleToggleVisibility = async (value) => {
    if (value === '__none__') return;

    const preset = presets.find(p => p.label === value);
    if (!preset) return;
    if (preset.isReadOnly) return;

    try {
      const pathMod = await import('node:path');
      const routerDir = pathMod.dirname(configPath);
      const profileMod = await import('../../../core/profile-io.js');

      const { visible } = profileMod.toggleProfileVisibility(value, routerDir);

      // Reload config
      const mod = await import('../../../router-config.js');
      const freshConfig = mod.loadRouterConfig(configPath);
      if (setConfig) setConfig(freshConfig);

      try {
        await unifiedSync({ configPath });
        setLastMessage(`Profile '${value}' is now ${visible ? 'visible' : 'hidden'}. OpenCode updated.`);
      } catch (syncErr) {
        setLastMessage(`Saved. Sync failed: ${syncErr.message} — run 'gsr sync' manually.`);
      }
    } catch (err) {
      setLastMessage(`Error: ${err.message}`);
    }
  };

  const handleDelete = async (value) => {
    if (value === '__none__') return;

    const preset = presets.find(p => p.label === value);
    if (!preset) return;

    if (preset.isActive) {
      showResult(`Cannot delete '${preset.label}' - it is the active preset. Activate another preset first.`);
      return;
    }
    
    try {
      const mod = await import('../../../router-config.js');
      const pathMod = await import('node:path');
      const routerDir = pathMod.dirname(configPath);
      
      mod.deleteProfile(preset.label, routerDir);
      await reloadConfig();
      
      showResult(`Preset '${preset.label}' deleted.`);
      setSelectedPresetName(null);
    } catch (err) {
      showResult(`Error: ${err.message}`);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      if (duplicatingProfile) {
        setDuplicatingProfile(null);
        setDuplicateName('');
        return;
      }
      if (selectedPresetName) {
        appendTuiDebug('presets_escape_close_actions', { selectedPresetName });
        setSelectedPresetName(null);
        return;
      }
      appendTuiDebug('presets_escape_back', { screen: 'presets' });
      router.pop();
    }
  });

  // Duplicating sub-view
  if (duplicatingProfile) {
    const routerDir = configPath ? configPath.replace(/\/router\.yaml$/, '') : null;
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Duplicate: ${duplicatingProfile.entry.name}`),
      h(Text, { color: colors.subtext }, 'Enter a name for the new local profile (must start with gsr-).'),
      h(Text, null, ''),
      h(TextInput, {
        placeholder: `gsr-copy-of-${duplicatingProfile.entry.name}`,
        value: duplicateName,
        onChange: (value) => setDuplicateName(value),
        onSubmit: async (value) => {
          const name = value.trim() || duplicateName.trim();
          if (!name) return;
          const finalName = name.startsWith('gsr-') ? name : `gsr-${name}`;
          try {
            if (routerDir) {
              duplicateFromGentleAi(duplicatingProfile.entry, finalName, routerDir);
              await reloadConfig();
              setDuplicatingProfile(null);
              setDuplicateName('');
              showResult(`Profile '${finalName}' created as a local copy of '${duplicatingProfile.entry.name}'.`);
            } else {
              showResult('Error: could not determine router directory.');
              setDuplicatingProfile(null);
            }
          } catch (err) {
            showResult(`Error: ${err.message}`);
            setDuplicatingProfile(null);
          }
        },
      }),
      h(Text, null, ''),
      h(Text, { color: colors.overlay }, 'ESC = cancel'),
    );
  }

  if (selectedPresetName) {
    const preset = presets.find(p => p.label === selectedPresetName);
    if (!preset) {
      return null;
    }

    const actions = preset.isReadOnly
      ? [
          { label: 'View details', value: 'view', description: 'View preset phases and configuration.' },
          { label: 'Duplicate as local profile', value: 'duplicate', description: 'Create a local copy of this gentle-ai profile.' },
        ]
      : [
          { label: 'View details', value: 'view', description: 'View preset phases and configuration.' },
          { label: preset.isVisible ? 'Hide from OpenCode TAB' : 'Show in OpenCode TAB', value: 'toggle-visibility', description: preset.isVisible ? 'Hide this preset from TAB cycling.' : 'Make this preset visible in TAB cycling.' },
          ...(!preset.isActive ? [{ label: 'Delete preset', value: 'delete', description: 'Permanently delete this preset from disk.' }] : []),
        ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Preset: ${selectedPresetName}`),
      h(Text, { color: preset.isActive ? colors.green : colors.subtext }, preset.isActive ? '[active]' : `[${preset.tag}]`),
      h(Text, null, ''),
      h(Text, { color: colors.subtext }, 'ENTER = action | ESC = back'),
      h(Text, null, ''),
      h(Menu, {
        items: actions,
        onSelect: async (value) => {
          if (value === 'view') {
            setSelectedProfile(selectedPresetName);
            router.push('profile-detail');
            setSelectedPresetName(null);
            return;
          }
          if (value === 'toggle-visibility') {
            await handleToggleVisibility(selectedPresetName);
            setSelectedPresetName(null);
            return;
          }
          if (value === 'delete') {
            await handleDelete(selectedPresetName);
            return;
          }
          if (value === 'duplicate') {
            const gentleAiEntry = gentleAiProfiles.find(g => g.name === selectedPresetName);
            if (gentleAiEntry) {
              setDuplicateName(`gsr-copy-of-${gentleAiEntry.name}`);
              setDuplicatingProfile({ entry: gentleAiEntry });
              setSelectedPresetName(null);
            } else {
              showResult(`Could not find gentle-ai profile '${selectedPresetName}'.`);
              setSelectedPresetName(null);
            }
            return;
          }
          setSelectedPresetName(null);
        },
        setDescription,
        showBack: true,
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Presets'),
    h(Text, { color: colors.subtext }, 'Browse and manage routing presets.'),
    h(Text, null, ''),
    lastMessage ? h(Text, { color: colors.peach }, lastMessage) : null,
    h(Text, { color: colors.subtext }, 'ENTER = select | V = toggle visibility | D = delete | ESC = back'),
    h(Text, null, ''),
    h(PresetMenu, {
      items: presets,
      onSelect: handleSelect,
      onToggleVisibility: handleToggleVisibility,
      onDelete: handleDelete,
      setDescription,
      showBack: true,
    }),
    h(Text, null, ''),
    h(Text, { color: colors.overlay }, 'Legend: visible/hidden = shows in TAB cycling | [active] = currently selected for routing'),
  );
}

function PresetMenu({ items, onSelect, onToggleVisibility, onDelete, setDescription, showBack }) {
  const [cursor, setCursor] = useState(0);

  const allItems = showBack
    ? [...items, { label: '__back__', displayLabel: 'Back', description: 'Return to previous menu.' }]
    : items;

  useEffect(() => {
    setCursor(prev => (prev >= allItems.length ? 0 : prev));
  }, [allItems.length]);

  useEffect(() => {
    const item = allItems[cursor];
    if (item && setDescription) {
      setDescription(item.description || '');
    }
  }, [cursor, allItems, setDescription]);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : allItems.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < allItems.length - 1 ? prev + 1 : 0));
    }
    if (key.return) {
      const item = allItems[cursor];
      appendTuiDebug('preset_menu_enter', { item: item?.label ?? null, cursor });
      if (item) onSelect(item.label);
    }
    if (input === 'v' || input === 'V') {
      const item = allItems[cursor];
      appendTuiDebug('preset_menu_toggle_key', { item: item?.label ?? null, cursor });
      if (item && item.label !== '__back__' && item.label !== '__none__' && onToggleVisibility) {
        onToggleVisibility(item.label);
      }
    }
    if (input === 'd' || input === 'D') {
      const item = allItems[cursor];
      if (item && item.label !== '__back__' && item.label !== '__none__' && !item.isActive && onDelete) {
        onDelete(item.label);
      }
    }
  });

  const isNarrow = (process.stdout.columns ?? 80) < 80;

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
      else if (item.isVisible) color = colors.green;

      if (isBack || isNone) {
        const displayText = isBack ? item.displayLabel : (item.displayLabel || item.label);
        return h(Text, { key: item.label, color, bold: isSelected && !isBack },
          prefix, displayText,
        );
      }

      if (isNarrow) {
        // Compact form: name — N phases
        const phaseCount = (() => {
          // We may not have phases on the item directly; use displayLabel as fallback
          const match = (item.displayLabel || '').match(/(\d+) phase/);
          return match ? `${match[1]} phases` : '';
        })();
        const compactText = phaseCount ? `${item.label} — ${phaseCount}` : item.label;
        return h(Text, { key: item.label, color, bold: isSelected },
          prefix, compactText,
        );
      }

      // Wide form: table with columns
      const name = item.label.padEnd(22).slice(0, 22);

      // Get phase count from profilesMap (not from item.phases which doesn't exist)
      const profileEntry = profilesMap.get(item.label);
      const pCount = profileEntry ? Object.keys(profileEntry.content?.phases ?? {}).length : 0;
      const phases = String(pCount).padEnd(8).slice(0, 8);

      // Scope: builtin / global / project / gentle-ai
      const scopeStr = (item.scope ?? 'project').padEnd(10).slice(0, 10);

      // Visibility: separate from scope — always show visible/hidden
      const visStr = item.isReadOnly ? 'read-only' : (item.isVisible ? 'visible' : 'hidden');
      const visibility = visStr.padEnd(10).slice(0, 10);

      return h(Box, { key: item.label, flexDirection: 'row' },
        h(Text, { color, bold: isSelected }, prefix),
        h(Text, { color, bold: isSelected }, name),
        h(Text, { color: isSelected ? color : colors.subtext }, scopeStr),
        h(Text, { color: isSelected ? color : colors.subtext }, phases),
        h(Text, { color: item.isVisible ? colors.green : colors.overlay }, visibility),
      );
    }),
  );
}
