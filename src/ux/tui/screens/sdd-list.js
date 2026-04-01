/**
 * SDD List Screen — lists all custom SDD catalogs with navigation to detail.
 *
 * Shows:
 *   - Each SDD name and description
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
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const pathMod = await import('node:path');
        const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
        const { loadCustomSdds } = await import('../../../core/sdd-catalog-io.js');
        const result = loadCustomSdds(catalogsDir);
        setSdds(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
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

  if (error) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Custom SDDs'),
      h(Text, { color: colors.red }, `Error: ${error}`),
    );
  }

  const items = sdds.map(sdd => ({
    label: sdd.name,
    value: sdd.name,
    tag: `${Object.keys(sdd.phases).length} phase(s)`,
    description: sdd.description || `Custom SDD: ${sdd.name}`,
  }));

  if (items.length === 0) {
    items.push({
      label: 'No custom SDDs — Create one',
      value: '__create__',
      description: 'Create a new custom SDD catalog.',
    });
  } else {
    items.push({
      label: 'Create new SDD',
      value: '__create__',
      description: 'Create a new custom SDD catalog.',
    });
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, 'Custom SDDs'),
    h(Text, { color: colors.subtext }, sdds.length === 0
      ? 'No custom SDDs found. Create one to get started.'
      : `${sdds.length} custom SDD(s) defined.`
    ),
    h(Text, null, ''),
    h(Menu, {
      items,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__create__') {
          router.push('sdd-create-wizard');
          return;
        }
        if (setSelectedSdd) setSelectedSdd(value);
        router.push('sdd-detail');
      },
      setDescription,
      showBack: true,
    }),
  );
}
