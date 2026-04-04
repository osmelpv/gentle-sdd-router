/**
 * SDD Role Editor — CRUD for SDD-scoped role contracts.
 *
 * Allows:
 *   - Adding a new role contract (.md file)
 *   - Deleting a role contract
 *   - Shows inline error for duplicate role names
 *   - ESC returns to sdd-detail
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

const ROLE_TEMPLATE = (roleName) => `---
name: ${roleName}
description: >
  {Role description placeholder}
metadata:
  author: user
  version: "1.0"
  scope: sdd
---

## Role Definition

{Describe what this role does within the SDD workflow.}

## Input Contract

- {What this role receives}

## Output Contract

- {What this role produces}
`;

export function SddRoleEditor({
  router,
  configPath,
  setDescription,
  showResult,
  selectedSdd,
}) {
  const [roles, setRoles] = useState([]);
  const [view, setView] = useState('menu'); // 'menu' | 'adding'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadRoles = async () => {
    try {
      const pathMod = await import('node:path');
      const fsMod = await import('node:fs');
      const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
      const rolesDir = pathMod.join(catalogsDir, selectedSdd, 'contracts', 'roles');
      let roleFiles = [];
      if (fsMod.existsSync(rolesDir)) {
        roleFiles = fsMod.readdirSync(rolesDir).filter(f => f.endsWith('.md'));
      }
      setRoles(roleFiles.map(f => f.replace('.md', '')));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoles(); }, [selectedSdd, configPath]);

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
    return h(Box, null, h(Text, { color: colors.subtext }, 'Loading roles...'));
  }

  // View: adding a role
  if (view === 'adding') {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.lavender }, 'Create Role Contract — Name'),
      h(Text, { color: colors.subtext }, 'Enter a slug name for the role.'),
      h(Text, null, ''),
      error ? h(Text, { color: colors.red }, error) : null,
      h(TextInput, {
        placeholder: 'my-role',
        onSubmit: async (value) => {
          const trimmed = value.trim();
          if (!trimmed) { setError('Role name is required.'); return; }
          if (roles.includes(trimmed)) {
            setError(`Role '${trimmed}' already exists.`);
            return;
          }
          try {
            const pathMod = await import('node:path');
            const fsMod = await import('node:fs');
            const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
            const rolePath = pathMod.join(catalogsDir, selectedSdd, 'contracts', 'roles', `${trimmed}.md`);
            fsMod.mkdirSync(pathMod.dirname(rolePath), { recursive: true });
            const template = ROLE_TEMPLATE(trimmed);
            const tempPath = `${rolePath}.${process.pid}.${Date.now()}.tmp`;
            fsMod.writeFileSync(tempPath, template, 'utf8');
            fsMod.renameSync(tempPath, rolePath);
            await loadRoles();
            setView('menu');
            setError(null);
          } catch (err) {
            setError(err.message);
          }
        },
      }),
    );
  }

  // Main menu
  const menuItems = roles.map(roleName => ({
    label: roleName,
    value: `delete:${roleName}`,
    description: `Catalog-scoped role contract. Select to delete.`,
  }));

  menuItems.push({
    label: '+ Create role',
    value: '__add__',
    description: 'Create a new catalog-scoped role contract.',
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, `Roles — ${selectedSdd}`),
    h(Text, { color: colors.subtext }, roles.length === 0
      ? 'No role contracts yet.'
      : `${roles.length} role contract(s).`
    ),
    h(Text, null, ''),
    error ? h(Text, { color: colors.red }, error) : null,
    h(Menu, {
      items: menuItems,
      onSelect: async (value) => {
        if (value === '__back__') { router.pop(); return; }
        if (value === '__add__') { setView('adding'); return; }
        if (value.startsWith('delete:')) {
          const roleName = value.slice(7);
          try {
            const pathMod = await import('node:path');
            const fsMod = await import('node:fs');
            const catalogsDir = pathMod.join(pathMod.dirname(configPath), 'catalogs');
            const rolePath = pathMod.join(catalogsDir, selectedSdd, 'contracts', 'roles', `${roleName}.md`);
            if (fsMod.existsSync(rolePath)) {
              fsMod.unlinkSync(rolePath);
            }
            await loadRoles();
          } catch (err) {
            setError(err.message);
          }
        }
      },
      setDescription,
      showBack: true,
    }),
  );
}
