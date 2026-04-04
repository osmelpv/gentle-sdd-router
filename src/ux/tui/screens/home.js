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

export const HOME_MENU_ITEMS = [
  { label: 'Status', value: 'status', description: 'View current router status: active preset, sync state, and whether the host is ready.' },
  { label: 'Presets', value: 'presets', description: 'Browse and manage routing presets. Activate/deactivate, view details.' },
  { label: 'SDDs', value: 'sdd-list', description: 'Create and manage custom SDD workflows (phases, role contracts).' },
  { label: 'Manage', value: 'manage', description: 'Switch presets, activate/deactivate routing, browse metadata, check migrations.' },
  { label: 'Settings', value: 'settings', description: 'Apply OpenCode overlay or uninstall gsr from this project.' },
  { label: 'Exit', value: 'exit', description: 'Close the interface.' },
];

export function HomeScreen({ router, setDescription, exit }) {
  const items = HOME_MENU_ITEMS;

  const handleSelect = (value) => {
    if (value === 'exit') { exit(); return; }
    router.push(value);
  };

  return h(Menu, { items, onSelect: handleSelect, setDescription });
}
