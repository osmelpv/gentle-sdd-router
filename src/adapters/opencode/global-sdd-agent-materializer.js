import fs from 'node:fs';
import { OPENCODE_CONFIG_PATH, writeOpenCodeConfig } from './index.js';

function readExistingConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function toAgentEntry(spec) {
  return {
    description: spec.description,
    hidden: spec.hidden !== false,
    mode: spec.mode ?? 'subagent',
    model: spec.target,
    prompt: spec.prompt,
    tools: spec.tools,
    _gsr_generated: true,
  };
}

export function materializeGlobalSddAgents(specs, configPath = OPENCODE_CONFIG_PATH) {
  const existing = readExistingConfig(configPath);
  const result = JSON.parse(JSON.stringify(existing));
  if (!result.agent) result.agent = {};

  const warnings = [];
  const managedNames = new Set(specs.map((s) => s.name));

  // Remove stale GSR-managed debug/SDD entries we own but are no longer in desired spec set.
  for (const [name, entry] of Object.entries(result.agent)) {
    if (!name.startsWith('sdd-')) continue;
    if (entry?._gsr_generated === true && !managedNames.has(name)) {
      delete result.agent[name];
    }
  }

  for (const spec of specs) {
    const existingEntry = result.agent[spec.name];
    if (existingEntry && existingEntry._gsr_generated !== true) {
      warnings.push(`${spec.name}: existing user-owned entry replaced by GSR global-sync`);
    }
    result.agent[spec.name] = toAgentEntry(spec);
  }

  Object.defineProperty(result, 'warnings', {
    value: warnings,
    enumerable: false,
    configurable: true,
  });

  const writtenPath = writeOpenCodeConfig(result, configPath);
  return { writtenPath, count: specs.length, warnings, agentNames: specs.map((s) => s.name) };
}
