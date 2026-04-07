/**
 * tribunal-context.js — Context prompt builders for tribunal orchestration.
 *
 * These functions generate the delegation prompts that the orchestrator passes
 * to the Judge, and that the Judge passes to Ministers and Radar.
 *
 * This module is NON-EXECUTING — it only generates strings.
 * No file I/O, no side effects.
 *
 * Exported functions:
 *   - buildJudgeContext(params)    — prompt for orchestrator → judge handoff
 *   - buildMinisterContext(params) — prompt for judge → minister delegation
 *   - buildRadarContext(params)    — prompt for judge → radar delegation
 */

/**
 * Build the context prompt that the orchestrator passes when delegating to the Judge.
 *
 * @param {object} params
 * @param {string} params.sddName      - SDD change name (e.g., 'tribunal-logic')
 * @param {string} params.phaseName    - Current phase (e.g., 'apply', 'explore')
 * @param {string} params.phaseGoal    - What this phase should accomplish
 * @param {string} params.tribunalId   - Unique ID for this tribunal session
 * @param {object} params.participants - { judge: 'model', ministers: [{model, name}], radar: {model}|null }
 * @param {number} [params.maxRounds=4] - Max rounds
 * @param {string} params.routerDir    - Path to router/ directory
 * @param {string} params.profileName  - Profile name (for agent naming pattern)
 * @param {object} [params.fallbacks]  - Fallback model chains per role
 * @param {string[]} [params.fallbacks.judge_fallbacks]    - Fallback models for the judge
 * @param {string[]} [params.fallbacks.minister_fallbacks] - Fallback models for ministers
 * @param {string[]} [params.fallbacks.radar_fallbacks]    - Fallback models for radar
 * @returns {string} - Full prompt text for judge delegation
 */
export function buildJudgeContext(params) {
  const {
    sddName,
    phaseName,
    phaseGoal,
    tribunalId,
    participants,
    maxRounds = 4,
    routerDir,
    profileName,
    fallbacks = {},
  } = params;

  const ministerFallbacks = fallbacks.minister_fallbacks ?? [];
  const radarFallbacks = fallbacks.radar_fallbacks ?? [];
  const judgeFallbacks = fallbacks.judge_fallbacks ?? [];

  const ministerList = participants.ministers
    .map((m, i) => `  - gsr-${profileName}-minister-${i + 1} (model: ${m.model})`)
    .join('\n');

  const radarLine = participants.radar
    ? `- Radar: gsr-${profileName}-radar (model: ${participants.radar.model})`
    : '- Radar: not assigned';

  const fallbackSection = `### Fallback Protocol
If a minister stops heartbeating (no update for 30 seconds):
1. Read heartbeat-{minister-name}.json — check if status is 'done' or timestamp is stale
2. If stale: the minister has crashed or been killed
3. Fallback models available:
   - Judge fallbacks: ${judgeFallbacks.join(', ') || 'none'}
   - Minister fallbacks: ${ministerFallbacks.join(', ') || 'none'}
   - Radar fallbacks: ${radarFallbacks.join(', ') || 'none'}
4. To replace a dead minister:
   a. Update metadata.json — add to participants.replaced: [{name, original_model, replacement_model, reason}]
   b. Delegate to a NEW minister using the fallback model
   c. Pass the same polling instructions but with the current round number
   d. The replacement minister inherits the role and name of the dead one
5. If no fallback models available: continue the tribunal with remaining ministers
6. If the judge itself is failing: write current state to metadata.json for the orchestrator to recover`;

  return `## Tribunal Session — ${sddName} / ${phaseName}

You are the JUDGE for this tribunal session. You control ALL rounds and ALL sub-agents.

### Session Parameters
- Tribunal ID: ${tribunalId}
- SDD: ${sddName}
- Phase: ${phaseName}
- Max Rounds: ${maxRounds}
- Router Dir: ${routerDir}
- Channel Dir: ${routerDir}/.tribunal/${sddName}/${phaseName}/

### Phase Goal
${phaseGoal}

### Your Agents
- Judge: YOU (gsr-${profileName}-judge)
${ministerList}
${radarLine}

### Channel Protocol
All communication happens via files in the channel directory.
- Write messages as JSON files: round-{N}-{sender}.json
- Each message has "from" and "to" fields for routing
- Ministers poll the channel every 3-5 seconds for messages addressed to them
- Heartbeats: each agent writes heartbeat-{name}.json every 5 seconds

### Your Responsibilities
1. Initialize the tribunal channel (create metadata.json)
2. Delegate to each minister with the phase prompt + polling instructions
3. Optionally delegate to radar for context gathering
4. Manage rounds (read responses → formulate questions → write to channel)
5. Monitor heartbeats — if an agent stops reporting, use the Fallback Protocol below
6. After final round: write final-decision.json + compression.json
7. Send "terminate" message to all agents (to: "all", type: "terminate")
8. Return the final decision to the orchestrator

### Round Protocol
1. Round 1: Delegate to ministers with phase goal. They respond independently.
2. Round 2: Read all responses. Write directed questions per dimension.
3. Round 3: Present comparison matrix. Ask ministers to evaluate.
4. Round 4: Propose synthesis. Ministers confirm or defend.
5. If no consensus: evaluate and decide (or escalate to user).

${fallbackSection}

### Delegation Prompt Template for Ministers
When delegating to a minister, include:
- The phase goal
- The channel directory path
- Their agent name (for the "from" field)
- Instructions to poll for messages addressed to them
- The tribunal-minister skill reference

### CRITICAL
- You must load the tribunal-judge skill for full protocol details
- All channel I/O uses the file format described in the tribunal-minister skill
- You decide when to advance rounds and when to terminate
- The orchestrator only sees your FINAL return value — keep it clean`;
}

/**
 * Build the prompt the Judge passes when delegating to a Minister.
 *
 * @param {object} params
 * @param {string} params.ministerName  - Agent name (e.g., 'gsr-myprofile-minister-1')
 * @param {string} params.ministerModel - Model identifier
 * @param {string} params.sddName       - SDD change name
 * @param {string} params.phaseName     - Current phase
 * @param {string} params.phaseGoal     - What this phase should accomplish
 * @param {string} params.tribunalId    - Unique tribunal session ID
 * @param {string} params.channelDir    - Absolute path to the channel directory
 * @param {number} [params.round=1]     - Starting round number
 * @returns {string} - Full prompt text for minister delegation
 */
export function buildMinisterContext(params) {
  const {
    ministerName,
    sddName,
    phaseName,
    phaseGoal,
    tribunalId,
    channelDir,
    round = 1,
  } = params;

  return `## Tribunal Minister Assignment — ${sddName} / ${phaseName}

You are minister "${ministerName}" in a Tribunal session.

### Your Assignment
${phaseGoal}

### Channel Protocol
- Channel directory: ${channelDir}
- Your agent name: ${ministerName} (use this in "from" field)
- Current round: ${round}

### STEP 1: Respond
Analyze the assignment and write your response to:
${channelDir}/round-${round}-${ministerName}.json

Use this JSON format:
{
  "id": "${tribunalId}-r${round}-${ministerName}",
  "tribunal_id": "${tribunalId}",
  "round": ${round},
  "sender": "${ministerName}",
  "from": "${ministerName}",
  "to": "judge",
  "role": "minister",
  "type": "response",
  "timestamp": "(current ISO timestamp)",
  "content": {
    "text": "(your full analysis)",
    "code_examples": [],
    "position": "neutral",
    "confidence": 0.0,
    "dimensions": {
      "security": "(your assessment)",
      "scalability": "(your assessment)",
      "cleanliness": "(your assessment)",
      "functionality": "(your assessment)",
      "risk": "(your assessment)",
      "maintainability": "(your assessment)"
    }
  }
}

### HEARTBEAT — CRITICAL
You MUST write your heartbeat every 5 seconds during the entire session:
${channelDir}/heartbeat-${ministerName}.json
{ "sender": "${ministerName}", "timestamp": "(ISO)", "round": (current), "status": "alive" }

If you STOP writing heartbeats for more than 30 seconds, the Judge will consider you DEAD and may replace you.

Use bash to maintain heartbeats while working — run this periodically:
\`\`\`bash
echo '{"sender":"${ministerName}","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","round":${round},"status":"alive"}' > ${channelDir}/heartbeat-${ministerName}.json
\`\`\`

### STEP 2: Write Heartbeat
Write heartbeat file to: ${channelDir}/heartbeat-${ministerName}.json
{
  "sender": "${ministerName}",
  "timestamp": "(current ISO timestamp)",
  "round": ${round},
  "status": "alive"
}

### STEP 3: Poll Loop
After writing your response, enter polling mode:
1. Wait 3 seconds (use bash: sleep 3)
2. Read all files in ${channelDir}/ that match round-*-judge*.json or have "to": "${ministerName}" or "to": "all"
3. If you find a new message FROM the judge addressed to you:
   - Read it, process the instructions
   - Write your response as round-{new_round}-${ministerName}.json
   - Update your heartbeat
4. If you find a message with "type": "terminate" addressed to you or "all":
   - Write a final heartbeat with status: "done"
   - End your session
5. If no new message: go back to step 1 (wait 3 seconds)
6. Max poll iterations: 200 (safety limit — ~10 minutes)

### CRITICAL RULES
- Be CRITICAL. Defend your position with evidence.
- Do NOT agree with other ministers just to reach consensus.
- Only change your position if presented with superior technical reasoning.
- Rate your confidence honestly (0.0 to 1.0).
- Load the tribunal-minister skill for full protocol details.`;
}

/**
 * Build the prompt the Judge passes when delegating to the Radar agent.
 *
 * @param {object} params
 * @param {string} params.sddName    - SDD change name
 * @param {string} params.phaseName  - Current phase
 * @param {string} params.phaseGoal  - What is being investigated
 * @param {string} params.tribunalId - Unique tribunal session ID
 * @param {string} params.channelDir - Absolute path to the channel directory
 * @param {string} params.routerDir  - Path to router/ (for codebase investigation)
 * @returns {string} - Full prompt text for radar delegation
 */
export function buildRadarContext(params) {
  const {
    sddName,
    phaseName,
    phaseGoal,
    channelDir,
    routerDir,
  } = params;

  return `## Tribunal Radar Assignment — ${sddName} / ${phaseName}

You are the RADAR for this tribunal session. You investigate, you do NOT decide.

### Your Mission
Investigate the codebase related to: ${phaseGoal}

### What To Investigate
- Map all code related to the area being changed
- Identify risks: regressions, orphan code, convention violations
- Find edge cases the ministers might miss
- Generate specific questions for the judge

### Investigation Techniques
Use bash tools to investigate the codebase:
- \`grep -r "pattern" ${routerDir} --include="*.js"\` — find usages
- \`find ${routerDir} -name "*.js" -not -path "*/node_modules/*"\` — list source files
- Read files with the Read tool to understand structure
- Use Glob to find files by pattern

### Channel Protocol
- Channel directory: ${channelDir}
- Your agent name: radar
- Write findings to: ${channelDir}/round-1-radar.json (same JSON format as ministers)
- Write heartbeat to: ${channelDir}/heartbeat-radar.json

### Codebase Root
${routerDir}

### HEARTBEAT — CRITICAL
You MUST write your heartbeat every 5 seconds during the entire session:
${channelDir}/heartbeat-radar.json
{ "sender": "radar", "timestamp": "(ISO)", "round": (current), "status": "alive" }

If you STOP writing heartbeats for more than 30 seconds, the Judge will consider you DEAD.

Use bash to maintain heartbeats while working — run this periodically:
\`\`\`bash
echo '{"sender":"radar","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","round":1,"status":"alive"}' > ${channelDir}/heartbeat-radar.json
\`\`\`

### Polling Protocol
After writing your initial findings, enter polling mode:
1. Wait 3 seconds (use bash: sleep 3)
2. Read all files in ${channelDir}/ looking for messages from judge addressed to "radar" or "all"
3. If you find new instructions from the judge:
   - Investigate further and write your response as a new round file
   - Update your heartbeat immediately after writing
4. If you find a message with "type": "terminate":
   - Write a final heartbeat with status: "done"
   - End your session
5. If no new message: go back to step 1
6. Max poll iterations: 200 (safety limit — ~10 minutes)

### CRITICAL
- You do NOT take positions (agree/disagree). You provide FACTS.
- You do NOT recommend solutions. You identify RISKS and ask QUESTIONS.
- Load the tribunal-radar skill for full protocol details.`;
}
