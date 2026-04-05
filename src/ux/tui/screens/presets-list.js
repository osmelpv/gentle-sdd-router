import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors, cursor as cursorChar } from '../theme.js';
import { appendTuiDebug } from '../../../debug/tui-debug-log.js';
import { unifiedSync } from '../../../core/unified-sync.js';

const h = React.createElement;

export function PresetsScreen({ config, configPath, router, setDescription, showResult, reloadConfig, setSelectedProfile, setConfig }) {
  const [lastMessage, setLastMessage] = useState(null);
  const [selectedPresetName, setSelectedPresetName] = useState(null);

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
    if (!preset) {
      appendTuiDebug('presets_toggle_missing_preset', { value });
      return;
    }

    const newHiddenValue = preset.isVisible;

    try {
      appendTuiDebug('presets_toggle_start', {
        preset: preset.label,
        fromVisible: preset.isVisible,
        toHidden: newHiddenValue,
        configPath,
      });
      
      const mod = await import('../../../router-config.js');
      const nextConfig = mod.setPresetMetadata(config, preset.label, { hidden: newHiddenValue });
      mod.saveRouterConfig(nextConfig, configPath, config);

      // Reload the exact config file backing the current TUI session.
      const freshConfig = mod.loadRouterConfig(configPath);
      const freshPreset = freshConfig?.catalogs?.[preset.catalogName]?.presets?.[preset.label];
      appendTuiDebug('presets_toggle_reloaded', {
        preset: preset.label,
        hiddenInFreshConfig: freshPreset?.hidden,
        catalogName: preset.catalogName,
        freshActivePreset: freshConfig?.active_preset ?? null,
      });
      if (setConfig) {
        appendTuiDebug('presets_toggle_set_config', {
          preset: preset.label,
          hiddenInFreshConfig: freshPreset?.hidden,
        });
        setConfig(freshConfig);
      }

      try {
        await unifiedSync({ configPath });
        setLastMessage(`Preset '${preset.label}' is now ${newHiddenValue ? 'hidden' : 'visible'}. OpenCode updated.`);
      } catch (syncErr) {
        setLastMessage(`Saved. Sync failed: ${syncErr.message} — run 'gsr sync' manually.`);
      }
    } catch (err) {
      appendTuiDebug('presets_toggle_error', {
        preset: preset.label,
        error: err,
      });
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
      if (selectedPresetName) {
        appendTuiDebug('presets_escape_close_actions', { selectedPresetName });
        setSelectedPresetName(null);
        return;
      }
      appendTuiDebug('presets_escape_back', { screen: 'presets' });
      router.pop();
    }
  });

  if (selectedPresetName) {
    const preset = presets.find(p => p.label === selectedPresetName);
    if (!preset) {
      return null;
    }

    const actions = [
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
      const name = item.label.padEnd(30).slice(0, 30);
      const phaseCount = Object.keys(item.phases ?? {}).length;
      // Derive type from item properties (global = 'built-in', project = 'custom')
      const type = (item.scope ?? 'project').padEnd(12).slice(0, 12);
      const phases = String(phaseCount).padEnd(8).slice(0, 8);
      const visibility = (item.tag ?? 'visible').padEnd(10).slice(0, 10);

      return h(Box, { key: item.label, flexDirection: 'row' },
        h(Text, { color, bold: isSelected }, prefix),
        h(Text, { color, bold: isSelected }, name),
        h(Text, { color: isSelected ? color : colors.subtext }, type),
        h(Text, { color: isSelected ? color : colors.subtext }, phases),
        h(Text, { color: isSelected ? color : colors.subtext }, visibility),
      );
    }),
  );
}
