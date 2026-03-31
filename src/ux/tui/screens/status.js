import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

const h = React.createElement;

function formatCtx(cw) {
  if (!cw) return '';
  if (cw >= 1_000_000) return `${cw / 1_000_000}M`;
  if (cw >= 1_000) return `${cw / 1_000}K`;
  return String(cw);
}

function formatCost(n) {
  if (n == null) return '?';
  if (n === 0) return '$0';
  if (n < 1) return `$${n}`;
  return `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
}

export function StatusScreen({ config, configPath, router }) {
  useInput((input, key) => {
    if (key.escape) router.pop();
  });

  if (!config) {
    return h(Text, { color: colors.red }, 'No config loaded.');
  }

  const activeCatalog = config.active_catalog ?? 'default';
  const activePreset = config.active_preset ?? 'unknown';
  const catalog = config.catalogs?.[activeCatalog];
  const preset = catalog?.presets?.[activePreset];
  const catalogMeta = config.catalogs?.[activeCatalog];
  const displayName = activeCatalog === 'default'
    ? (catalogMeta?.displayName ?? 'SDD-Orchestrator') + ' (default)'
    : (catalogMeta?.displayName ?? activeCatalog);

  return h(Box, { flexDirection: 'column' },
    h(Box, { flexDirection: 'column', marginBottom: 1 },
      h(Text, null,
        h(Text, { bold: true, color: colors.lavender }, 'Catalog:'),
        ' ',
        h(Text, { color: colors.text }, displayName),
      ),
      h(Text, null,
        h(Text, { bold: true, color: colors.lavender }, 'Preset:'),
        ' ',
        h(Text, { color: colors.green }, activePreset),
      ),
      h(Text, null,
        h(Text, { bold: true, color: colors.lavender }, 'Schema:'),
        ' ',
        h(Text, { color: colors.text }, 'v4'),
      ),
    ),

    h(Text, { bold: true, color: colors.mauve }, 'Resolved Routes:'),
    h(Text, { color: colors.overlay }, '─'.repeat(58)),
    h(Box, { flexDirection: 'column' },
      h(Box, null,
        h(Text, { bold: true, color: colors.subtext }, '  Phase'.padEnd(16)),
        h(Text, { bold: true, color: colors.subtext }, 'Model'.padEnd(28)),
        h(Text, { bold: true, color: colors.subtext }, 'Cost'.padEnd(12)),
        h(Text, { bold: true, color: colors.subtext }, 'Context'),
      ),
      preset && Object.entries(preset.phases ?? {}).map(([phase, lanes]) => {
        const primary = Array.isArray(lanes) ? lanes[0] : null;
        if (!primary) return null;

        const target = primary.target ?? '(none)';
        const [provider, model] = target.includes('/') ? target.split('/') : ['', target];
        const cost = (primary.inputPerMillion != null || primary.outputPerMillion != null)
          ? `${formatCost(primary.inputPerMillion)}/${formatCost(primary.outputPerMillion)}`
          : '';
        const ctx = primary.contextWindow ? formatCtx(primary.contextWindow) : '';

        // Multi-lane indicator
        const laneCount = Array.isArray(lanes) ? lanes.length : 0;
        const multiLabel = laneCount > 1 ? ` +${laneCount - 1}` : '';

        return h(Box, { key: phase, flexDirection: 'column' },
          h(Box, null,
            h(Text, { color: colors.peach }, '  ' + phase.padEnd(14)),
            h(Text, { color: colors.blue }, provider),
            h(Text, { color: colors.overlay }, '/'),
            h(Text, { bold: true, color: colors.text }, (model + multiLabel).padEnd(24 - provider.length)),
            h(Text, { color: colors.subtext }, cost.padEnd(12)),
            h(Text, { color: colors.green }, ctx),
          ),
          laneCount > 1 && lanes.slice(1).map((lane, idx) => (
            h(Box, { key: idx },
              h(Text, { color: colors.overlay }, ''.padEnd(16)),
              h(Text, { color: colors.overlay }, (lane.role ?? 'secondary') + ': '),
              h(Text, { color: colors.subtext }, lane.target ?? '(none)'),
              lane.fallbacks ? h(Text, { color: colors.overlay }, ' fallback: ' + lane.fallbacks) : null,
            )
          )),
        );
      }),
    ),
  );
}
