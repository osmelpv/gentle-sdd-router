import path from 'node:path';
import { getProjectSddAgentSpecs } from '../../core/project-sdd-agent-routing.js';
import { materializeGlobalSddAgents } from './global-sdd-agent-materializer.js';

export function materializeProjectSddAgents(configPath, options = {}) {
  const specs = getProjectSddAgentSpecs(configPath, { cwd: options.cwd });
  const targetPath = options.targetPath ?? path.join(path.dirname(path.dirname(configPath)), 'opencode.json');
  return materializeGlobalSddAgents(specs, targetPath);
}
