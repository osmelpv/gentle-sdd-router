/**
 * SDD List Screen — lists custom SDDs with navigation to detail.
 *
 * Shows:
 *   - Each SDD name and description (project-local only)
 *   - Empty state when no SDDs exist
 *   - Option to create a new SDD
 *   - Navigate to sdd-detail on selection
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function SddListScreen({
  router,
  configPath,
  setDescription,
  showResult,
  setSelectedSdd,
}) {
  const [sdds, setSdds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
        
        if (!fsMod.existsSync(catalogsDir)) {
          setSdds([]);
          setLoading(false);
          return;
        }
        
        const entries = fsMod.readdirSync(catalogsDir);
        const loadedSdds = [];
        
        for (const entry of entries) {
          const entryPath = pathMod.join(catalogsDir, entry);
          const stat = fsMod.statSync(entryPath);
          if (!stat.isDirectory()) continue;
          
          const sddYamlPath = pathMod.join(entryPath, 'sdd.yaml');
          if (!fsMod.existsSync(sddYamlPath)) continue;
          
          const raw = fsMod.readFileSync(sddYamlPath, 'utf8');
          const { parseYaml } = await import('../../../core/router.js');
          const parsed = parseYaml(raw);
          loadedSdds.push({
            name: entry,
            description: parsed.description || '',
            path: sddYamlPath,
          });
        }
        
        setSdds(loadedSdds);
      } catch (err) {
        console.error('Error loading SDDs:', err);
        setSdds([]);
      }
      setLoading(false);
    })();
  }, [configPath]);

  useInput((input, key) => {
    if (key.escape) {
      router.pop();
    }
  });

  if (loading) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.subtext }, 'Loading custom SDDs...'),
    );
  }

  const items = sdds.map(sdd => ({
    label: sdd.name,
    value: sdd.name,
    description: sdd.description || 'No description',
  }));

  items.push({ label: '+ Create new SDD', value: '__create__', description: 'Start the SDD creation wizard.' });

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Custom SDDs'),
    h(Text, { color: colors.subtext }, `${sdds.length} SDD(s) in this project.`),
    h(Text, null, ''),
    h(Menu, {
      items,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__create__') {
          router.push('sdd-create-wizard');
          return;
        }
        setSelectedSdd(value);
        router.push('sdd-detail');
      },
      setDescription,
      showBack: true,
    }),
  );
}
