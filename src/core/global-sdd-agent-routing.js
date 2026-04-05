import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './router.js';
import { loadV4Profiles, assembleV4Config } from './router-v4-io.js';
import { resolveIdentity } from './agent-identity.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(MODULE_DIR, '..', '..');
const PLUGIN_ROUTER_DIR = path.join(PLUGIN_ROOT, 'router');
const PLUGIN_CONFIG_PATH = path.join(PLUGIN_ROUTER_DIR, 'router.yaml');
const DEFAULT_PRESET = 'local-hybrid';
const DEFAULT_DEBUG_PRESET = 'sdd-debug-mono';

const STANDARD_PHASE_AGENT_NAMES = {
  orchestrator: 'sdd-orchestrator',
  explore: 'sdd-explore',
  propose: 'sdd-propose',
  spec: 'sdd-spec',
  design: 'sdd-design',
  tasks: 'sdd-tasks',
  apply: 'sdd-apply',
  verify: 'sdd-verify',
  archive: 'sdd-archive',
};

/**
 * v2 debug phase → role mappings.
 * Only delegated phases get agent specs; orchestrator-retained phases
 * (collect-and-diagnose, finalize) are handled by the orchestrator lane.
 */
const DEBUG_PHASE_ROLE_NAMES = {
  'analyze-area': 'debug-analyst',
  'implant-logs': 'log-implanter',
  'apply-fixes': 'fix-implementer',
};

function loadPluginConfig() {
  const raw = fs.readFileSync(PLUGIN_CONFIG_PATH, 'utf8');
  const core = parseYaml(raw);
  const profiles = loadV4Profiles(PLUGIN_ROUTER_DIR, { includeGlobal: false });
  return assembleV4Config(core, profiles);
}

function getPreset(config, presetName) {
  for (const [catalogName, catalog] of Object.entries(config.catalogs ?? {})) {
    const preset = catalog.presets?.[presetName];
    if (preset) return { catalogName, preset };
  }
  throw new Error(`Preset '${presetName}' not found in plugin profiles.`);
}

function pickPrimaryLane(lanes = []) {
  if (!Array.isArray(lanes) || lanes.length === 0) return null;
  return lanes.find((lane) => lane.role === 'primary')
    ?? lanes.find((lane) => lane.role === 'judge')
    ?? lanes[0]
    ?? null;
}

function executorPrompt(phase) {
  return `You are an SDD executor for the ${phase} phase, not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read your skill file at ~/.config/opencode/skills/sdd-${phase}/SKILL.md and follow it exactly.`;
}

function orchestratorPrompt() {
  return 'You are the SDD orchestrator. Coordinate sub-agents, never do work inline. Delegate substantial work, synthesize results, and preserve the non-executing/report-only boundary. If a local orchestrator skill exists, follow it.';
}

/**
 * Debug v2 prompt — references skill files for delegated phases and
 * falls back to phase/role contracts when no skill exists.
 */
function debugPrompt(phaseName) {
  const roleName = DEBUG_PHASE_ROLE_NAMES[phaseName];
  const skillMap = {
    'analyze-area': '~/.config/opencode/skills/sdd-debug-analyze/SKILL.md',
    'implant-logs': '~/.config/opencode/skills/sdd-debug-implant/SKILL.md',
    'apply-fixes': '~/.config/opencode/skills/sdd-debug-apply/SKILL.md',
  };
  const skillPath = skillMap[phaseName];
  const phasePath = path.join(PLUGIN_ROUTER_DIR, 'catalogs', 'sdd-debug', 'contracts', 'phases', `${phaseName}.md`);
  const rolePath = path.join(PLUGIN_ROUTER_DIR, 'catalogs', 'sdd-debug', 'contracts', 'roles', `${roleName}.md`);

  if (skillPath) {
    return `You are the executor for the sdd-debug phase '${phaseName}', not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read your skill file at ${skillPath} and follow it exactly. Phase contract: ${phasePath}. Role contract: ${rolePath}.`;
  }

  return `You are the executor for the sdd-debug phase '${phaseName}', not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read the phase contract at ${phasePath} and the role contract at ${rolePath} and follow them exactly.`;
}

function baseTools(orchestrator = false) {
  if (orchestrator) {
    return {
      bash: true,
      delegate: true,
      delegation_list: true,
      delegation_read: true,
      edit: true,
      read: true,
      write: true,
    };
  }

  return {
    bash: true,
    edit: true,
    read: true,
    write: true,
  };
}

function buildSpec({ name, phase, target, prompt, sdd, variant, permissions, hidden = true, description, mode = 'subagent' }) {
  return {
    name,
    phase,
    target,
    prompt,
    hidden,
    mode,
    sdd,
    variant,
    description,
    tools: permissions ?? baseTools(mode === 'primary'),
  };
}

export function getGlobalSddAgentSpecs(options = {}) {
  const presetName = options.preset ?? DEFAULT_PRESET;
  const debugPresetName = options.debugPreset ?? DEFAULT_DEBUG_PRESET;
  const cwd = options.cwd ?? process.cwd();
  const config = loadPluginConfig();

  const { preset } = getPreset(config, presetName);
  const identity = resolveIdentity(preset, { cwd });

  const specs = [];

  // Standard SDD executors + orchestrator
  for (const [phaseName, agentName] of Object.entries(STANDARD_PHASE_AGENT_NAMES)) {
    const lanes = preset.phases?.[phaseName];
    const lane = pickPrimaryLane(lanes ?? []);
    if (!lane?.target) continue;

    specs.push(buildSpec({
      name: agentName,
      phase: phaseName,
      target: lane.target,
      prompt: phaseName === 'orchestrator' ? orchestratorPrompt() : executorPrompt(phaseName),
      sdd: 'sdd-orchestrator',
      variant: presetName,
      permissions: phaseName === 'orchestrator' ? baseTools(true) : baseTools(false),
      hidden: phaseName !== 'orchestrator',
      mode: phaseName === 'orchestrator' ? 'primary' : 'subagent',
      description: `gsr global ${agentName} via ${presetName} [${identity.persona ?? 'neutral'}]`,
    }));
  }

  // Debug SDD executors — decoupled: failure here does NOT block standard SDD agents
  try {
    const { preset: debugPreset } = getPreset(config, debugPresetName);
    for (const phaseName of Object.keys(DEBUG_PHASE_ROLE_NAMES)) {
      const lane = pickPrimaryLane(debugPreset.phases?.[phaseName] ?? []);
      if (!lane?.target) continue;

      specs.push(buildSpec({
        name: `sdd-debug-${phaseName}`,
        phase: phaseName,
        target: lane.target,
        prompt: debugPrompt(phaseName),
        sdd: 'sdd-debug',
        variant: debugPresetName,
        permissions: baseTools(false),
        hidden: true,
        mode: 'subagent',
        description: `gsr global sdd-debug ${phaseName} via ${debugPresetName}`,
      }));
    }
  } catch {
    // Debug preset not found or malformed — standard SDD agents still work
  }

  return specs;
}

export { DEFAULT_PRESET, DEFAULT_DEBUG_PRESET, STANDARD_PHASE_AGENT_NAMES, DEBUG_PHASE_ROLE_NAMES, PLUGIN_ROUTER_DIR };
