/**
 * SDD Detail Screen — shows phases, roles, and trigger declarations for a selected SDD.
 *
 * Shows:
 *   - SDD name and description
 *   - All phases with intent and execution type (plus invoke target if present)
 *   - SDD-scoped role names
 *   - Trigger fields if present
 *   - Navigation to phase/role editors
 *   - ESC returns to sdd-list
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

// ─── Pure Helpers (exported for testability) ──────────────────────────────────

/**
 * Format an invoke declaration into a human-readable string.
 * Returns null when invoke is null or absent.
 *
 * @param {object|null} invoke - Phase invoke object from sdd.yaml
 * @returns {string|null}
 */
export function formatPhaseInvoke(invoke) {
  if (!invoke) return null;
  const target = `${invoke.catalog}/${invoke.sdd}`;
  const awaitStr = `await: ${invoke.await}`;
  const payloadStr = invoke.payload_from ? ` [payload: ${invoke.payload_from}]` : '';
  return `→ invokes ${target} (${awaitStr}${payloadStr})`;
}

export function SddDetailScreen({
  router,
  configPath,
  setDescription,
  showResult,
  selectedSdd,
  setSelectedSdd,
}) {
  const [sdd, setSdd] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedSdd) {
      setError('No SDD selected.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
        const { loadCustomSdd } = await import('../../../core/sdd-catalog-io.js');
        const loaded = loadCustomSdd(catalogsDir, selectedSdd);
        setSdd(loaded);

        // Load SDD-scoped role contracts
        const rolesDir = pathMod.join(catalogsDir, selectedSdd, 'contracts', 'roles');
        let roleFiles = [];
        if (fsMod.existsSync(rolesDir)) {
          try {
            roleFiles = fsMod.readdirSync(rolesDir).filter(f => f.endsWith('.md'));
          } catch { /* ignore */ }
        }
        setRoles(roleFiles.map(f => f.replace('.md', '')));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedSdd, configPath]);

  useInput((input, key) => {
    if (key.escape) {
      router.pop();
    }
  });

  if (loading) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { color: colors.subtext }, 'Loading SDD...'),
    );
  }

  if (error) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Custom SDD Detail'),
      h(Text, { color: colors.red }, `Error: ${error}`),
    );
  }

  const phaseNames = Object.keys(sdd.phases);

  const items = [
    { label: 'Edit phases', value: 'phases', description: 'Add, edit, or delete phases for this SDD.' },
    { label: 'Manage roles', value: 'roles', description: 'Create or delete SDD-scoped role contracts.' },
  ];

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, `SDD: ${sdd.name}`),
    sdd.description ? h(Text, { color: colors.subtext }, sdd.description) : null,
    h(Text, null, ''),
    h(Text, { bold: true }, `Phases (${phaseNames.length}):`),
    ...phaseNames.flatMap(phaseName => {
      const phase = sdd.phases[phaseName];
      const invokeStr = formatPhaseInvoke(phase.invoke);
      return [
        h(Text, { key: phaseName },
          `  ${phaseName}: ${phase.intent} [${phase.mode ?? 'single'} / ${phase.agent_execution ?? phase.execution ?? 'sequential'}${phase.radar ? ' / radar' : ''}]`
        ),
        invokeStr
          ? h(Text, { key: `${phaseName}-invoke`, color: colors.subtext }, `    ${invokeStr}`)
          : null,
      ].filter(Boolean);
    }),
    h(Text, null, ''),
    roles.length > 0 ? h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, `Roles (${roles.length}):`),
      ...roles.map(role => h(Text, { key: role }, `  ${role}`)),
      h(Text, null, ''),
    ) : null,
    sdd.triggers && (sdd.triggers.from_sdd || sdd.triggers.trigger_phase) ? h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, 'Triggers:'),
      sdd.triggers.from_sdd ? h(Text, null, `  from_sdd: ${sdd.triggers.from_sdd}`) : null,
      sdd.triggers.trigger_phase ? h(Text, null, `  trigger_phase: ${sdd.triggers.trigger_phase}`) : null,
      sdd.triggers.return_to ? h(Text, null, `  return_to: ${sdd.triggers.return_to}`) : null,
      h(Text, null, ''),
    ) : null,
    h(Menu, {
      items,
      onSelect: (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === 'phases') {
          router.push('sdd-phase-editor');
          return;
        }
        if (value === 'roles') {
          router.push('sdd-role-editor');
          return;
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
