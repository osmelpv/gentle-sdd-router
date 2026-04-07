import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(MODULE_DIR, '..', '..');

function scopeFromFilePath(filePath) {
  if (!filePath) return 'project';
  return filePath.startsWith(PLUGIN_ROOT) ? 'global' : 'project';
}

function publicSddLabelFromSddName(sddName) {
  return sddName === 'default' ? 'agent-orchestrator' : sddName;
}

export function getPublicPresetMetadata(config) {
  const rows = [];
  const activePreset = config?.active_preset ?? config?.active_profile ?? null;
  const sourceMap = config?._v4Source?.profileMap ?? new Map();

  for (const [sddName, sddGroup] of Object.entries(config?.catalogs ?? {})) {
    for (const [presetName, preset] of Object.entries(sddGroup?.presets ?? {})) {
      const sourceInfo = sourceMap.get(presetName);
      const filePath = sourceInfo?.filePath ?? null;
      rows.push({
        name: presetName,
        sdd: preset?.sdd ?? sourceInfo?.sddName ?? publicSddLabelFromSddName(sddName),
        scope: scopeFromFilePath(filePath),
        visibility: preset.hidden === true || sddGroup?.enabled === false ? 'hidden' : 'visible',
        phases: Object.keys(preset?.phases ?? {}).length,
        legacyCatalogName: sddName,
        filePath,
        preset,
      });
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function getActivePublicPresetMetadata(config) {
  const activePreset = config?.active_preset ?? config?.active_profile ?? null;
  if (!activePreset) return null;
  return getPublicPresetMetadata(config).find((row) => row.name === activePreset) ?? null;
}

export function findPresetOwner(config, presetName) {
  if (!presetName) return null;
  for (const [sddName, sddGroup] of Object.entries(config?.catalogs ?? {})) {
    if (sddGroup?.presets?.[presetName]) {
      return {
        catalogName: sddName,
        preset: sddGroup.presets[presetName],
      };
    }
  }
  return null;
}

export function getActivePresetOwner(config) {
  const presetName = config?.active_preset ?? config?.active_profile ?? null;
  return findPresetOwner(config, presetName);
}
