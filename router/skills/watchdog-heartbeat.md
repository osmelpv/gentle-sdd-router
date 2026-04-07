# Watchdog Heartbeat Protocol

## Why This Exists
When you are delegated a task by an orchestrator, the orchestrator has NO WAY to know if you're still alive. If you run out of tokens, crash, or time out — the orchestrator waits forever.

To prevent this, you MUST write a heartbeat file periodically so the orchestrator can detect if you've died and replace you with a fallback model.

## Heartbeat Directory
`.gsr/watchdog/` in the project root.

## Your Heartbeat File
`{project_root}/.gsr/watchdog/{your-task-id}.json`

The task ID is provided to you when you're delegated. If not provided, use your agent name (e.g., `sdd-apply`, `sdd-explore`, `sdd-verify`).

## Heartbeat Format
```json
{
  "ts": 1234567890123,
  "task_id": "{your-task-id}",
  "agent": "{your-agent-name}",
  "status": "running",
  "phase": "{current-phase}",
  "progress": "{what you're working on}",
  "model": "{your-model-id}"
}
```

## Protocol
1. **On Start**: Create the `.gsr/watchdog/` directory if it doesn't exist, then write your first heartbeat
2. **Every 15-30 seconds**: Update your heartbeat file with current timestamp and progress
3. **On Complete**: Write a final heartbeat with `"status": "completed"` and your result summary
4. **On Error**: Write a heartbeat with `"status": "error"` and the error message

## How To Write (bash)
```bash
mkdir -p .gsr/watchdog
echo '{"ts":'$(date +%s%3N)',"task_id":"MY_TASK","agent":"sdd-apply","status":"running","progress":"implementing feature X","model":"anthropic/claude-sonnet"}' > .gsr/watchdog/MY_TASK.json
```

Or using the Write tool:
- Path: `.gsr/watchdog/{task-id}.json`
- Content: the JSON heartbeat object

## CRITICAL
- If you stop writing heartbeats for more than 90 seconds, the orchestrator will consider you DEAD
- The orchestrator may replace you with a fallback model
- Always write a "completed" or "error" heartbeat before ending your session
- Include `progress` so the orchestrator knows what you were working on if it needs to resume with a fallback
