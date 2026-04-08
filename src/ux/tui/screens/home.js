import React from 'react';
import { Menu } from '../components/menu.js';
import { STATUS_LEVELS } from '../../../core/status-reporter.js';

const h = React.createElement;

/** Short display labels for each status level (emoji + human label). */
const STATUS_INDICATORS = Object.fromEntries(
  Object.entries(STATUS_LEVELS).map(([key, { emoji }]) => {
    const LABELS = {
      configured: 'Configured',
      synchronized: 'Synchronized',
      visible: 'Visible in host',
      ready: 'Ready to use',
      requires_reopen: 'Reopen needed',
      error: 'Error',
    };
    return [key, `${emoji} ${LABELS[key] ?? key}`];
  })
);

/**
 * Get a short status indicator string (emoji + label) for a given status level.
 * Used by the home screen to show current router status at a glance.
 *
 * @param {string} level - One of the STATUS_LEVELS keys
 * @returns {string} Short emoji + label indicator
 */
export function getStatusIndicator(level) {
  return STATUS_INDICATORS[level] ?? '● Unknown';
}

export function getHomeMenuItems(config) {
  const presets = [];
  for (const catalog of Object.values(config?.catalogs ?? {})) {
    for (const _ of Object.keys(catalog?.presets ?? {})) {
      presets.push(_);
    }
  }
  const presetCount = presets.length;

  const sddCount = (() => {
    // SDD count is stored under catalogs as entries that have a sdd property
    let count = 0;
    for (const [, catalog] of Object.entries(config?.catalogs ?? {})) {
      for (const [, preset] of Object.entries(catalog?.presets ?? {})) {
        if (preset?.sdd && preset.sdd !== 'agent-orchestrator') count++;
      }
    }
    return count;
  })();

  return [
    { label: 'Status', value: 'status', description: 'View current router status: active preset, sync state, and whether the host is ready.' },
    { label: `Profiles (${presetCount})`, value: 'presets', description: 'Browse and manage routing presets. Activate/deactivate, view details.' },
    { label: `Custom SDDs (${sddCount})`, value: 'sdd-list', description: 'Create and manage custom SDD workflows (phases, role contracts).' },
    { label: 'Manage', value: 'manage', description: 'Switch presets, activate/deactivate routing, browse metadata.' },
    { label: 'Update', value: 'update', description: 'Check for pending config migrations and apply updates.' },
    { label: 'Settings', value: 'settings', description: 'Apply OpenCode overlay or uninstall gsr from this project.' },
    { label: 'Exit', value: 'exit', description: 'Close the interface.' },
  ];
}

/** Static fallback for tests and cases where config is not available. */
export const HOME_MENU_ITEMS = getHomeMenuItems(null);

export function HomeScreen({ router, setDescription, exit, config, configPath, showResult }) {
  const items = getHomeMenuItems(config);

  const handleSelect = async (value) => {
    if (value === 'exit') { exit(); return; }
    if (value === 'update') {
      // Direct to migrations check — same logic as manage.js "update" handler
      try {
        const path = await import('node:path');
        const mod = await import('../../../core/migrations/index.js');
        const routerDir = path.dirname(configPath);
        const plan = mod.planMigrations(routerDir);
        if (plan.pending.length === 0) {
          showResult(`Config is up to date (version ${plan.currentVersion}).`);
        } else {
          // Navigate to manage screen and let the user click "Check migrations" to apply
          router.push('manage');
          showResult(`${plan.pending.length} pending migration(s). Go to Manage → Check migrations to apply.`);
        }
      } catch (err) {
        showResult(`Error checking migrations: ${err.message}`);
      }
      return;
    }
    router.push(value);
  };

  return h(Menu, { items, onSelect: handleSelect, setDescription });
}
