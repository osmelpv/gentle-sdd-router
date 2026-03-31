import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { fetchAllModels } from '../model-fetcher.js';
import { colors, cursor as cursorChar } from '../theme.js';

const h = React.createElement;

// Keep MODEL_REGISTRY as a named export for backward compat (tests, etc.)
export const MODEL_REGISTRY = {}; // deprecated, dynamic now

export function ModelPicker({ onSelect, onCancel, setDescription, excludeTarget, excludeTargets }) {
  const [mode, setMode] = useState('loading'); // 'loading' | 'provider' | 'model' | 'custom'
  const [providers, setProviders] = useState({});
  const [providerList, setProviderList] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [sources, setSources] = useState([]);

  const allExcluded = new Set([
    ...(excludeTarget ? [excludeTarget] : []),
    ...(excludeTargets || []),
  ]);

  // Fetch models on mount
  useEffect(() => {
    let cancelled = false;
    fetchAllModels().then(result => {
      if (cancelled) return;
      setProviders(result.providers);
      // Sort providers: put well-known ones first, then alphabetical
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

  // Current items based on mode
  const items = (() => {
    if (mode === 'provider') {
      return [
        ...providerList.map(p => {
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
      return (group?.models || []).map(m => {
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
          model: m, // keep full model data for detailed display
        };
      });
    }
    return [];
  })();

  // Reset cursor when items change
  useEffect(() => {
    setCursor(prev => (prev >= items.length ? 0 : prev));
  }, [items.length]);

  // Update footer description when cursor moves
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

  // Handle ESC in custom mode
  useInput((input, key) => {
    if (mode !== 'custom') return;
    if (key.escape) {
      setMode('provider');
      setCursor(0);
    }
  });

  // Main input handler
  useInput((input, key) => {
    if (mode === 'custom' || mode === 'loading') return;

    if (key.escape) {
      if (mode === 'model') {
        setMode('provider');
        setSelectedProvider(null);
        setCursor(0);
      } else {
        if (onCancel) onCancel();
      }
      return;
    }

    // Left arrow: same as ESC (go back one level)
    if (key.leftArrow) {
      if (mode === 'model') {
        setMode('provider');
        setSelectedProvider(null);
        setCursor(0);
      } else {
        if (onCancel) onCancel();
      }
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
      } else if (mode === 'model') {
        if (item.excluded) return; // Block excluded
        // For OpenRouter models, the id is already in provider/model format
        onSelect(item.value);
      }
    }
  });

  // Loading state
  if (mode === 'loading') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.lavender }, 'Loading models...'),
      h(Text, { color: colors.subtext }, 'Fetching from OpenRouter + Ollama'),
    );
  }

  // Custom input
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

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, title),
    h(Text, null, ''),
    ...items.map((item, idx) => {
      const isSelected = idx === cursor;
      const prefix = isSelected ? cursorChar : '  ';
      const color = item.excluded
        ? colors.overlay // dimmed
        : isSelected ? colors.lavender : colors.text;
      return h(Text, { key: item.value || idx, color, bold: isSelected },
        prefix, item.label,
      );
    }),
  );
}
