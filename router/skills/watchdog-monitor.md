# Watchdog Monitor Protocol

## Why This Exists
When you delegate tasks to sub-agents, those sub-agents may die silently (quota exhaustion, timeout, model failure). Without monitoring, you'll wait forever for a response that never comes.

## How It Works
Sub-agents write heartbeat files to `.gsr/watchdog/{task-id}.json`. You poll these files to detect when an agent has died, then replace it with a fallback model.

## Monitoring Protocol

### After Delegating a Sub-Agent
1. Note the task ID you assigned to the sub-agent
2. Note the current timestamp (this is the delegation start time)
3. Wait for the initial grace period (45 seconds) — the agent needs time to start
4. After grace period, check the heartbeat file every 15-30 seconds

### Checking a Heartbeat
Read `.gsr/watchdog/{task-id}.json`:
- If file doesn't exist AND grace period (45s) has passed → agent never started → DEAD
- If file exists, check the `ts` field:
  - `Date.now() - ts < 90000` (90 seconds) → agent is ALIVE
  - `Date.now() - ts >= 90000` → heartbeat is STALE → agent is DEAD
- If `status` is "completed" → agent finished successfully
- If `status` is "error" → agent failed, read the error message

### When an Agent Dies
1. Read the agent's last heartbeat to understand what it was doing (`progress` field)
2. Read the fallback chain for this agent's model from the profile config
3. Look up the next fallback model using `selectFallback(fallbacks, errorType)`:
   - errorType: 'timeout' if heartbeat went stale, 'quota_exceeded' if 429 suspected, 'any' if unknown
4. Delegate the SAME task to a NEW agent using the fallback model
5. Pass the original context PLUS: what the dead agent was working on (from `progress`)
6. Write a note about the replacement to metadata for traceability

### Fallback Chain
The fallback chain is defined in the profile's phase config:
```yaml
phases:
  apply:
    - kind: orchestrator
      role: agent
      target: anthropic/claude-opus
      fallbacks: openai/gpt-5, google/gemini-pro
```

If `anthropic/claude-opus` dies, try `openai/gpt-5`. If that dies, try `google/gemini-pro`.

### How To Check (bash)
```bash
# Read heartbeat
cat .gsr/watchdog/{task-id}.json

# Check if stale (older than 90 seconds)
# Compare ts with current time in milliseconds
```

Or using the Read tool to read the JSON file and check the `ts` field.

## CRITICAL
- Do NOT monitor continuously in a tight loop — check every 15-30 seconds
- Do NOT kill an agent just because one heartbeat is late — use the 90-second threshold
- Always check if the agent completed successfully before assuming it's dead
- When replacing an agent, pass the FULL original context — don't assume the replacement has any prior knowledge
- Log every replacement for debugging (write to `.gsr/watchdog/replacements.log`)
