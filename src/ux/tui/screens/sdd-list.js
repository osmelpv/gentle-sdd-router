/**
 * SDD List Screen — lists custom SDDs with navigation to detail.
 *
 * Shows:
 *   - Each SDD name and description (project-local only)
 *   - Empty state when no SDDs exist
 *   - Option to create a new SDD
 *   - Navigate to sdd-detail on selection
 *   - Delete SDDs with D key
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
  const [selectedSddName, setSelectedSddName] = useState(null);

  const loadSdds = async () => {
    try {
      const pathMod = await import('node:path');
      const fsMod = await import('node:fs');
      const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
      
      if (!fsMod.existsSync(catalogsDir)) {
        setSdds([]);
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
          path: entryPath,
        });
      }
      
      setSdds(loadedSdds);
    } catch (err) {
      console.error('Error loading SDDs:', err);
      setSdds([]);
    }
  };

  useEffect(() => {
    loadSdds().then(() => setLoading(false));
  }, [configPath]);

  useInput((input, key) => {
    if (key.escape) {
      if (selectedSddName) {
        setSelectedSddName(null);
        return;
      }
      router.pop();
    }
  });

  if (loading) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.subtext }, 'Loading custom SDDs...'),
    );
  }

  if (selectedSddName) {
    const sdd = sdds.find(s => s.name === selectedSddName);
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Custom SDD: ${selectedSddName}`),
      h(Text, { color: colors.subtext }, sdd?.description || 'No description'),
      h(Text, null, ''),
      h(Text, { color: colors.subtext }, 'ENTER = view details | D = delete | ESC = back'),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'View details', value: 'view', description: 'View SDD phases and configuration.' },
          { label: 'Delete SDD', value: 'delete', description: 'Permanently delete this SDD and all its files.' },
        ],
        onSelect: async (value) => {
          if (value === 'view') {
            setSelectedSdd(selectedSddName);
            router.push('sdd-detail');
            setSelectedSddName(null);
            return;
          }
          if (value === 'delete') {
            try {
              const pathMod = await import('node:path');
              const fsMod = await import('node:fs');
              const { deleteCustomSdd } = await import('../../../core/sdd-catalog-io.js');
              const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
              
              deleteCustomSdd(catalogsDir, selectedSddName);
              showResult(`SDD '${selectedSddName}' deleted.`);
              await loadSdds();
              setSelectedSddName(null);
            } catch (err) {
              showResult(`Error: ${err.message}`);
            }
            return;
          }
          setSelectedSddName(null);
        },
        setDescription,
        showBack: true,
      }),
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
    h(Text, { color: colors.subtext }, `${sdds.length} Custom SDD(s) in this project.`),
    h(Text, null, ''),
    h(Text, { color: colors.subtext }, 'ENTER = select | D = quick delete | ESC = back'),
    h(Text, null, ''),
    h(Menu, {
      items,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__create__') {
          router.push('sdd-create-wizard');
          return;
        }
        setSelectedSddName(value);
      },
      onSecondarySelect: async (value) => {
        if (value === '__create__' || value === '__back__') return;
        if (value === '__none__') return;
        
        try {
          const pathMod = await import('node:path');
          const { deleteCustomSdd } = await import('../../../core/sdd-catalog-io.js');
          const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
          
          deleteCustomSdd(catalogsDir, value);
          showResult(`SDD '${value}' deleted.`);
          await loadSdds();
        } catch (err) {
          showResult(`Error: ${err.message}`);
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
