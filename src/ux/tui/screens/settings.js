import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';
import { PLATFORMS, detectInstalledPlatforms } from '../platform-detector.js';

const h = React.createElement;

// ─── AutoFallback toggle sub-view ─────────────────────────────────────────────

/**
 * Read the autoFallback setting from router.yaml.
 * Returns false (default) if not found or on error.
 *
 * @param {string} configPath
 * @returns {Promise<boolean>}
 */
async function readAutoFallbackSetting(configPath) {
  try {
    if (!configPath) return false;
    const [fsMod, routerMod] = await Promise.all([
      import('node:fs'),
      import('../../../core/router.js'),
    ]);
    const fsSync = fsMod.default ?? fsMod;
    const raw = fsSync.readFileSync(configPath, 'utf8');
    const parsed = routerMod.parseYaml(raw);
    return parsed?.settings?.autoFallback === true;
  } catch {
    return false;
  }
}

/**
 * Persist the autoFallback setting to router.yaml under settings.autoFallback.
 *
 * @param {string} configPath
 * @param {boolean} value
 */
async function saveAutoFallbackSetting(configPath, value) {
  if (!configPath) return;

  const fsMod = await import('node:fs');
  const fsSync = fsMod.default ?? fsMod;
  const raw = fsSync.readFileSync(configPath, 'utf8');
  const lines = raw.split('\n');

  const autoFallbackLine = `  autoFallback: ${value}`;

  const settingsIdx = lines.findIndex(l => /^settings\s*:/.test(l));

  if (settingsIdx >= 0) {
    // Find existing autoFallback line under settings:
    const autoFbIdx = lines.findIndex(
      (l, i) => i > settingsIdx && /^\s+autoFallback\s*:/.test(l)
    );
    if (autoFbIdx >= 0) {
      lines[autoFbIdx] = autoFallbackLine;
    } else {
      lines.splice(settingsIdx + 1, 0, autoFallbackLine);
    }
  } else {
    // Append settings block
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    lines.push('settings:');
    lines.push(autoFallbackLine);
    lines.push('');
  }

  fsSync.writeFileSync(configPath, lines.join('\n'), 'utf8');
}

/**
 * AutoFallback toggle view.
 */
function AutoFallbackView({ configPath, showResult, onBack }) {
  const [autoFallback, setAutoFallback] = useState(null); // null = loading

  useEffect(() => {
    readAutoFallbackSetting(configPath).then(val => setAutoFallback(val));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((input, key) => {
    if (autoFallback === null) return;

    if (key.escape) {
      onBack();
      return;
    }

    if (input === ' ' || key.return) {
      const newValue = !autoFallback;
      setAutoFallback(newValue);
      saveAutoFallbackSetting(configPath, newValue)
        .then(() => showResult(`Auto-fallback ${newValue ? 'enabled' : 'disabled'}.`))
        .catch(err => showResult(`Error saving auto-fallback: ${err.message}`));
      onBack();
      return;
    }
  });

  if (autoFallback === null) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.subtext0 }, 'Loading…')
    );
  }

  const checkbox = autoFallback ? '[✓]' : '[ ]';

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Auto-fallback Setting'),
    h(Text, null, ''),
    h(Box, null,
      h(Text, { color: autoFallback ? colors.green : colors.text }, checkbox + ' '),
      h(Text, { bold: true }, 'Auto-fallback (skip dialog on model failure)'),
    ),
    h(Text, null, ''),
    h(Text, { color: colors.subtext0 },
      autoFallback
        ? 'When on, gsr switches to the next fallback silently.'
        : 'When off, a dialog appears to let you choose which fallback to promote.'
    ),
    h(Text, null, ''),
    h(Text, { color: colors.subtext0 }, 'Space/Enter: toggle  Esc: cancel'),
  );
}

// ─── Platforms sub-view ───────────────────────────────────────────────────────

function PlatformsView({ configPath, showResult, onBack }) {
  const [activePlatforms, setActivePlatforms] = useState(null); // null = loading
  const [detectedPlatforms, setDetectedPlatforms] = useState([]);
  const [cursor, setCursor] = useState(0);

  // On mount: detect installed + merge with saved overrides from router.yaml
  useEffect(() => {
    const detected = detectInstalledPlatforms();
    setDetectedPlatforms(detected);

    async function loadSaved() {
      let saved = null;
      try {
        if (configPath) {
          const [fsMod, routerMod] = await Promise.all([
            import('node:fs'),
            import('../../../core/router.js'),
          ]);
          const fsSync = fsMod.default ?? fsMod;
          const raw = fsSync.readFileSync(configPath, 'utf8');
          const parsed = routerMod.parseYaml(raw);
          if (Array.isArray(parsed?.settings?.platforms)) {
            saved = parsed.settings.platforms;
          }
        }
      } catch { /* ignore read errors — fall back to detected */ }

      // Merge: detected platforms are active by default; saved overrides if present
      setActivePlatforms(saved !== null ? saved : [...detected]);
    }

    loadSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((input, key) => {
    // Wait until loaded
    if (activePlatforms === null) return;

    if (key.escape) {
      onBack();
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor(c => (c > 0 ? c - 1 : PLATFORMS.length - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setCursor(c => (c < PLATFORMS.length - 1 ? c + 1 : 0));
      return;
    }

    if (input === ' ' || key.return) {
      const platformId = PLATFORMS[cursor].id;
      setActivePlatforms(prev =>
        prev.includes(platformId)
          ? prev.filter(id => id !== platformId)
          : [...prev, platformId]
      );
      return;
    }

    if (input === 's' || input === 'S') {
      // Save and return
      handleSave(configPath, activePlatforms, showResult);
      onBack();
    }
  });

  if (activePlatforms === null) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.subtext0 }, 'Loading platforms…')
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Active Platforms'),
    h(Text, null, ''),
    ...PLATFORMS.map((platform, idx) => {
      const isActive = activePlatforms.includes(platform.id);
      const isDetected = detectedPlatforms.includes(platform.id);
      const isFocused = cursor === idx;
      const checkbox = isActive ? '[✓]' : '[ ]';
      const labelColor = isFocused ? colors.lavender : colors.text;

      return h(Box, { key: platform.id },
        h(Text, { color: isActive ? colors.green : colors.text }, checkbox + ' '),
        h(Text, { color: labelColor, bold: isFocused }, platform.label),
        isDetected
          ? h(Text, { color: colors.peach }, ' (detected)')
          : null
      );
    }),
    h(Text, null, ''),
    h(Text, { color: colors.subtext0 }, 'Space/Enter: toggle  S: save  Esc: cancel'),
  );
}

/**
 * Persist platforms list to router.yaml settings.platforms.
 * Writes YAML block-style sequences for compatibility with the project's custom parseYaml.
 * Runs async so it won't block the TUI thread.
 */
async function handleSave(configPath, platforms, showResult) {
  try {
    if (!configPath) {
      showResult('Cannot save: no config path provided.');
      return;
    }

    const fsMod = await import('node:fs');
    const fsSync = fsMod.default ?? fsMod;
    const raw = fsSync.readFileSync(configPath, 'utf8');
    const lines = raw.split('\n');

    // Build YAML block-sequence lines for the platforms array
    // e.g. ["opencode", "claude-code"] → ["  - opencode", "  - claude-code"]
    const platformsBlock = platforms.length > 0
      ? platforms.map(id => `    - ${id}`)
      : [];

    // Check if settings: block already exists
    const settingsIdx = lines.findIndex(l => /^settings\s*:/.test(l));

    if (settingsIdx >= 0) {
      // Find the existing "platforms:" line under the settings block
      const platformsLineIdx = lines.findIndex(
        (l, i) => i > settingsIdx && /^\s+platforms\s*:/.test(l)
      );

      if (platformsLineIdx >= 0) {
        // Remove old platforms line + any indented child lines below it
        let endIdx = platformsLineIdx + 1;
        while (
          endIdx < lines.length &&
          lines[endIdx].match(/^\s{4,}/) // deeper-indented child lines
        ) {
          endIdx++;
        }
        // Replace with new platforms block
        lines.splice(
          platformsLineIdx,
          endIdx - platformsLineIdx,
          '  platforms:',
          ...platformsBlock
        );
      } else {
        // No platforms line yet — insert after settings:
        lines.splice(settingsIdx + 1, 0, '  platforms:', ...platformsBlock);
      }
    } else {
      // Append settings block at the end
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      lines.push('settings:');
      lines.push('  platforms:');
      for (const line of platformsBlock) {
        lines.push(line);
      }
      lines.push('');
    }

    fsSync.writeFileSync(configPath, lines.join('\n'), 'utf8');
    showResult('Platforms saved.');
  } catch (err) {
    showResult(`Error saving platforms: ${err.message}`);
  }
}

// ─── SettingsScreen ───────────────────────────────────────────────────────────

export function SettingsScreen({ config, configPath, router, setDescription, showResult, reloadConfig, exit }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [overlayPreview, setOverlayPreview] = useState(null); // { lines, report }
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [showAutoFallback, setShowAutoFallback] = useState(false);

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
    if (showPlatforms) {
      // PlatformsView handles its own Esc; this is a safety fallback
      setShowPlatforms(false);
      return;
    }
    if (showAutoFallback) {
      setShowAutoFallback(false);
      return;
    }
    router.pop();
  });

  // Sub-view: platforms manager
  if (showPlatforms) {
    return h(PlatformsView, {
      configPath,
      showResult,
      onBack: () => setShowPlatforms(false),
    });
  }

  // Sub-view: auto-fallback toggle
  if (showAutoFallback) {
    return h(AutoFallbackView, {
      configPath,
      showResult,
      onBack: () => setShowAutoFallback(false),
    });
  }

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
    { label: 'Manage platforms', value: 'platforms', description: 'Toggle active AI coding platforms and their provider mappings.' },
    { label: 'Auto-fallback', value: 'auto-fallback', description: 'When on, gsr switches to the next fallback silently. When off, a dialog appears.' },
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

        if (value === 'platforms') {
          setShowPlatforms(true);
          return;
        }

        if (value === 'auto-fallback') {
          setShowAutoFallback(true);
          return;
        }

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
