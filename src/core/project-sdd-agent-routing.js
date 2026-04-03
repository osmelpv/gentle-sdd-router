import path from 'node:path';
import { loadRouterConfig } from '../adapters/opencode/index.js';
import { loadCustomSdds } from './sdd-catalog-io.js';
import { resolveIdentity } from './agent-identity.js';

function pickPrimaryLane(lanes = []) {
  if (!Array.isArray(lanes) || lanes.length === 0) return null;
  return lanes.find((lane) => lane.role === 'primary')
    ?? lanes.find((lane) => lane.role === 'judge')
    ?? lanes[0]
    ?? null;
}

function baseTools() {
  return {
    bash: true,
    edit: true,
    read: true,
    write: true,
  };
}

function fallbackLaneFromActivePreset(config) {
  const activeCatalog = config.catalogs?.[config.active_catalog];
  const activePreset = activeCatalog?.presets?.[config.active_preset];
  if (!activePreset) return null;
  return pickPrimaryLane(activePreset.phases?.orchestrator ?? []);
}

function pickLaneForCustomPhase(config, sddName, phaseName) {
  const matchingCatalog = config.catalogs?.[sddName];
  if (matchingCatalog) {
    const presetName = matchingCatalog.active_preset ?? Object.keys(matchingCatalog.presets ?? {})[0];
    const preset = matchingCatalog.presets?.[presetName];
    const phaseLane = pickPrimaryLane(preset?.phases?.[phaseName] ?? []);
    if (phaseLane?.target) return { lane: phaseLane, source: `${sddName}/${presetName}/${phaseName}`, preset };

    const orchestratorLane = pickPrimaryLane(preset?.phases?.orchestrator ?? []);
    if (orchestratorLane?.target) return { lane: orchestratorLane, source: `${sddName}/${presetName}/orchestrator`, preset };
  }

  const activeCatalog = config.catalogs?.[config.active_catalog];
  const activePreset = activeCatalog?.presets?.[config.active_preset];
  const activeSamePhase = pickPrimaryLane(activePreset?.phases?.[phaseName] ?? []);
  if (activeSamePhase?.target) return { lane: activeSamePhase, source: `${config.active_catalog}/${config.active_preset}/${phaseName}`, preset: activePreset };

  const fallback = fallbackLaneFromActivePreset(config);
  if (fallback?.target) return { lane: fallback, source: `${config.active_catalog}/${config.active_preset}/orchestrator`, preset: activePreset };

  return { lane: null, source: null, preset: activePreset ?? null };
}

function projectPhasePrompt(identityPrompt, sddName, phaseName, phaseContractPath, rolesDir) {
  const prefix = identityPrompt ? `${identityPrompt}\n\n` : '';
  return `${prefix}You are the executor for project SDD '${sddName}' phase '${phaseName}', not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read the phase contract at ${phaseContractPath}. If relevant, inspect role contracts in ${rolesDir}. Follow the contracts exactly.`;
}

export function getProjectSddAgentSpecs(configPath, options = {}) {
  const config = loadRouterConfig(configPath);
  const routerDir = path.dirname(configPath);
  const catalogsDir = path.join(routerDir, 'catalogs');
  const cwd = options.cwd ?? process.cwd();
  const sdds = loadCustomSdds(catalogsDir, { includeGlobal: false });

  const specs = [];

  for (const sdd of sdds) {
    for (const phaseName of Object.keys(sdd.phases ?? {})) {
      const { lane, source, preset } = pickLaneForCustomPhase(config, sdd.name, phaseName);
      if (!lane?.target) continue;

      const identity = resolveIdentity(preset ?? {}, { cwd });
      const phaseContractPath = path.join(catalogsDir, sdd.name, 'contracts', 'phases', `${phaseName}.md`);
      const rolesDir = path.join(catalogsDir, sdd.name, 'contracts', 'roles');

      specs.push({
        name: `sdd-${sdd.name}-${phaseName}`,
        phase: phaseName,
        target: lane.target,
        prompt: projectPhasePrompt(identity.prompt, sdd.name, phaseName, phaseContractPath, rolesDir),
        hidden: true,
        mode: 'subagent',
        sdd: sdd.name,
        variant: source ?? 'project-default',
        description: `gsr project sdd ${sdd.name}/${phaseName} via ${source ?? 'default-routing'}`,
        tools: baseTools(),
      });
    }
  }

  return specs;
}
