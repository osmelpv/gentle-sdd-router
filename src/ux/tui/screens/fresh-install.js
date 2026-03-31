import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Menu } from '../components/menu.js';
import { colors, LOGO } from '../theme.js';

const h = React.createElement;

export function FreshInstallScreen({ setDescription, showResult, reloadConfig, exit, router, setConfig, setConfigPath }) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  if (installing) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Installing Gentle SDD Router...'),
      h(Text, { color: colors.subtext }, '\n'),
      h(Box, null,
        h(Text, { color: colors.green }, '█'.repeat(Math.floor(progress / 5))),
        h(Text, { color: colors.overlay }, '░'.repeat(20 - Math.floor(progress / 5))),
        h(Text, { color: colors.peach }, ` ${progress}%`),
      ),
    );
  }

  const items = [
    { label: 'Install', value: 'install', description: 'Set up gsr in this project. Creates router/ directory with default presets.' },
    { label: 'Quit', value: 'quit', description: 'Exit without installing.' },
  ];

  const handleSelect = async (value) => {
    if (value === 'quit') {
      exit();
      return;
    }

    if (value === 'install') {
      setInstalling(true);
      try {
        // Simulate progress
        for (let i = 0; i <= 100; i += 10) {
          setProgress(i);
          await new Promise(r => setTimeout(r, 80));
        }

        // Actually run install
        const mod = await import('../../../router-config.js');
        mod.installOpenCodeCommand({ apply: true, intent: '' });

        // Reload config after install
        try {
          const newConfigPath = mod.discoverConfigPath();
          const newConfig = mod.loadRouterConfig(newConfigPath);
          setConfig(newConfig);
          setConfigPath(newConfigPath);
        } catch { /* will be handled by home screen */ }

        setInstalling(false);
        router.reset('home');
      } catch (err) {
        setInstalling(false);
        showResult(`Install failed: ${err.message}`);
      }
    }
  };

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: colors.green, dimColor: true }, LOGO),
    h(Text, null, ''),
    h(Text, { bold: true, color: colors.lavender }, 'Welcome to Gentle SDD Router'),
    h(Text, { color: colors.subtext }, 'No router config found in this project.', '\n'),
    h(Menu, { items, onSelect: handleSelect, setDescription }),
  );
}
