import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { fetchAllModels } from '../model-fetcher.js';
import { colors, cursor as cursorChar } from '../theme.js';

const h = React.createElement;

const VIEWPORT_SIZE = 15;
const MAX_VISIBLE_ITEMS = 12;

export function ModelPicker({ onSelect, onCancel, setDescription, excludeTarget, excludeTargets }) {
  const [mode, setMode] = useState('loading');
  const [providers, setProviders] = useState({});
  const [providerList, setProviderList] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [sources, setSources] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const allExcluded = new Set([
    ...(excludeTarget ? [excludeTarget] : []),
    ...(excludeTargets || []),
  ]);

  useEffect(() => {
    let cancelled = false;
    fetchAllModels().then(result => {
      if (cancelled) return;
      setProviders(result.providers);
      const knownOrder = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'qwen', 'nvidia', 'ollama'];
      const keys = Object.keys(result.providers);
      keys.sort((a, b) => {
        const ai = knownOrder.indexOf(a);
        const bi = knownOrder.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.localeCompare(b);
      });
      setProviderList(keys);
      setSources(result.sources);
      setMode('provider');
    });
    return () => { cancelled = true; };
  }, []);

  const filteredProviders = searchQuery
    ? providerList.filter(p => p.toLowerCase().includes(searchQuery.toLowerCase()))
    : providerList;

  const items = (() => {
    if (mode === 'provider') {
      return [
        ...filteredProviders.map(p => {
          const group = providers[p];
          const count = group?.models?.length || 0;
          return {
            label: `${p} (${count})`,
            value: p,
            hint: `${count} model(s) available. Source: ${group?.source || 'unknown'}.`,
          };
        }),
        { label: 'Type custom model ID', value: '__custom__', hint: 'Enter provider/model manually.' },
      ];
    }
    if (mode === 'model' && selectedProvider) {
      const group = providers[selectedProvider];
      const allModels = group?.models || [];
      const filteredModels = searchQuery
        ? allModels.filter(m => 
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.id.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : allModels;
      return filteredModels.map(m => {
        const isExcluded = allExcluded.has(m.id);
        const cost = m.costIn === 0 ? 'free' : `$${m.costIn}/$${m.costOut}`;
        const ctxStr = m.contextWindow >= 1_000_000 ? `${m.contextWindow / 1_000_000}M` : `${Math.round(m.contextWindow / 1000)}K`;
        const caps = [];
        if (m.capabilities?.tools) caps.push('tools');
        if (m.capabilities?.reasoning) caps.push('reasoning');
        if (m.capabilities?.vision) caps.push('vision');
        const capStr = caps.length > 0 ? ` {${caps.join(',')}}` : '';

        return {
          label: `${m.name} (${cost}) [${ctxStr}]${capStr}${isExcluded ? ' [primary]' : ''}`,
          value: m.id,
          hint: isExcluded ? 'This is the primary model — cannot be used as fallback.' : (m.description || m.name),
          excluded: isExcluded,
          model: m,
        };
      });
    }
    return [];
  })();

  useEffect(() => {
    setCursor(prev => (prev >= items.length ? Math.max(0, items.length - 1) : prev));
  }, [items.length]);

  useEffect(() => {
    if (mode === 'loading') {
      if (setDescription) setDescription('Loading models from OpenRouter and Ollama...');
      return;
    }
    if (mode === 'custom') {
      if (setDescription) setDescription('Type a model ID in provider/model format. Press enter to confirm, empty to go back.');
      return;
    }
    const item = items[cursor];
    if (item && setDescription) {
      setDescription(item.hint || '');
    }
  }, [cursor, mode, items.length]);

  useInput((input, key) => {
    if (mode === 'loading') return;

    if (mode === 'custom' || mode === 'search') {
      if (key.escape) {
        if (mode === 'search') {
          setMode(selectedProvider ? 'model' : 'provider');
          setSearchQuery('');
        } else {
          setMode('provider');
        }
        setCursor(0);
      }
      return;
    }

    if (key.escape) {
      if (mode === 'model') {
        setMode('provider');
        setSelectedProvider(null);
        setCursor(0);
        setSearchQuery('');
      } else {
        if (onCancel) onCancel();
      }
      return;
    }

    if (key.leftArrow) {
      if (mode === 'model') {
        setMode('provider');
        setSelectedProvider(null);
        setCursor(0);
        setSearchQuery('');
      } else {
        if (onCancel) onCancel();
      }
      return;
    }

    if (input === '/' && mode !== 'custom') {
      setMode('search');
      return;
    }

    if (mode === 'search') {
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : items.length - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < items.length - 1 ? prev + 1 : 0));
    }
    if (key.return || key.rightArrow) {
      const item = items[cursor];
      if (!item) return;

      if (mode === 'provider') {
        if (item.value === '__custom__') {
          setMode('custom');
          return;
        }
        setSelectedProvider(item.value);
        setMode('model');
        setCursor(0);
        setSearchQuery('');
      } else if (mode === 'model') {
        if (item.excluded) return;
        onSelect(item.value);
      }
    }
  });

  const handleSearchSubmit = (value) => {
    setSearchQuery(value);
    setMode(selectedProvider ? 'model' : 'provider');
    setCursor(0);
  };

  if (mode === 'loading') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.lavender }, 'Loading models...'),
      h(Text, { color: colors.subtext }, 'Fetching from OpenRouter + Ollama'),
    );
  }

  if (mode === 'search') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Search:'),
      h(TextInput, {
        placeholder: 'Type to filter...',
        onSubmit: handleSearchSubmit,
        onChange: (value) => {
          setSearchQuery(value);
          const filtered = selectedProvider
            ? (providers[selectedProvider]?.models || []).filter(m => 
                m.name.toLowerCase().includes(value.toLowerCase()) ||
                m.id.toLowerCase().includes(value.toLowerCase())
              )
            : providerList.filter(p => p.toLowerCase().includes(value.toLowerCase()));
          setCursor(0);
        },
      }),
      h(Text, { color: colors.subtext }, 'Press Enter to filter, ESC to cancel. Use / to search.'),
    );
  }

  if (mode === 'custom') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Enter model ID (provider/model):'),
      h(TextInput, {
        placeholder: 'e.g. anthropic/claude-opus-4.6',
        onSubmit: (value) => {
          if (value && value.trim()) {
            onSelect(value.trim());
          } else {
            setMode('provider');
            setCursor(0);
          }
        },
      }),
      h(Text, { color: colors.subtext }, 'Press enter to confirm, empty to go back.'),
    );
  }

  const title = mode === 'provider'
    ? `Select provider (${sources.join(' + ')})`
    : `Select model (${selectedProvider})`;

  const startIdx = Math.max(0, cursor - Math.floor(MAX_VISIBLE_ITEMS / 2));
  const endIdx = Math.min(items.length, startIdx + MAX_VISIBLE_ITEMS);
  const visibleItems = items.slice(startIdx, endIdx);

  const hasMoreAbove = startIdx > 0;
  const hasMoreBelow = endIdx < items.length;

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, title),
    h(Text, { color: colors.subtext }, searchQuery ? `Filter: "${searchQuery}" (${items.length} results) | Press / to search, ESC to clear` : `Press / to search | ${items.length} items`),
    h(Text, null, ''),
    hasMoreAbove ? h(Text, { color: colors.overlay }, '  ... more above ...') : null,
    ...visibleItems.map((item, idx) => {
      const actualIdx = startIdx + idx;
      const isSelected = actualIdx === cursor;
      const prefix = isSelected ? cursorChar : '  ';
      const color = item.excluded
        ? colors.overlay
        : isSelected ? colors.lavender : colors.text;
      return h(Text, { key: item.value || actualIdx, color, bold: isSelected },
        prefix, item.label,
      );
    }),
    hasMoreBelow ? h(Text, { color: colors.overlay }, '  ... more below ...') : null,
    h(Text, null, ''),
    h(Text, { color: colors.subtext }, '↑↓ navigate | Enter select | ESC back | / search'),
  );
}