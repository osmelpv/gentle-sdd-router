## GSR Watchdog Heartbeat Protocol

You are a **long-running sub-agent** (sdd-apply, sdd-verify, or similar).
The orchestrator that launched you is monitoring your health via heartbeat.
If it does not receive a heartbeat within **90 seconds**, it will declare you
timed out, save a checkpoint, and relaunch with a fallback model.

---

## Your Obligations

### 1. Write heartbeat #0 BEFORE doing any work

The VERY FIRST thing you do — before reading files, before writing code — is write
a heartbeat signaling you are alive. The orchestrator gives you 45 seconds grace
for this initial heartbeat. If it never arrives, you are assumed dead.

### 2. Write a heartbeat after every 3 tasks completed (or every ~30 seconds)

Do not wait until the end. Write progress heartbeats throughout your work so the
orchestrator knows you are still alive and can recover from the last checkpoint.

### 3. Write a final heartbeat with `status: "done"` when finished

Before returning your final result, write one last heartbeat marking completion.
This allows the orchestrator to confirm success even if the task_result delivery fails.

---

## Heartbeat Schema

```json
{
  "ts": 1712345678901,
  "task_id": "watchdog-gsr-ux-overhaul-apply-1712345678",
  "agent": "sdd-apply",
  "status": "started | in_progress | done | failed",
  "change": "gsr-ux-overhaul",
  "done": ["T1.1", "T2.1"],
  "current": "T3.1",
  "next": "T4.1",
  "checkpoint_key": "sdd/gsr-ux-overhaul/apply-progress"
}
```

**Required**: `ts`, `task_id`, `status`
**Recommended**: `agent`, `change`, `done`, `current`, `checkpoint_key`

---

## How to Write the Heartbeat

The orchestrator tells you which backend to use in your prompt.
Look for: `watchdog_backend: "engram"` or `watchdog_backend: "filesystem"`.

### Backend A — Engram (when gentle-ai ecosystem is available)

```
mem_save(
  title: "gsr/watchdog/{task_id}",
  topic_key: "gsr/watchdog/{task_id}",
  type: "architecture",
  project: "{project}",
  content: '{"ts":DATE_NOW,"task_id":"{task_id}","agent":"{agent}","status":"started","change":"{change}","done":[],"current":null,"checkpoint_key":null}'
)
```

Replace `DATE_NOW` with the actual current Unix timestamp in milliseconds.
Use `topic_key` so repeated writes UPDATE rather than create new entries.

### Backend B — Filesystem (when Engram is NOT available)

```bash
mkdir -p .gsr/watchdog
echo '{"ts":DATE_NOW,"task_id":"{task_id}","agent":"{agent}","status":"started","change":"{change}","done":[],"current":null,"checkpoint_key":null}' > .gsr/watchdog/{task_id}.json
```

The path is always relative to the project root (current working directory).

---

## Thresholds (for your reference)

| Event | Threshold |
|-------|-----------|
| Initial heartbeat grace | 45 seconds |
| Max interval between heartbeats | 30 seconds |
| Timeout declared by orchestrator | 90 seconds without heartbeat |

---

## Example — Full Heartbeat Sequence

```
[sub-agent starts]

  → write heartbeat #0: { status: "started", current: null, done: [] }

[completes T1.1, T1.2, T1.3]

  → write heartbeat #1: { status: "in_progress", done: ["T1.1","T1.2","T1.3"], current: "T2.1", checkpoint_key: "sdd/change/apply-progress" }

[completes T2.1, T2.2, T2.3]

  → write heartbeat #2: { status: "in_progress", done: ["T1.1"..."T2.3"], current: "T3.1" }

[all tasks complete]

  → write heartbeat #3: { status: "done", done: ["T1.1"..."T4.2"] }

[return task_result to orchestrator]
```

---

## Failure Conditions

| What happens | Orchestrator sees |
|-------------|------------------|
| Your model gets 429 and can respond | Emit GSR_FALLBACK_REQUEST (see fallback-protocol.md) |
| Your model crashes before responding | Heartbeat stops updating → timeout after 90s |
| Your model never starts | Heartbeat #0 never written → timeout after 45s |
| You complete but return empty result | Heartbeat `status: done` but empty task_result → orchestrator retries |
