/**
 * watchdog-context.js — Context prompt builders for watchdog heartbeat injection.
 *
 * These functions generate the instruction text that gets injected into
 * sub-agent and orchestrator prompts to activate the file-based heartbeat system.
 *
 * This module is NON-EXECUTING — it only generates strings.
 * No file I/O, no side effects.
 *
 * Exported functions:
 *   - buildHeartbeatInstructions(params) — inject into any sub-agent's prompt
 *   - buildMonitorInstructions(params)   — inject into the orchestrator's prompt
 */

/**
 * Build the heartbeat instructions that get injected into ANY sub-agent's prompt.
 *
 * @param {object} params
 * @param {string} params.taskId       - Unique task identifier
 * @param {string} params.agentName    - Agent name (e.g., 'sdd-apply')
 * @param {string} params.model        - Model being used
 * @param {string} params.projectRoot  - Project root path
 * @returns {string}
 */
export function buildHeartbeatInstructions(params) {
  const { taskId, agentName, model, projectRoot } = params;
  const watchdogDir = `${projectRoot}/.gsr/watchdog`;
  const heartbeatPath = `${watchdogDir}/${taskId}.json`;

  return `## Watchdog Heartbeat — MANDATORY

You MUST maintain a heartbeat file so the orchestrator knows you're alive.

### Your Heartbeat File
Path: ${heartbeatPath}

### Protocol
1. IMMEDIATELY on start: create directory and write first heartbeat
2. Every 15-30 seconds during work: update the heartbeat
3. On completion: write final heartbeat with status "completed"
4. On error: write heartbeat with status "error"

### Write Command (use bash)
mkdir -p ${watchdogDir} && echo '{"ts":'$(date +%s%3N)',"task_id":"${taskId}","agent":"${agentName}","status":"running","progress":"(describe current work)","model":"${model}"}' > ${heartbeatPath}

### Completion Command
echo '{"ts":'$(date +%s%3N)',"task_id":"${taskId}","agent":"${agentName}","status":"completed","progress":"(summary of what was done)","model":"${model}"}' > ${heartbeatPath}

### CRITICAL
If you stop writing heartbeats for 90 seconds, you will be considered DEAD and replaced.`;
}

/**
 * Build monitoring instructions for the orchestrator.
 *
 * @param {object} params
 * @param {string} params.projectRoot  - Project root path
 * @param {Array<{taskId: string, model: string, fallbacks: string[]}>} params.delegates - Active delegations
 * @returns {string}
 */
export function buildMonitorInstructions(params) {
  const { projectRoot, delegates } = params;
  const watchdogDir = `${projectRoot}/.gsr/watchdog`;

  const delegateLines = delegates.map((d) =>
    `- ${d.taskId}: model=${d.model}, fallbacks=[${d.fallbacks.join(', ')}]`
  ).join('\n');

  return `## Watchdog Monitoring — Active Delegations

Heartbeat directory: ${watchdogDir}

### Active Agents
${delegateLines}

### Monitoring Protocol
After delegating, check heartbeats every 30 seconds:
1. Read ${watchdogDir}/{taskId}.json
2. If missing after 45 seconds → agent never started
3. If ts is older than 90 seconds → agent is dead
4. If status is "completed" → agent finished
5. If status is "error" → agent failed

### On Agent Death
1. Read last heartbeat "progress" field to know where it stopped
2. Pick next model from fallbacks list
3. Delegate SAME task to new agent with fallback model
4. Include context: "Previous agent (model X) died while: {progress}"`;
}
