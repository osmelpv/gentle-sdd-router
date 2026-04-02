/**
 * SDD Catalog IO — CRUD and validation for custom SDD definitions
 *
 * Catalog layout:
 *   router/catalogs/<name>/
 *     sdd.yaml                  — SDD definition
 *     contracts/roles/          — catalog-scoped role contracts
 *     contracts/phases/         — catalog-scoped phase contracts
 *     profiles/                 — optional routing presets for this SDD
 *
 * GSR boundary: this module is report-only, non-executing.
 * Trigger fields are stored as plain data — never evaluated.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseYaml, stringifyYaml } from './router.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Slug format: lowercase letters, digits, hyphens. Must start with a letter or digit. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VALID_EXECUTION_VALUES = new Set(['parallel', 'sequential']);
const VALID_PAYLOAD_FROM_VALUES = new Set(['output', 'input', 'custom']);

/** Valid trigger values for per-phase invoke declarations. */
const VALID_INVOKE_TRIGGERS = new Set(['on_issues', 'always', 'never', 'manual']);

/** Valid on_failure values for per-phase invoke declarations. */
const VALID_ON_FAILURE_VALUES = new Set(['block', 'escalate', 'continue']);

// ─── validateSddYaml ─────────────────────────────────────────────────────────

/**
 * Validate and normalize a parsed sdd.yaml object.
 * Throws with a descriptive message on any validation error.
 * Returns the normalized SddDefinition with defaults applied.
 *
 * @param {object} parsed - Result of YAML parsing
 * @param {string} filePath - Source file path (for error messages)
 * @returns {SddDefinition} Normalized SDD definition
 */
export function validateSddYaml(parsed, filePath) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`[${filePath}] sdd.yaml must be a YAML mapping.`);
  }

  // Validate name — required, slug format
  if (!parsed.name || typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error(`[${filePath}] 'name' is required in sdd.yaml.`);
  }
  if (!SLUG_RE.test(parsed.name)) {
    throw new Error(
      `[${filePath}] 'name' must be a slug (lowercase letters, digits, hyphens): "${parsed.name}".`
    );
  }

  // Validate version — defaults to 1 if absent but warns
  const version = parsed.version != null ? Number(parsed.version) : 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`[${filePath}] 'version' must be an integer >= 1.`);
  }

  // Validate phases — required, at least one entry
  if (!parsed.phases || typeof parsed.phases !== 'object' || Array.isArray(parsed.phases)) {
    throw new Error(`[${filePath}] 'phases' is required and must be a mapping.`);
  }
  const phaseNames = Object.keys(parsed.phases);
  if (phaseNames.length === 0) {
    throw new Error(`[${filePath}] 'phases' must contain at least one phase.`);
  }

  // Validate each phase
  const normalizedPhases = {};
  for (const phaseName of phaseNames) {
    const phase = parsed.phases[phaseName];
    if (!phase || typeof phase !== 'object') {
      throw new Error(`[${filePath}] Phase '${phaseName}' must be a mapping.`);
    }

    // intent is required
    if (!phase.intent || typeof phase.intent !== 'string' || !phase.intent.trim()) {
      throw new Error(`[${filePath}] Phase '${phaseName}' is missing required field 'intent'.`);
    }

    // execution must be valid enum if present
    const execution = phase.execution ?? 'sequential';
    if (!VALID_EXECUTION_VALUES.has(execution)) {
      throw new Error(
        `[${filePath}] Phase '${phaseName}' has invalid 'execution' value: "${execution}". ` +
        `Allowed values: parallel, sequential.`
      );
    }

    // agents must be integer >= 1 if present
    const agents = phase.agents != null ? Number(phase.agents) : 1;
    if (!Number.isInteger(agents) || agents < 1) {
      throw new Error(`[${filePath}] Phase '${phaseName}' 'agents' must be an integer >= 1.`);
    }

    // depends_on must reference existing phases
    const depends_on = Array.isArray(phase.depends_on) ? phase.depends_on : [];
    for (const dep of depends_on) {
      if (!phaseNames.includes(dep)) {
        throw new Error(
          `[${filePath}] Phase '${phaseName}' depends_on unknown phase: "${dep}".`
        );
      }
    }

    // invoke — optional per-phase invocation declaration
    const invoke = normalizeInvoke(phase.invoke, phaseName, filePath);

    normalizedPhases[phaseName] = {
      intent: phase.intent.trim(),
      execution,
      agents,
      judge: phase.judge === true,
      radar: phase.radar === true,
      input: typeof phase.input === 'string' ? phase.input : '',
      output: typeof phase.output === 'string' ? phase.output : '',
      depends_on,
      invoke,
    };
  }

  // Detect cycles in depends_on via topological sort (Kahn's algorithm)
  detectCycles(normalizedPhases, filePath);

  // Validate triggers — optional, stored as plain data
  let triggers = null;
  if (parsed.triggers != null) {
    if (typeof parsed.triggers !== 'object' || Array.isArray(parsed.triggers)) {
      throw new Error(`[${filePath}] 'triggers' must be a mapping if present.`);
    }
    triggers = {
      from_sdd: parsed.triggers.from_sdd ?? null,
      trigger_phase: parsed.triggers.trigger_phase ?? null,
      return_to: parsed.triggers.return_to ?? null,
    };
  }

  return {
    name: parsed.name,
    version,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    phases: normalizedPhases,
    triggers,
  };
}

/**
 * Normalize and validate an optional per-phase invoke block.
 * Returns null if invoke is absent. Throws on validation errors.
 *
 * @param {object|null|undefined} raw - Raw invoke value from YAML
 * @param {string} phaseName - Phase name (for error messages)
 * @param {string} filePath - Source file path (for error messages)
 * @returns {InvokeDeclaration|null}
 */
function normalizeInvoke(raw, phaseName, filePath) {
  if (raw == null) return null;

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`[${filePath}] Phase '${phaseName}' invoke must be a mapping.`);
  }

  // catalog is required and must be a slug
  if (!raw.catalog || typeof raw.catalog !== 'string' || !raw.catalog.trim()) {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.catalog is required.`
    );
  }
  if (!SLUG_RE.test(raw.catalog)) {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.catalog must be a slug ` +
      `(lowercase letters, digits, hyphens): "${raw.catalog}".`
    );
  }

  // payload_from is required and must be valid enum
  if (!raw.payload_from) {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.payload_from is required. ` +
      `Allowed values: output, input, custom.`
    );
  }
  if (!VALID_PAYLOAD_FROM_VALUES.has(raw.payload_from)) {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.payload_from "${raw.payload_from}" is invalid. ` +
      `Allowed values: output, input, custom.`
    );
  }

  // await must be boolean if present
  const awaitValue = raw.await !== undefined ? raw.await : true;
  if (typeof awaitValue !== 'boolean') {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.await must be a boolean.`
    );
  }

  // on_failure: optional, must be valid enum, defaults to 'block'
  const onFailure = raw.on_failure !== undefined ? raw.on_failure : 'block';
  if (!VALID_ON_FAILURE_VALUES.has(onFailure)) {
    throw new Error(
      `[${filePath}] Phase '${phaseName}' invoke.on_failure "${onFailure}" is invalid. ` +
      `Allowed values: block, escalate, continue.`
    );
  }

  // input_context: optional array of { artifact, field? } objects — declarative, not evaluated
  let inputContext = null;
  if (raw.input_context != null) {
    if (!Array.isArray(raw.input_context)) {
      throw new Error(
        `[${filePath}] Phase '${phaseName}' invoke.input_context must be an array.`
      );
    }
    inputContext = raw.input_context.map((item, i) => {
      if (!item || typeof item !== 'object') {
        throw new Error(
          `[${filePath}] Phase '${phaseName}' invoke.input_context[${i}] must be an object.`
        );
      }
      if (!item.artifact || typeof item.artifact !== 'string') {
        throw new Error(
          `[${filePath}] Phase '${phaseName}' invoke.input_context[${i}].artifact is required.`
        );
      }
      return {
        artifact: item.artifact,
        ...(typeof item.field === 'string' ? { field: item.field } : {}),
      };
    });
  }

  // output_expected: optional array of { artifact, format? } objects — declarative, not evaluated
  let outputExpected = null;
  if (raw.output_expected != null) {
    if (!Array.isArray(raw.output_expected)) {
      throw new Error(
        `[${filePath}] Phase '${phaseName}' invoke.output_expected must be an array.`
      );
    }
    outputExpected = raw.output_expected.map((item, i) => {
      if (!item || typeof item !== 'object') {
        throw new Error(
          `[${filePath}] Phase '${phaseName}' invoke.output_expected[${i}] must be an object.`
        );
      }
      if (!item.artifact || typeof item.artifact !== 'string') {
        throw new Error(
          `[${filePath}] Phase '${phaseName}' invoke.output_expected[${i}].artifact is required.`
        );
      }
      return {
        artifact: item.artifact,
        ...(typeof item.format === 'string' ? { format: item.format } : {}),
      };
    });
  }

  return {
    catalog: raw.catalog,
    sdd: typeof raw.sdd === 'string' && raw.sdd.trim() ? raw.sdd : raw.catalog,
    payload_from: raw.payload_from,
    await: awaitValue,
    result_field: typeof raw.result_field === 'string' ? raw.result_field : null,
    on_failure: onFailure,
    ...(inputContext != null ? { input_context: inputContext } : {}),
    ...(outputExpected != null ? { output_expected: outputExpected } : {}),
  };
}

/**
 * Detect circular dependencies using Kahn's topological sort.
 * Throws if a cycle is detected.
 * @param {Record<string, {depends_on: string[]}>} phases
 * @param {string} filePath
 */
function detectCycles(phases, filePath) {
  const phaseNames = Object.keys(phases);
  const inDegree = {};
  const adj = {};

  for (const name of phaseNames) {
    inDegree[name] = 0;
    adj[name] = [];
  }

  for (const name of phaseNames) {
    for (const dep of phases[name].depends_on) {
      adj[dep].push(name);
      inDegree[name] = (inDegree[name] || 0) + 1;
    }
  }

  const queue = phaseNames.filter(n => inDegree[n] === 0);
  let visited = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (visited < phaseNames.length) {
    throw new Error(
      `[${filePath}] Circular dependency detected in 'depends_on'. ` +
      `Check phases: ${phaseNames.filter(n => inDegree[n] > 0).join(', ')}`
    );
  }
}

// ─── loadCustomSdds ───────────────────────────────────────────────────────────

/**
 * Load all custom SDD definitions from the catalogs directory.
 * Returns an empty array if the directory does not exist.
 * Throws if any catalog has an invalid sdd.yaml.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @returns {SddDefinition[]}
 */
export function loadCustomSdds(catalogsDir) {
  if (!existsSync(catalogsDir)) {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(catalogsDir);
  } catch {
    return [];
  }

  const sdds = [];

  for (const entry of entries) {
    const entryPath = join(catalogsDir, entry);
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const sddYamlPath = join(entryPath, 'sdd.yaml');
    if (!existsSync(sddYamlPath)) continue;

    const raw = readFileSync(sddYamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const sdd = validateSddYaml(parsed, sddYamlPath);
    sdds.push(sdd);
  }

  return sdds;
}

/**
 * Load a single custom SDD by name.
 * @param {string} catalogsDir
 * @param {string} name
 * @returns {SddDefinition}
 */
export function loadCustomSdd(catalogsDir, name) {
  const sddYamlPath = join(catalogsDir, name, 'sdd.yaml');
  if (!existsSync(sddYamlPath)) {
    throw new Error(`Custom SDD '${name}' not found at ${sddYamlPath}.`);
  }
  const raw = readFileSync(sddYamlPath, 'utf8');
  const parsed = parseYaml(raw);
  return validateSddYaml(parsed, sddYamlPath);
}

// ─── createCustomSdd ─────────────────────────────────────────────────────────

/**
 * Scaffold a new custom SDD catalog directory with an sdd.yaml and
 * empty contracts/ subdirectories.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} name - SDD name (must be slug)
 * @param {string} [description] - Optional human-readable description
 * @returns {{ name: string, path: string }}
 */
export function createCustomSdd(catalogsDir, name, description) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('SDD name is required and must be a non-empty string.');
  }
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `SDD name must be a slug (lowercase letters, digits, hyphens): "${name}".`
    );
  }

  const catalogDir = join(catalogsDir, name);

  if (existsSync(catalogDir)) {
    throw new Error(`SDD '${name}' already exists at ${catalogDir}.`);
  }

  // Create directory structure
  mkdirSync(join(catalogDir, 'contracts', 'roles'), { recursive: true });
  mkdirSync(join(catalogDir, 'contracts', 'phases'), { recursive: true });

  // Write scaffold sdd.yaml with a placeholder phase so the file is valid
  const sddContent = {
    name,
    version: 1,
    description: description || '',
    phases: {
      main: {
        intent: 'Define the main phase intent here',
      },
    },
  };

  const yaml = stringifyYaml(sddContent);
  const sddYamlPath = join(catalogDir, 'sdd.yaml');
  const tempPath = `${sddYamlPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, sddYamlPath);

  // Auto-generate phase contracts for each phase defined in the sdd.yaml
  for (const [phaseName, phaseConfig] of Object.entries(sddContent.phases)) {
    scaffoldPhaseContract(catalogsDir, name, phaseName, phaseConfig);
  }

  return { name, path: catalogDir };
}

// ─── deleteCustomSdd ─────────────────────────────────────────────────────────

/**
 * Delete a custom SDD catalog directory and all its contents.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} name - SDD name to delete
 * @returns {{ name: string, path: string, deleted: true }}
 */
export function deleteCustomSdd(catalogsDir, name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('SDD name is required and must be a non-empty string.');
  }

  const catalogDir = join(catalogsDir, name);

  if (!existsSync(catalogDir)) {
    throw new Error(`SDD '${name}' not found at ${catalogDir}.`);
  }

  rmSync(catalogDir, { recursive: true, force: true });

  return { name, path: catalogDir, deleted: true };
}

// ─── scaffoldPhaseContract ────────────────────────────────────────────────────

/**
 * Generate a phase contract `.md` scaffold file for a given phase.
 * Only creates the file if it does not already exist (never overwrites).
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} sddName - SDD catalog name
 * @param {string} phaseName - Phase name
 * @param {{ intent?: string, agents?: number, judge?: boolean, radar?: boolean, input?: string, output?: string }} phaseConfig - Phase configuration
 * @returns {{ created: boolean, path: string }}
 */
export function scaffoldPhaseContract(catalogsDir, sddName, phaseName, phaseConfig = {}) {
  const phasesDir = join(catalogsDir, sddName, 'contracts', 'phases');
  const contractPath = join(phasesDir, `${phaseName}.md`);

  if (existsSync(contractPath)) {
    return { created: false, path: contractPath };
  }

  const intent = phaseConfig.intent || '';
  const agents = phaseConfig.agents ?? 1;
  const judge = phaseConfig.judge === true ? 'yes' : 'no';
  const radar = phaseConfig.radar === true ? 'yes' : 'no';
  const inputContract = typeof phaseConfig.input === 'string' && phaseConfig.input.trim()
    ? phaseConfig.input.trim()
    : '<!-- What this phase receives from the previous phase -->';
  const outputContract = typeof phaseConfig.output === 'string' && phaseConfig.output.trim()
    ? phaseConfig.output.trim()
    : '<!-- What this phase produces for the next phase -->';

  const content = `# Phase: ${phaseName}

## Intent
${intent}

## Composition
- Agents: ${agents}
- Judge: ${judge}
- Radar: ${radar}

## Instructions
<!-- Define what the agent(s) in this phase should do -->

## Input Contract
${inputContract}

## Output Contract
${outputContract}

## Skills
<!-- List skills the agent(s) should use -->

## Constraints
<!-- Rules the agent(s) must follow -->
`;

  mkdirSync(phasesDir, { recursive: true });
  const tempPath = `${contractPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, contractPath);

  return { created: true, path: contractPath };
}

// ─── addPhaseInvoke ──────────────────────────────────────────────────────────

/**
 * Add or update an invoke block on a specific phase within a custom SDD.
 * Reads sdd.yaml, merges the invoke config onto the named phase, writes back atomically.
 *
 * GSR boundary: invoke fields are stored as plain data — never evaluated.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} sddName - SDD catalog name (slug)
 * @param {string} phaseName - Phase to add invoke to
 * @param {object} invokeConfig - Invoke configuration object
 * @param {string} invokeConfig.catalog - Target catalog slug (required)
 * @param {string} [invokeConfig.sdd] - Target SDD slug (defaults to catalog)
 * @param {string} [invokeConfig.trigger] - Trigger mode: on_issues | always | never | manual
 * @param {string} [invokeConfig.input_from] - Where to read input from
 * @param {string[]} [invokeConfig.required_fields] - Required field names
 * @returns {{ sddName: string, phaseName: string, invoke: object }}
 */
export function addPhaseInvoke(catalogsDir, sddName, phaseName, invokeConfig) {
  const sddYamlPath = join(catalogsDir, sddName, 'sdd.yaml');

  if (!existsSync(sddYamlPath)) {
    throw new Error(`SDD '${sddName}' not found at ${join(catalogsDir, sddName)}.`);
  }

  // Validate invoke config
  const { catalog, sdd: sddSlug, trigger, input_from, required_fields } = invokeConfig ?? {};

  if (!catalog || typeof catalog !== 'string' || !catalog.trim()) {
    throw new Error(`addPhaseInvoke: invoke.catalog is required.`);
  }
  if (!SLUG_RE.test(catalog)) {
    throw new Error(
      `addPhaseInvoke: invoke.catalog must be a slug (lowercase letters, digits, hyphens): "${catalog}".`
    );
  }

  if (trigger !== undefined && trigger !== null && trigger !== '') {
    if (!VALID_INVOKE_TRIGGERS.has(trigger)) {
      throw new Error(
        `addPhaseInvoke: invoke.trigger "${trigger}" is invalid. ` +
        `Allowed values: on_issues, always, never, manual.`
      );
    }
  }

  // Read and parse the existing sdd.yaml
  const raw = readFileSync(sddYamlPath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed.phases || typeof parsed.phases !== 'object') {
    throw new Error(`SDD '${sddName}' sdd.yaml has no phases.`);
  }

  if (!Object.prototype.hasOwnProperty.call(parsed.phases, phaseName)) {
    throw new Error(
      `Phase '${phaseName}' not found in SDD '${sddName}'. ` +
      `Available phases: ${Object.keys(parsed.phases).join(', ')}.`
    );
  }

  // Build the invoke block (plain data — non-executing)
  // payload_from defaults to 'output' when not supplied (normalizeInvoke requires it)
  const payloadFrom = invokeConfig.payload_from ?? 'output';

  const invokeBlock = {
    catalog: catalog.trim(),
    sdd: sddSlug && sddSlug.trim() ? sddSlug.trim() : catalog.trim(),
    payload_from: VALID_PAYLOAD_FROM_VALUES.has(payloadFrom) ? payloadFrom : 'output',
  };

  if (trigger && VALID_INVOKE_TRIGGERS.has(trigger)) {
    invokeBlock.trigger = trigger;
  }

  if (input_from && typeof input_from === 'string' && input_from.trim()) {
    invokeBlock.input_from = input_from.trim();
  }

  if (Array.isArray(required_fields) && required_fields.length > 0) {
    invokeBlock.required_fields = required_fields.filter(Boolean);
  }

  // Merge invoke block onto the phase (upsert)
  parsed.phases[phaseName] = {
    ...parsed.phases[phaseName],
    invoke: invokeBlock,
  };

  // Write back atomically
  const yaml = stringifyYaml(parsed);
  const tempPath = `${sddYamlPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, sddYamlPath);

  return { sddName, phaseName, invoke: invokeBlock };
}

// ─── resolveContract ─────────────────────────────────────────────────────────

/**
 * Resolve a contract file by type and name using the priority chain:
 *   1. Catalog-scoped: router/catalogs/<sddName>/contracts/<type>/<name>.md
 *   2. Global: router/contracts/<type>/<name>.md
 *   3. null (not found)
 *
 * @param {string} type - 'roles' or 'phases'
 * @param {string} name - Contract name (without .md)
 * @param {string} sddName - SDD catalog name
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} globalContractsDir - Path to router/contracts/
 * @returns {{ content: string, checksum: string, source: string } | null}
 */
export function resolveContract(type, name, sddName, catalogsDir, globalContractsDir) {
  // 1. Catalog-scoped first
  const catalogPath = join(catalogsDir, sddName, 'contracts', type, `${name}.md`);
  if (existsSync(catalogPath)) {
    const content = readFileSync(catalogPath, 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');
    return { content, checksum, source: catalogPath };
  }

  // 2. Global fallback
  const globalPath = join(globalContractsDir, type, `${name}.md`);
  if (existsSync(globalPath)) {
    const content = readFileSync(globalPath, 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');
    return { content, checksum, source: globalPath };
  }

  // 3. Not found
  return null;
}

// ─── validateSddFull ─────────────────────────────────────────────────────────

/**
 * Full validation of a custom SDD: checks sdd.yaml validity, phase contract presence,
 * role contract presence (warnings), dependency cycles, and invoke target existence.
 *
 * GSR boundary: all checks are declarative and report-only. No execution occurs.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} name - SDD name to validate
 * @returns {{
 *   valid: boolean,
 *   warnings: string[],
 *   errors: string[],
 *   details: {
 *     phases: { present: number, total: number, missing: string[] },
 *     roles: { present: number, total: number, missing: string[] },
 *     deps: { hasCycles: boolean },
 *     invokes: { valid: number, warnings: string[] }
 *   }
 * }}
 */
export function validateSddFull(catalogsDir, name) {
  // Load and validate the sdd.yaml (throws on invalid YAML or schema errors)
  const sdd = loadCustomSdd(catalogsDir, name);
  const sddDir = join(catalogsDir, name);
  const sddYamlPath = join(sddDir, 'sdd.yaml');

  // Also read the raw YAML for fields not preserved by validateSddYaml (e.g. roles array)
  const rawParsed = parseYaml(readFileSync(sddYamlPath, 'utf8'));

  const errors = [];
  const warnings = [];

  // ── Phase contracts ────────────────────────────────────────────────────────
  const phaseNames = Object.keys(sdd.phases);
  const phasesContractsDir = join(sddDir, 'contracts', 'phases');
  const missingPhaseContracts = [];
  let presentPhaseContracts = 0;

  for (const phaseName of phaseNames) {
    const contractPath = join(phasesContractsDir, `${phaseName}.md`);
    if (existsSync(contractPath)) {
      presentPhaseContracts++;
    } else {
      missingPhaseContracts.push(phaseName);
    }
  }

  for (const missing of missingPhaseContracts) {
    errors.push(`Phase contract missing: contracts/phases/${missing}.md`);
  }

  // ── Role contracts (warnings, not errors) ─────────────────────────────────
  // Roles may be referenced as a top-level array in sdd.yaml (optional extension).
  // Since validateSddYaml doesn't preserve the top-level 'roles' field, we read from rawParsed.
  const rolesContractsDir = join(sddDir, 'contracts', 'roles');
  const roleNames = Array.isArray(rawParsed.roles) ? rawParsed.roles.filter(r => typeof r === 'string') : [];
  const missingRoleContracts = [];
  let presentRoleContracts = 0;

  for (const roleName of roleNames) {
    const contractPath = join(rolesContractsDir, `${roleName}.md`);
    if (existsSync(contractPath)) {
      presentRoleContracts++;
    } else {
      missingRoleContracts.push(roleName);
    }
  }

  for (const missing of missingRoleContracts) {
    warnings.push(`Role contract missing: contracts/roles/${missing}.md`);
  }

  // ── Dependency graph — already checked by validateSddYaml (no cycles) ─────
  // If we reach here, validateSddYaml already ran without throwing, so no cycles.
  const hasCycles = false;

  // ── Invoke target existence (warnings) ────────────────────────────────────
  const invokeWarnings = [];
  let validInvokes = 0;

  for (const [phaseName, phase] of Object.entries(sdd.phases)) {
    if (!phase.invoke) continue;

    const targetCatalog = phase.invoke.catalog;
    const targetCatalogDir = join(catalogsDir, targetCatalog);
    if (!existsSync(targetCatalogDir)) {
      invokeWarnings.push(
        `Phase '${phaseName}' invokes catalog '${targetCatalog}' which does not exist in router/catalogs/`
      );
    } else {
      validInvokes++;
    }
  }

  warnings.push(...invokeWarnings);

  const valid = errors.length === 0;

  return {
    valid,
    warnings,
    errors,
    details: {
      phases: {
        present: presentPhaseContracts,
        total: phaseNames.length,
        missing: missingPhaseContracts,
      },
      roles: {
        present: presentRoleContracts,
        total: roleNames.length,
        missing: missingRoleContracts,
      },
      deps: { hasCycles },
      invokes: {
        valid: validInvokes,
        warnings: invokeWarnings,
      },
    },
  };
}

// ─── listDeclaredInvocations ──────────────────────────────────────────────────

/**
 * List all DECLARED invocations from a custom SDD's phases.
 * Returns phases that have an invoke block, with the invoke details.
 *
 * GSR boundary: report-only. Does NOT execute anything.
 *
 * @param {string} catalogsDir - Path to router/catalogs/
 * @param {string} sddName - SDD name
 * @returns {Array<{
 *   phase: string,
 *   catalog: string,
 *   sdd: string,
 *   await: boolean,
 *   on_failure: string,
 *   input_context?: Array<{artifact: string, field?: string}>,
 *   output_expected?: Array<{artifact: string, format?: string}>
 * }>}
 */
export function listDeclaredInvocations(catalogsDir, sddName) {
  const sdd = loadCustomSdd(catalogsDir, sddName);
  const invocations = [];

  for (const [phaseName, phase] of Object.entries(sdd.phases)) {
    if (!phase.invoke) continue;

    const entry = {
      phase: phaseName,
      catalog: phase.invoke.catalog,
      sdd: phase.invoke.sdd,
      await: phase.invoke.await,
      on_failure: phase.invoke.on_failure,
    };

    if (phase.invoke.input_context != null) {
      entry.input_context = phase.invoke.input_context;
    }
    if (phase.invoke.output_expected != null) {
      entry.output_expected = phase.invoke.output_expected;
    }

    invocations.push(entry);
  }

  return invocations;
}
