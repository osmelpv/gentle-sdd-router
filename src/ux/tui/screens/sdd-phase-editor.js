/**
 * SDD Phase Editor — CRUD for phases within a custom SDD.
 *
 * Allows:
 *   - Adding a new phase (name + intent + optional invoke config)
 *   - Deleting a phase (warns about broken dependencies)
 *   - ESC returns to sdd-detail
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

// ─── Pure Helpers (exported for testability) ──────────────────────────────────

/**
 * Build an invoke declaration from form input values.
 * Returns null when catalog is empty (no invoke configured).
 *
 * @param {{ catalog: string, sdd: string, payload_from: string, await: boolean, result_field: string }} inputs
 * @returns {object|null}
 */
export function buildInvokeFromInputs({ catalog, sdd, payload_from, await: awaitValue, result_field }) {
  const trimmedCatalog = (catalog ?? '').trim();
  if (!trimmedCatalog) return null;
  const trimmedSdd = (sdd ?? '').trim();
  return {
    catalog: trimmedCatalog,
    sdd: trimmedSdd || trimmedCatalog,
    payload_from: payload_from ?? 'output',
    await: typeof awaitValue === 'boolean' ? awaitValue : true,
    result_field: (result_field ?? '').trim() || null,
  };
}

export function SddPhaseEditor({
  router,
  configPath,
  setDescription,
  showResult,
  selectedSdd,
}) {
  const [sdd, setSdd] = useState(null);
  // view: 'menu' | 'adding-name' | 'adding-intent' | 'adding-invoke-catalog' | 'adding-invoke-sdd' | 'confirming-delete'
  const [view, setView] = useState('menu');
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseIntent, setNewPhaseIntent] = useState('');
  const [invokeCatalog, setInvokeCatalog] = useState('');
  const [invokeSdd, setInvokeSdd] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadSdd = async () => {
    try {
      const pathMod = await import('node:path');
      const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
      const { loadCustomSdd } = await import('../../../core/sdd-catalog-io.js');
      const loaded = loadCustomSdd(catalogsDir, selectedSdd);
      setSdd(loaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSdd(); }, [selectedSdd, configPath]);

  const savePhase = async (intent, invoke) => {
    try {
      const pathMod = await import('node:path');
      const fsMod = await import('node:fs');
      const { stringifyYaml } = await import('../../../core/router.js');
      const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
      const sddYamlPath = pathMod.join(catalogsDir, selectedSdd, 'sdd.yaml');
      const phaseData = { intent };
      if (invoke !== null) phaseData.invoke = invoke;
      const updatedSdd = {
        ...sdd,
        phases: {
          ...sdd.phases,
          [newPhaseName]: phaseData,
        },
      };
      fsMod.writeFileSync(sddYamlPath, stringifyYaml(updatedSdd), 'utf8');
      await loadSdd();
      setView('menu');
      setNewPhaseName('');
      setNewPhaseIntent('');
      setInvokeCatalog('');
      setInvokeSdd('');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      if (view !== 'menu') {
        setView('menu');
        setError(null);
      } else {
        router.pop();
      }
    }
  });

  if (loading) {
    return h(Box, null, h(Text, { color: colors.subtext }, 'Loading phases...'));
  }

  if (error) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Phase Editor'),
      h(Text, { color: colors.red }, `Error: ${error}`),
    );
  }

  const phases = sdd ? Object.keys(sdd.phases) : [];

  // View: adding a phase name
  if (view === 'adding-name') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Add Phase — Name'),
      error ? h(Text, { color: colors.red }, error) : null,
      h(TextInput, {
        placeholder: 'phase-name',
        onSubmit: (value) => {
          const trimmed = value.trim();
          if (!trimmed) { setError('Phase name is required.'); return; }
          if (phases.includes(trimmed)) { setError(`Phase '${trimmed}' already exists.`); return; }
          setNewPhaseName(trimmed);
          setError(null);
          setView('adding-intent');
        },
      }),
    );
  }

  // View: adding a phase intent
  if (view === 'adding-intent') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Add Phase "${newPhaseName}" — Intent`),
      h(TextInput, {
        placeholder: 'Describe what this phase does...',
        onSubmit: (value) => {
          const trimmed = value.trim();
          if (!trimmed) { setError('Intent is required.'); return; }
          setNewPhaseIntent(trimmed);
          setError(null);
          setView('adding-invoke-catalog');
        },
      }),
    );
  }

  // View: adding invoke catalog (optional)
  if (view === 'adding-invoke-catalog') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Add Phase "${newPhaseName}" — Invoke Catalog (optional)`),
      h(Text, { color: colors.subtext }, 'Enter the target catalog slug to invoke, or leave empty to skip.'),
      error ? h(Text, { color: colors.red }, error) : null,
      h(TextInput, {
        placeholder: 'e.g. art-production (leave empty to skip)',
        onSubmit: (value) => {
          setInvokeCatalog(value.trim());
          setError(null);
          if (!value.trim()) {
            // No invoke — save phase now
            savePhase(newPhaseIntent, null);
          } else {
            setView('adding-invoke-sdd');
          }
        },
      }),
    );
  }

  // View: adding invoke sdd (optional, only shown when catalog was filled)
  if (view === 'adding-invoke-sdd') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Add Phase "${newPhaseName}" — Invoke SDD (optional)`),
      h(Text, { color: colors.subtext }, `Catalog: ${invokeCatalog}. Enter the SDD slug or leave empty to use catalog name.`),
      error ? h(Text, { color: colors.red }, error) : null,
      h(TextInput, {
        placeholder: `e.g. ${invokeCatalog} (leave empty to use catalog name)`,
        onSubmit: (value) => {
          setInvokeSdd(value.trim());
          setError(null);
          const invoke = buildInvokeFromInputs({
            catalog: invokeCatalog,
            sdd: value.trim(),
            payload_from: 'output',
            await: true,
            result_field: '',
          });
          savePhase(newPhaseIntent, invoke);
        },
      }),
    );
  }

  // View: confirm delete with dependency warning
  if (view === 'confirming-delete' && pendingDelete) {
    const dependents = phases.filter(p =>
      sdd.phases[p].depends_on?.includes(pendingDelete)
    );

    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, `Delete Phase "${pendingDelete}"`),
      dependents.length > 0
        ? h(Text, { color: colors.peach },
            `Warning: ${dependents.join(', ')} depend(s) on this phase.`
          )
        : h(Text, { color: colors.subtext }, 'No other phases depend on this one.'),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Confirm delete', value: 'confirm', description: 'Permanently delete this phase.' },
          { label: 'Cancel', value: 'cancel', description: 'Keep this phase.' },
        ],
        onSelect: async (value) => {
          if (value === 'cancel') { setView('menu'); setPendingDelete(null); return; }
          // Guard: cannot delete the last remaining phase (sdd.yaml requires >= 1 phase)
          if (phases.length <= 1) {
            setError('Cannot delete the last phase. An SDD must have at least one phase.');
            setView('menu');
            setPendingDelete(null);
            return;
          }
          try {
            const pathMod = await import('node:path');
            const fsMod = await import('node:fs');
            const { stringifyYaml } = await import('../../../core/router.js');
            const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
            const sddYamlPath = pathMod.join(catalogsDir, selectedSdd, 'sdd.yaml');
            const updatedPhases = { ...sdd.phases };
            delete updatedPhases[pendingDelete];
            const updatedSdd = { ...sdd, phases: updatedPhases };
            fsMod.writeFileSync(sddYamlPath, stringifyYaml(updatedSdd), 'utf8');
            await loadSdd();
            setView('menu');
            setPendingDelete(null);
          } catch (err) {
            setError(err.message);
            setView('menu');
          }
        },
        setDescription,
      }),
    );
  }

  // Main menu view
  const menuItems = phases.map(phaseName => ({
    label: phaseName,
    value: `delete:${phaseName}`,
    tag: sdd.phases[phaseName].execution,
    description: `${sdd.phases[phaseName].intent} — Select to delete.`,
  }));

  menuItems.push({
    label: '+ Add phase',
    value: '__add__',
    description: 'Add a new phase to this SDD.',
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, `Phases — ${selectedSdd}`),
    h(Text, { color: colors.subtext }, 'Select a phase to delete, or add a new phase.'),
    h(Text, null, ''),
    error ? h(Text, { color: colors.red }, error) : null,
    h(Menu, {
      items: menuItems,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__add__') { setView('adding-name'); return; }
        if (value.startsWith('delete:')) {
          setPendingDelete(value.slice(7));
          setView('confirming-delete');
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
