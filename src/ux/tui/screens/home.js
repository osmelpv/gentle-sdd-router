import React from 'react';
import { Menu } from '../components/menu.js';

const h = React.createElement;

export const HOME_MENU_ITEMS = [
  { label: 'Status', value: 'status', description: 'View current router state, active preset, resolved routes with pricing and context window.' },
  { label: 'Catalogs', value: 'catalogs', description: 'Browse and manage catalogs, profiles, and model assignments. This is the main configuration entry point.' },
  { label: 'SDDs', value: 'sdd-list', description: 'Create and manage custom SDD workflows (catalogs, phases, role contracts).' },
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
