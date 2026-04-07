import { loadCustomSdd } from './sdd-profile-io.js';

/**
 * Canonical SDD phase list — the universal phase ordering for the pipeline.
 * Matches gentle-ai's phase model (10 phases including propose and debug).
 */
export const CANONICAL_PHASES = [
  'orchestrator',
  'explore',
  'propose',
  'spec',
  'design',
  'tasks',
  'apply',
  'verify',
  'debug',
  'archive',
];

/**
 * Phase metadata — execution defaults, composition rules, and triggers.
 * Used by the TUI wizard, profile validation, and documentation.
 */
export const PHASE_METADATA = {
  orchestrator: {
    description: 'Coordinates the SDD pipeline. Routes tasks, manages context, delegates to sub-agents.',
    alwaysMono: false,
    defaultExecution: 'sequential',
    fixedRoles: ['agent'],
    optionalRoles: ['judge', 'radar'],
    judgeContract: 'Validate delegation decisions and context management.',
  },
  explore: {
    description: 'Investigates the codebase, maps affected areas, compares approaches.',
    alwaysMono: false,
    defaultExecution: 'parallel',
    fixedRoles: ['agent', 'agent'],
    optionalRoles: ['judge', 'radar', 'risk-detector', 'security-auditor'],
    judgeContract: 'Synthesize explorations. Fuse unique findings. Discard redundancy. Use anonymous brainstorming.',
  },
  propose: {
    description: 'Structures a formal proposal from exploration: scope, risk, approach.',
    alwaysMono: false,
    defaultExecution: 'sequential',
    fixedRoles: ['agent'],
    optionalRoles: ['judge'],
    judgeContract: 'Evaluate proposal clarity, scope definition, and feasibility.',
  },
  spec: {
    description: 'Writes formal requirements and behavioral scenarios.',
    alwaysMono: false,
    defaultExecution: 'parallel',
    fixedRoles: ['agent', 'agent'],
    optionalRoles: ['judge', 'investigator', 'security-auditor'],
    judgeContract: 'Choose most verifiable spec. Eliminate ambiguity. Ensure line coherence. Cross-reference external research.',
  },
  design: {
    description: 'Produces technical architecture, module design, and key decisions.',
    alwaysMono: false,
    defaultExecution: 'parallel',
    fixedRoles: ['agent', 'agent'],
    optionalRoles: ['judge', 'radar'],
    judgeContract: 'Choose architecture that fits existing patterns AND spec requirements.',
  },
  tasks: {
    description: 'Breaks design into ordered task checklist, then writes TDD tests that fail.',
    alwaysMono: true,
    defaultExecution: 'sequential',
    fixedRoles: ['agent'],
    optionalRoles: [],
    judgeContract: null,
  },
  apply: {
    description: 'Implements tasks: writes code following spec and design. Always ONE agent.',
    alwaysMono: true,
    defaultExecution: 'sequential',
    fixedRoles: ['agent'],
    optionalRoles: [],
    judgeContract: null,
  },
  verify: {
    description: 'Validates implementation against spec. Runs tests. Reports gaps.',
    alwaysMono: false,
    defaultExecution: 'parallel',
    fixedRoles: ['agent', 'agent'],
    optionalRoles: ['judge', 'radar', 'risk-detector', 'security-auditor'],
    judgeContract: 'Confirmed if 2+ sabuesos agree. Suspect if only 1. Escalate contradictions.',
  },
  debug: {
    description: 'Diagnoses root cause when verify fails. Full mini-SDD cycle internally.',
    alwaysMono: false,
    defaultExecution: 'parallel',
    trigger: 'on-failure',
    depends_on: 'verify',
    fixedRoles: ['agent', 'agent'],
    optionalRoles: ['judge', 'radar'],
    judgeContract: 'Validate root cause diagnosis. Is this the cause or a symptom?',
  },
  archive: {
    description: 'Syncs delta specs to main docs. Mechanical file operation. Always ONE agent.',
    alwaysMono: true,
    defaultExecution: 'sequential',
    fixedRoles: ['agent'],
    optionalRoles: [],
    judgeContract: null,
  },
};

/**
 * Load phase metadata for a given SDD.
 *
 * - If sddName is null, undefined, or 'default': returns PHASE_METADATA (canonical behavior).
 * - Otherwise: loads the custom SDD from sddsDir and builds a phase metadata map from sdd.yaml.
 *
 * @param {string|null|undefined} sddName - SDD name, or null/undefined/'default' for canonical
 * @param {string} sddsDir - Path to router/catalogs/ (custom SDDs directory)
 * @returns {Record<string, PhaseMetadataEntry>}
 */
export function loadPhaseMetadataForSdd(sddName, sddsDir) {
  // Default fallback: return canonical metadata unchanged
  if (!sddName || sddName === 'default') {
    return PHASE_METADATA;
  }

  // Load the custom SDD definition (throws if not found)
  const sdd = loadCustomSdd(sddsDir, sddName);

  // Build phase metadata map from sdd.yaml phases
  const result = {};
  for (const [phaseName, phase] of Object.entries(sdd.phases)) {
    const mode = phase.mode ?? ((phase.agents ?? 1) > 1 || phase.judge === true || phase.radar === true ? 'multi' : 'single');
    const agentExecution = phase.agent_execution ?? phase.execution ?? (mode === 'multi' ? 'parallel' : 'sequential');
    result[phaseName] = {
      description: phase.intent,
      defaultExecution: agentExecution,
      mode,
      agentExecution,
      agents: phase.agents ?? 1,
      judge: mode === 'multi',
      radar: mode === 'multi' ? (phase.radar ?? false) : false,
      depends_on: phase.depends_on ?? [],
      // Provide compatible fields for TUI wizard usage
      alwaysMono: mode === 'single',
      fixedRoles: mode === 'multi'
        ? Array.from({ length: Math.max(2, phase.agents ?? 2) }, () => 'agent')
        : ['agent'],
      optionalRoles: mode === 'multi' ? ['judge', 'radar'] : [],
      judgeContract: mode === 'multi' ? 'Custom phase judge contract.' : null,
    };
  }

  return result;
}

/** @deprecated Use loadPhaseMetadataForSdd instead */
export const loadPhaseMetadataForCatalog = loadPhaseMetadataForSdd;
