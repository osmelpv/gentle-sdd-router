import React from 'react';
import { Menu } from '../components/menu.js';

const h = React.createElement;

export function HomeScreen({ router, setDescription, exit }) {
  const items = [
    { label: 'Status', value: 'status', description: 'View current router state, active preset, resolved routes with pricing and context window.' },
    { label: 'Catalogs', value: 'catalogs', description: 'Browse and manage catalogs, profiles, and model assignments. This is the main configuration entry point.' },
    { label: 'Manage', value: 'manage', description: 'Switch presets, activate/deactivate routing, browse metadata, check migrations.' },
    { label: 'Settings', value: 'settings', description: 'Apply OpenCode overlay or uninstall gsr from this project.' },
    { label: 'Exit', value: 'exit', description: 'Close the interface.' },
  ];

  const handleSelect = (value) => {
    if (value === 'exit') { exit(); return; }
    router.push(value);
  };

  return h(Menu, { items, onSelect: handleSelect, setDescription });
}
