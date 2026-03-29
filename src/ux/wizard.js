import * as p from '@clack/prompts';
import { resolveControllerLabel } from '../core/controller.js';

/**
 * Run the interactive wizard.
 * @param {object} context - { configPath, routerDir, config, version }
 */
export async function runWizard(context) {
  p.intro('gsr — Gentle SDD Router');

  if (!context.configPath) {
    // State A: No router config found
    return await wizardFreshProject(context);
  }

  if (context.version < 4) {
    // State B: Outdated config
    return await wizardOutdatedConfig(context);
  }

  // State C: Current config
  return await wizardCurrentConfig(context);
}

async function wizardFreshProject(context) {
  const action = await p.select({
    message: 'No router config found in this directory.',
    options: [
      { value: 'install', label: 'Install', hint: 'Set up gsr in this project' },
      { value: 'help', label: 'Help', hint: 'Show available commands' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.outro('Bye!');
    return null;
  }

  return action; // 'install' or 'help'
}

async function wizardOutdatedConfig(context) {
  const controllerLabel = resolveControllerLabel(context.config);

  p.note(
    `Config version: ${context.version} (latest: 4)\nController: ${controllerLabel}`,
    'Project Status',
  );

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update', hint: 'Migrate config to the latest version' },
      { value: 'status', label: 'Status', hint: 'Show current router state' },
      { value: 'manage', label: 'Manage', hint: 'Configure profiles and presets' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.outro('Bye!');
    return null;
  }

  return action;
}

async function wizardCurrentConfig(context) {
  const controllerLabel = resolveControllerLabel(context.config);
  const activePreset = context.config?.active_preset || 'unknown';

  p.note(
    `Active preset: ${activePreset}\nController: ${controllerLabel}\nVersion: ${context.version}`,
    'Project Status',
  );

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'use', label: 'Switch preset', hint: 'Change the active routing preset' },
      { value: 'status', label: 'Status', hint: 'Show detailed router state' },
      { value: 'reload', label: 'View routes', hint: 'Show resolved routes for current preset' },
      { value: 'list', label: 'List presets', hint: 'Show all available presets' },
      { value: 'update', label: 'Check updates', hint: 'Check for config migrations' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.outro('Bye!');
    return null;
  }

  // Special flow for "use" — need to pick a preset
  if (action === 'use') {
    return await wizardSwitchPreset(context);
  }

  return action;
}

async function wizardSwitchPreset(context) {
  // Get available presets from config
  const presets = [];
  const catalogs = context.config?.catalogs || {};
  for (const [catalogName, catalog] of Object.entries(catalogs)) {
    const catalogPresets = catalog?.presets || {};
    for (const [presetName, preset] of Object.entries(catalogPresets)) {
      const isActive = presetName === context.config?.active_preset;
      presets.push({
        value: presetName,
        label: `${presetName}${isActive ? ' (active)' : ''}`,
        hint: preset?.availability || '',
      });
    }
  }

  if (presets.length === 0) {
    p.log.warn('No presets found.');
    return null;
  }

  const selected = await p.select({
    message: 'Select a preset to activate:',
    options: presets,
  });

  if (p.isCancel(selected)) {
    return null;
  }

  return { command: 'use', preset: selected };
}
