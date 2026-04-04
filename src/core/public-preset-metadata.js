import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(MODULE_DIR, '..', '..');

function scopeFromFilePath(filePath) {
  if (!filePath) return 'project';
  return filePath.startsWith(PLUGIN_ROOT) ? 'global' : 'project';
}

function publicSddLabelFromCatalogName(catalogName) {
  return catalogName === 'default' ? 'agent-orchestrator' : catalogName;
}

export function getPublicPresetMetadata(config) {
  const rows = [];
  const activePreset = config?.active_preset ?? config?.active_profile ?? null;
  const sourceMap = config?._v4Source?.profileMap ?? new Map();

  for (const [catalogName, catalog] of Object.entries(config?.catalogs ?? {})) {
    for (const [presetName, preset] of Object.entries(catalog?.presets ?? {})) {
      const sourceInfo = sourceMap.get(presetName);
      const filePath = sourceInfo?.filePath ?? null;
      rows.push({
        name: presetName,
        sdd: publicSddLabelFromCatalogName(catalogName),
        scope: scopeFromFilePath(filePath),
        visibility: preset.hidden === true || catalog?.enabled === false ? 'hidden' : 'visible',
        active: presetName === activePreset,
        phases: Object.keys(preset?.phases ?? {}).length,
        legacyCatalogName: catalogName,
        filePath,
        preset,
      });
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function getActivePublicPresetMetadata(config) {
  return getPublicPresetMetadata(config).find((row) => row.active) ?? null;
}

export function findPresetOwner(config, presetName) {
  if (!presetName) return null;
  for (const [catalogName, catalog] of Object.entries(config?.catalogs ?? {})) {
    if (catalog?.presets?.[presetName]) {
      return {
        catalogName,
        preset: catalog.presets[presetName],
      };
    }
  }
  return null;
}

export function getActivePresetOwner(config) {
  const presetName = config?.active_preset ?? config?.active_profile ?? null;
  return findPresetOwner(config, presetName);
}
