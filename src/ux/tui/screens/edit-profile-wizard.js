import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SplitPanelEdit } from '../components/split-panel-edit.js';
import { Menu } from '../components/menu.js';
import { colors } from '../theme.js';

const h = React.createElement;

export function EditProfileWizard({ config, configPath, router, setDescription, showResult, reloadConfig, profileName, catalogName }) {
  const catalog = config?.catalogs?.[catalogName || config?.active_catalog || 'default'];
  const preset = catalog?.presets?.[profileName];
  const [phases, setPhases] = useState(() => JSON.parse(JSON.stringify(preset?.phases || {})));
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const routerDir = configPath ? configPath.replace(/\/router\.yaml$/, '') : null;

  const handlePhasesChange = (newPhases) => {
    setPhases(newPhases);
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      const mod = await import('../../../router-config.js');
      mod.updateProfile(profileName, phases, routerDir);
      await reloadConfig();
      setHasChanges(false);
      showResult(`Profile '${profileName}' updated successfully!`);
    } catch (err) {
      showResult(`Error saving: ${err.message}`);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      setConfirmDiscard(true);
    } else {
      router.pop();
    }
  };

  if (confirmDiscard) {
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: colors.red }, 'Discard unsaved changes?'),
      h(Text, { color: colors.subtext }, 'You modified this profile but have not saved yet.'),
      h(Text, null, ''),
      h(Menu, {
        items: [
          { label: 'Keep editing', value: 'stay', description: 'Return to the editor.' },
          { label: 'Discard changes', value: 'discard', description: 'Lose the current draft and go back.' },
        ],
        onSelect: (value) => {
          if (value === 'stay' || value === '__back__') { setConfirmDiscard(false); return; }
          router.pop();
        },
        setDescription,
      }),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: colors.lavender }, `Editing: ${profileName}`),
    h(Text, { color: colors.subtext }, hasChanges ? 'Unsaved changes. Navigate to "Save" to persist.' : 'Select a phase to edit its lanes.'),
    h(Text, null, ''),
    h(SplitPanelEdit, {
      phases,
      onPhasesChange: handlePhasesChange,
      onSave: handleSave,
      onCancel: handleCancel,
      setDescription,
      hasChanges,
    }),
  );
}
