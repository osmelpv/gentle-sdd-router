# GSR Usage Skill

> **Skill for**: Any AI agent that needs to interact with `gsr` (gentle-sdd-router).
> Load this skill when working in a project that uses GSR as its SDD router.

---

## What is gsr?

`gsr` (gentle-sdd-router) is a **declarative, non-executing CLI router** for Spec-Driven Development (SDD). It:

- Routes AI agents to the correct models per SDD phase (orchestrate, spec, apply, verify, etc.)
- Is **report-only** — it never executes providers, agents, or marketplace calls
- Reads and writes `router/router.yaml` as its **source of truth**
- Generates OpenCode overlays and slash commands for host integration
- Manages the Tribunal debate system for multi-agent consensus

**Key principle**: GSR is an external boundary router. It declares routing intent; the host (OpenCode, Claude Code, etc.) executes it.

---

## Source of Truth

```
router/router.yaml        ← canonical config for this project
router/profiles/          ← preset profile YAML files
router/catalogs/          ← custom SDD definitions
router/commands/          ← /gsr-* slash command files
router/contracts/         ← role and phase contracts
router/invoke_configs/    ← invocation configurations
router/skills/            ← skill files deployed to AI environments
```

---

## CLI Commands Reference

### Status & Info

```bash
gsr status                     # Show current router state (active preset, routes, schema version)
gsr version                    # Show installed gsr version
gsr help [command]             # Help for a command or subcommand
```

### Sync

```bash
gsr sync                       # Push global contracts to Engram (dev/repair)
gsr sync --dry-run             # Preview what sync would do
gsr sync --force               # Force sync even when up to date
```

### Route Control

```bash
gsr route use <preset>         # Switch active preset (changes routing, not control)
gsr route show                 # Show resolved routes for current preset
gsr route activate             # gsr takes control of routing
gsr route deactivate           # Hand control back to host
```

### Profile / Preset Management

```bash
gsr profile list               # List all profiles (local, global, gentle-ai)
gsr profile create <name>      # Create empty preset
gsr profile delete <name>      # Delete a preset
gsr profile rename <old> <new> # Rename a preset
gsr profile copy <src> <dst>   # Clone a preset
gsr profile promote <name>     # Promote project preset to global
gsr profile demote <name>      # Demote global preset to project
gsr profile export <name>      # Export preset for sharing (--compact for gsr:// string)
gsr profile import <source>    # Import from file, URL, or gsr:// string
```

### SDD Management

```bash
gsr sdd create <name> [--description <desc>]   # Create new custom SDD
gsr sdd list                                    # List all custom SDDs
gsr sdd show <name>                             # Show SDD details
gsr sdd delete <name> [--yes]                   # Delete a custom SDD
gsr sdd validate [<name>]                       # Validate SDD structure
gsr sdd invoke <name> [--trigger <trigger>]     # Record invocation
gsr sdd invocations                             # List runtime invocation records
gsr sdd invocations <name>                      # Show declared invocations for an SDD
gsr sdd global-sync [--preset <name>]          # Materialize global sdd-* agents
```

### Fallback Chain Management

```bash
gsr fallback list <preset> [phase]             # List fallback chains
gsr fallback set <preset> <phase> <models>     # Replace entire chain (comma-separated)
gsr fallback promote <preset> <phase> <index>  # Promote fallback to primary
```

### Setup & Maintenance

```bash
gsr setup install              # First-time setup / apply install intent
gsr setup bootstrap            # Step-by-step bootstrap path
gsr setup update [--apply]     # Show/apply config migrations
gsr setup uninstall [--confirm] # Remove gsr from project (with backup)
gsr setup apply opencode [--apply] # Generate/write OpenCode overlay

gsr update [--apply]           # Alias for setup update
gsr sync                       # Alias for pushing contracts
```

### Skill Installation

```bash
gsr skill-install              # Install skills to project-local AI environments
gsr skill-install --global     # Install skills to all detected AI environments
```

---

## CRUD Operations

### Profiles (Routing Presets)

| Operation | Command |
|-----------|---------|
| Create    | `gsr profile create <name> [--sdd <sdd>] [--target <model>]` |
| Read/List | `gsr profile list` |
| Update    | `gsr route use <name>` (activate), `gsr profile rename`, `gsr profile copy` |
| Delete    | `gsr profile delete <name>` |
| Promote   | `gsr profile promote <name>` (project → global) |
| Demote    | `gsr profile demote <name>` (global → project) |

### Routes

| Operation | Command |
|-----------|---------|
| Read      | `gsr route show` |
| Switch    | `gsr route use <preset>` |
| Activate  | `gsr route activate` |
| Deactivate| `gsr route deactivate` |

### SDDs (Custom Spec-Driven Definitions)

| Operation | Command |
|-----------|---------|
| Create    | `gsr sdd create <name>` |
| Read/List | `gsr sdd list`, `gsr sdd show <name>` |
| Validate  | `gsr sdd validate <name>` |
| Delete    | `gsr sdd delete <name>` |
| Invoke    | `gsr sdd invoke <name>` |

### Invoke Configs

Stored in `router/invoke_configs/`. Each file is a YAML config for how a phase invocation runs.
Created/managed via `gsr phase invoke` subcommand:

```bash
gsr phase invoke <phase> --sdd <sdd> --target <sdd>/<sub-sdd> --trigger <trigger>
```

---

## Schema Concepts

### `router.yaml` Key Fields

```yaml
version: 4                         # Schema version (current: 4)
active_preset: premium             # Active routing preset name
active_catalog: agent-orchestrator # Active SDD catalog
activation_state: active           # 'active' = gsr controls routing

catalogs:                          # SDD catalog definitions
  agent-orchestrator:
    presets:
      premium:
        phases:                    # Per-phase routing lanes
          orchestrate:
            - target: anthropic/claude-opus-4-5
              contextWindow: 200000
```

### Profile Attributes

- **`visible`** — Whether the profile appears in the host UI
- **`builtin`** — Built-in GSR profile (not user-created)
- **`sdd`** — Which SDD catalog this profile belongs to
- **`phases`** — Map of phase name → array of routing lanes
- **`debug_invoke`** — Debug invocation configuration

### Lane Schema

```yaml
phases:
  orchestrate:
    - target: anthropic/claude-opus-4-5   # Model to route to
      contextWindow: 200000               # Max context tokens
      inputPerMillion: 15.00              # Pricing (per million input tokens)
      outputPerMillion: 75.00             # Pricing (per million output tokens)
      fallbacks:                          # Ordered fallback models
        - anthropic/claude-sonnet-4-6
```

### Fallback Chains

Fallbacks are ordered lists of alternative models if the primary fails:

```yaml
fallbacks:
  - anthropic/claude-sonnet-4-6
  - openai/gpt-5.4
```

Managed with `gsr fallback *` subcommands.

---

## Overlay Generation

GSR generates OpenCode overlays using the **`gsr-{name}` pattern**:

- Each active profile with an `orchestrate` phase gets a `gsr-{profileName}` agent in `opencode.json`
- The overlay is project-local: written to `<project-root>/opencode.json`
- Only `gsr-*` keys are managed — all other `opencode.json` keys are preserved

Example generated agent key: `gsr-premium`, `gsr-local`, `gsr-budget`

```bash
gsr setup apply opencode          # Preview overlay
gsr setup apply opencode --apply  # Write to opencode.json
gsr sync                          # Full sync (overlay + commands + contracts)
```

---

## The Tribunal System

The Tribunal is a **multi-agent debate system** for reaching consensus on technical decisions. It consists of:

### Roles

| Role | Responsibility |
|------|---------------|
| **Judge** | Directs the debate, avoids bias, drives to consensus |
| **Ministers** | Domain experts that debate the technical question |
| **Radar** | Investigates the codebase, identifies risks, generates questions |

### How it Works

1. **Radar** maps the relevant code area and generates questions per dimension
2. **Judge** opens the tribunal with the question + Radar findings
3. **Ministers** debate through structured rounds (independent → brainstorm → compare → synthesize)
4. **Judge** drives to consensus or escalates to user
5. Decision is compressed and passed to the orchestrator

### Comparison Dimensions

- **Security** — auth, injection risks, data exposure
- **Scalability** — load, concurrency, resource usage
- **Cleanliness** — readability, separation of concerns, naming
- **Functionality** — correctness, edge cases, completeness
- **Risk** — regressions, breaking changes, migration complexity
- **Maintainability** — testability, documentation, coupling

### Roles in Detail

#### Minister Role

Ministers are domain experts that debate the technical question. They:
- Receive an assignment from the Judge (via mcp_delegate)
- Write their analysis to `{channelDir}/round-{N}-{name}.json`
- Maintain a heartbeat every 5 seconds: `{channelDir}/heartbeat-{name}.json`
- Poll the channel for Judge instructions
- Only change position when presented with superior technical evidence
- Write a final `status: "done"` heartbeat when the Judge sends "terminate"

Load the `tribunal-minister` skill when you are a minister. It contains the full communication protocol.

#### Judge Role

The Judge directs the debate. They:
- Delegate to ministers and radar using mcp_delegate
- Poll the channel to collect responses
- Advance rounds by writing new question messages
- Monitor minister heartbeats for health
- Replace dead ministers using fallback models
- Write the final decision and terminate the session

Load the `tribunal-judge` skill when you are the judge.

#### Radar Role

Radar investigates the codebase and generates targeted questions. They:
- Map files, find dependencies, detect risks
- Write findings to `{channelDir}/round-1-radar.json`
- Maintain heartbeats and poll for follow-up questions
- Only provide facts — never recommendations or positions

Load the `tribunal-radar` skill when you are radar.

### TribunalChannel

Communication channel for tribunal messages. Used by Judge, Ministers, and Radar.

**Important**: Tribunal participants (ministers, radar) communicate via raw JSON files in the channel directory. They do NOT use the `TribunalChannel` JavaScript class directly — that is for the gsr library. Agents read and write JSON files using bash tools or Write/Read tools.

```javascript
// TribunalChannel API (for gsr library code):
await channel.write(sender, role, type, content, round, options);
const messages = await channel.readAll();
const radarFindings = await channel.readByRole('radar');
await channel.writeDecision(decision);
await channel.compress(lessons, badIdeas, contextForNext);

// Health checking (new):
const health = await channel.checkAgentHealth('minister-1');
// Returns: { alive, reason, heartbeat, watchdogCompatible }
```

### Heartbeat Protocol

Every tribunal participant (judge, ministers, radar) writes a heartbeat file every 5 seconds:

**File**: `{channelDir}/heartbeat-{agentName}.json`

**Format**:
```json
{
  "sender": "minister-1",
  "timestamp": "2026-04-07T12:00:05Z",
  "round": 2,
  "status": "alive"
}
```

**Statuses**:
- `"alive"` — agent is running and processing
- `"done"` — agent completed normally (received "terminate" or finished its work)

**Stale threshold**: 30 seconds without an update → judge considers the agent dead

**Bash command for heartbeat** (run periodically while working):
```bash
echo '{"sender":"minister-1","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","round":2,"status":"alive"}' > {channelDir}/heartbeat-minister-1.json
```

### Fallback System

The tribunal uses two compatible heartbeat systems:

1. **Watchdog** (`.gsr/watchdog/{taskId}.json`): Used by the orchestrator to monitor delegated tasks
   - Format: `{ ts: number (epoch ms), task_id, status, ... }`
   - Functions: `isHeartbeatAlive(hb, thresholdMs)`, `selectFallback(fallbacks, errorType)`

2. **Tribunal heartbeat** (`{channelDir}/heartbeat-{sender}.json`): Used within the tribunal session
   - Format: `{ sender, timestamp: ISO string, round, status }`
   - Functions: `isAgentAlive(sender, maxStaleSec)`, `checkAgentHealth(sender)`

The `toWatchdogFormat(tribunalHb)` function bridges both systems, converting a tribunal heartbeat to watchdog-compatible format so the judge can use `selectFallback()` with tribunal data.

**Fallback chains** are provided in the judge's context:
- `minister_fallbacks`: models to use if a minister crashes (e.g., `['openai/gpt-4o', 'google/gemini-1.5-flash']`)
- `radar_fallbacks`: models to use if radar crashes
- `judge_fallbacks`: models to use if the judge itself needs to recover

Configure fallbacks in `router.yaml`:
```yaml
phases:
  explore:
    tribunal:
      enabled: true
    ministers:
      - model: openai/gpt-5
        fallbacks: [openai/gpt-4o]
      - model: google/gemini-pro
        fallbacks: [google/gemini-1.5-flash]
```

---

## Strict TDD Mode

GSR projects use `node:test` with `node:assert/strict`. Tests are run with:

```bash
npm test     # runs: node --test
```

All new modules must have corresponding tests in `test/`.

---

## Common Workflows

### First-Time Setup in a New Project

```bash
gsr install                    # or: gsr setup install
gsr sync                       # generate overlay + commands
```

### Switch to a Different Model Preset

```bash
gsr profile list               # see available presets
gsr route use <preset-name>    # switch routing
gsr sync                       # apply to opencode.json
```

### Add a Custom SDD Workflow

```bash
gsr sdd create my-workflow --description "Custom workflow"
gsr role create director --sdd my-workflow
gsr phase create concept --sdd my-workflow
gsr profile create my-profile --sdd my-workflow
gsr sync
```

### Check Router Health

```bash
gsr status                     # quick status
gsr status --verbose           # full detail
gsr sdd validate               # validate all SDDs
```
