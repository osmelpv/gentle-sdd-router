import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function SettingsScreen({ config, configPath, router, setDescription, showResult, reloadConfig, exit }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [overlayPreview, setOverlayPreview] = useState(null); // { lines, report }

  useInput((input, key) => {
    if (!key.escape) return;
    if (confirmUninstall) {
      setConfirmUninstall(false);
      return;
    }
    if (overlayPreview) {
      setOverlayPreview(null);
      return;
    }
    router.pop();
  });

  if (confirmUninstall) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.red }, 'Uninstall gsr from this project?'),
      h(Text, null, ''),
      h(Text, { color: colors.text }, 'This will:'),
      h(Text, { color: colors.peach }, '  1. Remove gsr-* agents from opencode.json'),
      h(Text, { color: colors.peach }, '  2. Backup router/ to .router-backup-<timestamp>'),
      h(Text, { color: colors.peach }, '  3. Delete the router/ directory'),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Yes, uninstall', value: 'yes', description: 'Proceed with uninstall. A backup will be created.' },
          { label: 'Cancel', value: 'no', description: 'Go back without uninstalling.' },
        ],
        onSelect: async (value) => {
          if (value === 'no') { setConfirmUninstall(false); return; }
          try {
            const mod = await import('../../../router-config.js');
            const fs = await import('node:fs');
            const path = await import('node:path');

            const overlayResult = mod.removeOpenCodeOverlay();
            const lines = [];
            if (overlayResult.removedCount > 0) lines.push(`Removed ${overlayResult.removedCount} gsr-* agent(s) from overlay.`);

            if (configPath) {
              const routerDir = path.dirname(configPath);
              const backupDir = path.join(path.dirname(routerDir), '.router-backup-' + Date.now());
              fs.cpSync(routerDir, backupDir, { recursive: true });
              lines.push(`Backup: ${backupDir}`);
              fs.rmSync(routerDir, { recursive: true, force: true });
              lines.push(`Removed: ${routerDir}/`);
            }
            lines.push('');
            lines.push('gsr has been fully uninstalled from this project.');
            showResult(lines.join('\n'));
            setTimeout(() => exit(), 2000);
          } catch (err) {
            showResult(`Uninstall failed: ${err.message}`);
          }
        },
        setDescription,
      }),
    );
  }

  // Sub-view: overlay preview + "Write now" / "Cancel" menu
  if (overlayPreview) {
    const { lines } = overlayPreview;
    const overlayActionItems = [
      { label: 'Write overlay now', value: '__write__', description: 'Apply the overlay to opencode.json immediately.' },
      { label: 'Cancel', value: '__cancel__', description: 'Go back without writing.' },
    ];

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'OpenCode Overlay Preview'),
      h(Text, null, ''),
      ...lines.map((line, idx) => h(Text, { key: idx, color: colors.text }, line)),
      h(Text, null, ''),
      h(Menu, {
        items: overlayActionItems,
        onSelect: async (value) => {
          if (value === '__cancel__' || value === '__back__') { setOverlayPreview(null); return; }
          if (value === '__write__') {
            try {
              const mod = await import('../../../router-config.js');
              mod.applyOpenCodeOverlayCommand({ apply: true, configPath });
              reloadConfig();
              showResult('OpenCode overlay written successfully.');
            } catch (err) {
              showResult(`Error: ${err.message}`);
            }
            setOverlayPreview(null);
          }
        },
        setDescription,
      }),
    );
  }

  const items = [
    { label: 'Apply OpenCode overlay', value: 'apply', description: 'Preview the OpenCode overlay agents that would be generated.' },
    { label: 'Uninstall gsr', value: 'uninstall', description: 'Remove gsr from this project (overlay + router/ with backup).' },
  ];

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Settings'),
    h(Text, null, ''),
    h(Menu, {
      items,
      onSelect: async (value) => {
        if (value === '__back__') { router.pop(); return; }

        if (value === 'apply') {
          try {
            const mod = await import('../../../router-config.js');
            const report = mod.applyOpenCodeOverlayCommand({ apply: false, configPath });
            const agentCount = Object.keys(report.agents).length;
            const lines = [`OpenCode overlay: ${agentCount} agent(s)`, ''];
            for (const [name, agent] of Object.entries(report.agents)) {
              lines.push(`  ${name} — ${agent.description}`);
            }
            setOverlayPreview({ lines, report });
          } catch (err) {
            showResult(`Error: ${err.message}`);
          }
          return;
        }

        if (value === 'uninstall') {
          setConfirmUninstall(true);
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
