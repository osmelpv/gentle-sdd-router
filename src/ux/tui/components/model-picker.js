import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { fetchAllModels } from '../model-fetcher.js';
import { getConnectedProviders } from './provider-registry.js';
import { colors, cursor as cursorChar } from '../theme.js';

const h = React.createElement;

const MAX_VISIBLE_ITEMS = 10;

/**
 * Flat single-pane model picker.
 *
 * Props:
 *   onSelect(modelId)       — called when the user picks a model
 *   onCancel()              — called on ESC with no selection
 *   setDescription(text)   — optional: update footer description
 *   excludeTarget(string)  — legacy single-exclusion prop
 *   excludeTargets([])     — array of model IDs to mark as excluded (cannot be selected)
 *   connectedOnly(bool)    — when true (default false), pre-filter to connected providers
 *   configPath(string)     — path to router.yaml, forwarded to provider-registry
 *   label(string)          — optional label shown in the heading
 */
export function ModelPicker({
  onSelect,
  onCancel,
  setDescription,
  excludeTarget,
  excludeTargets,
  connectedOnly = false,
  configPath,
  label,
}) {
  const [mode, setMode] = useState('loading'); // 'loading' | 'list' | 'custom'
  const [allItems, setAllItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sources, setSources] = useState([]);
  const [showAll, setShowAll] = useState(!connectedOnly);

  const allExcluded = new Set([
    ...(excludeTarget ? [excludeTarget] : []),
    ...(excludeTargets || []),
  ]);

  // Build the flat item list from provider groups
  function buildItems(providers) {
    const knownOrder = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'qwen', 'mistral', 'opencode', 'opencode-go', 'ollama', 'nvidia'];
    const keys = Object.keys(providers);
    keys.sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });

    const items = [];
    for (const provider of keys) {
      const group = providers[provider];
      const models = group?.models || [];
      for (const m of models) {
        const isExcluded = allExcluded.has(m.id);
        items.push({
          label: `[${provider}] ${m.name}`,
          value: m.id,
          provider,
          model: m,
          excluded: isExcluded,
          hint: isExcluded
            ? 'This is the primary model — cannot be used as fallback.'
            : (m.description || m.name),
        });
      }
    }
    // "Type custom" always last
    items.push({
      label: '[custom] Type model ID manually',
      value: '__custom__',
      provider: 'custom',
      excluded: false,
      hint: 'Enter provider/model format manually.',
    });
    return items;
  }

  // Load models
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let providerFilter;
        if (connectedOnly && !showAll) {
          providerFilter = await getConnectedProviders(configPath);
        }
        const result = await fetchAllModels(providerFilter ? { providerFilter } : {});
        if (cancelled) return;
        const items = buildItems(result.providers);
        setAllItems(items);
        setSources(result.sources);
        setMode('list');
        setCursor(0);
      } catch {
        if (!cancelled) setMode('list');
      }
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, connectedOnly, configPath]);

  // Derived: filter by search query
  const filteredItems = searchQuery
    ? allItems.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.value.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allItems;

  // Clamp cursor when list length changes
  useEffect(() => {
    setCursor(prev => Math.min(prev, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  // Update footer description on cursor move
  useEffect(() => {
    if (!setDescription) return;
    if (mode === 'loading') {
      setDescription('Loading models from OpenRouter and Ollama...');
      return;
    }
    if (mode === 'custom') {
      setDescription('Type a model ID in provider/model format. Press enter to confirm, empty to go back.');
      return;
    }
    const item = filteredItems[cursor];
    if (item) setDescription(item.hint || '');
  }, [cursor, mode, filteredItems.length, setDescription]);

  // Keyboard handling
  useInput((input, key) => {
    if (mode === 'loading') return;

    if (mode === 'custom') {
      if (key.escape) {
        setMode('list');
        setCursor(0);
      }
      return;
    }

    // ESC → cancel
    if (key.escape) {
      if (onCancel) onCancel();
      return;
    }

    // [A] toggle show all / connected only
    if ((input === 'a' || input === 'A') && connectedOnly) {
      setShowAll(prev => !prev);
      setCursor(0);
      setMode('loading');
      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : filteredItems.length - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < filteredItems.length - 1 ? prev + 1 : 0));
      return;
    }

    // Select
    if (key.return) {
      const item = filteredItems[cursor];
      if (!item) return;
      if (item.value === '__custom__') {
        setMode('custom');
        return;
      }
      if (item.excluded) return;
      onSelect(item.value);
    }
  });

  // Custom input mode
  if (mode === 'custom') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Enter model ID (provider/model):'),
      h(TextInput, {
        placeholder: 'e.g. anthropic/claude-opus-4.6',
        onSubmit: (value) => {
          if (value && value.trim()) {
            onSelect(value.trim());
          } else {
            setMode('list');
            setCursor(0);
          }
        },
      }),
      h(Text, { color: colors.subtext }, 'Press Enter to confirm, empty to go back.'),
    );
  }

  if (mode === 'loading') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.lavender }, 'Loading models...'),
      h(Text, { color: colors.subtext }, 'Fetching from OpenRouter + Ollama'),
    );
  }

  // Viewport calculation
  const startIdx = Math.max(0, cursor - Math.floor(MAX_VISIBLE_ITEMS / 2));
  const endIdx = Math.min(filteredItems.length, startIdx + MAX_VISIBLE_ITEMS);
  const visibleItems = filteredItems.slice(startIdx, endIdx);
  const hasMoreAbove = startIdx > 0;
  const hasMoreBelow = endIdx < filteredItems.length;
  const aboveCount = startIdx;
  const belowCount = filteredItems.length - endIdx;

  const modeLabel = connectedOnly
    ? (showAll ? 'all providers' : 'connected only')
    : 'all providers';
  const heading = label || `Select model (${modeLabel} · ${sources.join(' + ')})`;

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, heading),
    // Always-visible search input
    h(Box, { flexDirection: 'row' },
      h(Text, { color: colors.subtext }, 'Search: '),
      h(TextInput, {
        placeholder: 'filter by name or provider...',
        value: searchQuery,
        onChange: (v) => { setSearchQuery(v); setCursor(0); },
        onSubmit: () => {},
      }),
    ),
    h(Text, { color: colors.subtext },
      searchQuery
        ? `${filteredItems.length} result(s) · [A] ${showAll ? 'connected only' : 'show all'} · ESC cancel`
        : `${filteredItems.length} model(s) · [A] ${showAll ? 'connected only' : 'show all'} · ESC cancel`
    ),
    h(Text, null, ''),
    hasMoreAbove
      ? h(Text, { color: colors.overlay }, `  ↑ ${aboveCount} more above`)
      : null,
    ...visibleItems.map((item, idx) => {
      const actualIdx = startIdx + idx;
      const isSelected = actualIdx === cursor;
      const prefix = isSelected ? cursorChar : '  ';
      const color = item.excluded
        ? colors.overlay
        : isSelected ? colors.lavender : colors.text;
      return h(Text, { key: item.value || actualIdx, color, bold: isSelected },
        prefix, item.label, item.excluded ? ' [primary]' : '',
      );
    }),
    hasMoreBelow
      ? h(Text, { color: colors.overlay }, `  ↓ ${belowCount} more below`)
      : null,
    h(Text, null, ''),
    h(Text, { color: colors.subtext }, '↑↓/jk navigate · Enter select · ESC cancel'),
  );
}
