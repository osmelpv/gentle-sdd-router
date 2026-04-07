# Architecture

## Core Principle

gsr is a **declarative, non-executing router**. It reads YAML, resolves routes, and reports metadata. It never calls models, runs providers, or orchestrates agents.

```
┌─────────────────────────────────────────────────┐
│                  gsr (router)                    │
│                                                  │
│  Reads YAML → Resolves routes → Reports metadata │
│                                                  │
│  ❌ Never executes models                        │
│  ❌ Never calls providers                        │
│  ❌ Never orchestrates agents                    │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼ declarative contracts
┌──────────────────────────────────────────────────┐
│            Host (gentle-ai, OpenCode, etc.)       │
│                                                   │
│  Reads contracts → Assigns models → Executes      │
└──────────────────────────────────────────────────┘
```

## Module Structure

```
src/
├── cli.js                          # CLI entry point, command dispatch
├── router-config.js                # Barrel re-exports
├── core/
│   ├── router.js                   # YAML parse/stringify, validation, state resolution
│   ├── router-schema-v3.js         # Schema v3 normalization and validation
│   ├── router-v4-io.js             # v4 multi-file load/save/assembly
│   ├── controller.js               # gentle-ai detection, controller label resolution
│   ├── phases.js                   # Canonical phase list and metadata
│   ├── preset-io.js                # import/export helpers and compact sharing format
│   ├── agent-identity.js           # Layered context resolution (AGENTS.md inheritance)
│   ├── status-reporter.js          # Simple status vocabulary (emoji + one-liner)
│   ├── unified-sync.js             # Unified sync: contracts + overlay + commands + validate
│   ├── sdd-catalog-io.js           # Custom SDD create/read/delete in router/catalogs/
│   ├── sdd-invocation-io.js        # Cross-SDD invocation records in .gsr/invocations/
│   ├── tribunal-channel.js         # Tribunal debate channel (file-based I/O)
│   ├── tribunal-io.js              # Tribunal file backend (messages, metadata, compression)
│   ├── tribunal-context.js         # Context builders for judge/minister/radar delegation
│   ├── watchdog-context.js         # Heartbeat/monitor context builders
│   ├── skill-installer.js          # Auto-install skills to detected environments
│   ├── watchdog.js                 # Filesystem heartbeat backend
│   ├── sync.js                     # Low-level contract manifest generation (v1/v2/v3)
│   └── migrations/
│       ├── index.js                # Migration planner, runner, backup/restore
│       └── 001_v3-to-v4-multifile.js  # First migration script
├── adapters/
│   └── opencode/
│       ├── index.js                # OpenCode adapter (load/save, install, reports)
│       ├── overlay-generator.js    # OpenCode TAB-switching overlay generation
│       ├── multimodel-contract.js  # Browse/compare metadata contracts
│       ├── multimodel-orchestration-manager-contract.js
│       ├── provider-execution-contract.js
│       ├── handoff-delegation-contract.js
│       ├── agent-teams-lite-contract.js
│       └── runtime-contract.js
└── ux/
    ├── wizard.js                   # Interactive wizard (@clack/prompts)
    └── tui/                        # Full-screen TUI (Ink 6 + React 19)
        ├── app.js                  # TUI entry point (fullscreen-ink)
        └── screens/                # Split-panel screens (@inkjs/ui)
            ├── home.js             # Home screen, navigation hub
            ├── status.js           # Router status screen
            ├── manage.js           # Preset management
            ├── catalog-profiles.js # Internal source + preset view (legacy bridge)
            ├── catalogs.js         # Internal source list screen (legacy bridge)
            ├── profile-detail.js   # Preset detail and route view
            ├── create-profile-wizard.js  # Preset creation wizard
            ├── edit-profile-wizard.js    # Preset editing wizard
            ├── agent-identity-editor.js  # Identity resolution viewer
            ├── sdd-list.js         # Custom SDD list
            ├── sdd-detail.js       # Custom SDD detail view (shows invoke per phase)
            ├── sdd-create-wizard.js # Custom SDD creation wizard
            ├── sdd-phase-editor.js # Phase contract editor (includes invoke config section)
            ├── sdd-role-editor.js  # Role contract editor
            ├── fresh-install.js    # First-time install screen
            └── settings.js         # Settings screen
```

## Data Flow

### Loading config

```
router/router.yaml
       │
       ▼ parseYaml()
   raw config object
       │
       ├─ version 1 ──→ normalizeRouterSchemaV3() ──┐
       ├─ version 3 ──→ normalizeRouterSchemaV3() ──┤
       └─ version 4 ──→ loadV4Profiles() ───────────┤
                        assembleV4Config() ──────────┤
                        normalizeRouterSchemaV3() ───┘
                                                     │
                                                     ▼
                                           router-schema-v3-view
                                           (unified format for all consumers)
```

All schema versions produce the **same normalized view**. Downstream consumers (CLI, adapters, contracts) never deal with version differences.

### Saving config (v4)

```
config object
       │
       ▼ buildV4WritePlan(old, new)
   write plan: { coreChanged, profileWrites, profileDeletes }
       │
       ├─ profileWrites ──→ write profiles first (atomic temp+rename)
       └─ coreContent ────→ write core last (crash-safe ordering)
```

### Unified sync flow

```
gsr sync
   │
   ▼ unifiedSync({ configPath, dryRun, force })
   │
   ├─ step: contracts
   │    generateSyncManifest(contractsDir)
   │    writes router/contracts/.sync-manifest.json
   │
   ├─ step: overlay + apply
   │    applyOpenCodeOverlayCommand({ apply: true, configPath })
   │    writes opencode.json (project-local)
   │    preserves user-modified entries
   │
   ├─ step: commands
   │    deployGsrCommands()
   │    writes router/commands/*.md slash command files
   │
   └─ step: validate
        checks catalog visibility, manifest completeness
```

`gsr sync` is idempotent — running it again when nothing changed reports "Already up to date."

### Migration flow

```
planMigrations(routerDir)
       │
       ▼
   pending migrations list
       │
       ▼ for each migration:
   createBackup() → apply() → validate() → updateRegistry()
       │                                          │
       └─ on failure: restoreBackup() ◄───────────┘
```

### Agent identity resolution

```
resolveIdentity(preset, { cwd })
   │
   ▼ layered sources (lowest to highest priority):
   1. global gentle-ai AGENTS.md  (if gentle-ai installed)
   2. project AGENTS.md           (cwd-relative lookup)
   3. preset.agentsContext        (inline override in preset YAML)
   │
   └─ merged prompt + sources array
```

### Invocation flow

Cross-catalog invocations follow a parent/child record pattern:

```
sdd.yaml phase declares invoke:
   catalog: art-production
   sdd: asset-pipeline
   payload_from: output
   await: true
         │
         ▼ gsr sdd invoke art-production/asset-pipeline
              --from game-design/game-design
              --phase level-design
              --payload "..."
         │
         ▼ createInvocation() [pure data write]
    .gsr/invocations/{uuid}.json
    { id, status: "pending", caller, callee, payload, ... }
         │
         │ (host/orchestrator reads record and launches callee)
         │
         ▼ callee completes
    gsr sdd invoke-complete {id} --result "..."
         │
         ▼ completeInvocation() [pure data write]
    .gsr/invocations/{uuid}.json
    { id, status: "completed", result: "...", completed_at: "..." }
```

**Non-executing boundary**: `gsr` only reads and writes JSON records. It never evaluates `invoke` declarations, never calls the callee, and never orchestrates any workflow. Records declare intent; execution belongs to the host.

**Manifest version**: When any SDD phase has a non-null `invoke`, `generateSyncManifest()` emits `version: 3`. v3 is a strict superset of v2 — existing consumers of v1/v2 manifests are unaffected.

```
Custom SDDs present, no invoke → manifest version: 2
Any phase has invoke declaration → manifest version: 3
No custom SDDs → manifest version: 1
```

## Tribunal Architecture

The Tribunal system orchestrates structured multi-agent debate for phases that require multiple perspectives.

### Communication flow

```
Orchestrator
  |
  +- delegates to Judge (sub-orchestrator)
       |
       +- sends initial prompt to each minister via file channel
       |
       +- Minister 1 reads .tribunal/{sdd}/{phase}/inbox-minister-1.json
       +- Minister 2 reads .tribunal/{sdd}/{phase}/inbox-minister-2.json
       +- Minister N reads .tribunal/{sdd}/{phase}/inbox-minister-N.json
       |
       +- ministers write responses to outbox-minister-{name}.json
       |
       +- Judge reads all outbox files, synthesizes, writes next round
       |
       +- Radar (optional) reads codebase, writes risk report to radar-report.json
       |
       +- Judge reads radar-report.json, feeds targeted questions to ministers
       |
       +- After max_rounds or consensus: Judge writes final decision
```

### File layout

```
.tribunal/
  {sdd}/
    {phase}/
      inbox-{name}.json         # Judge -> minister messages
      outbox-{name}.json        # Minister -> judge responses
      radar-report.json         # Radar -> judge risk analysis
      heartbeat-{name}.json     # Per-agent liveness signal
      decision.json             # Final synthesized output
```

### Round protocol

| Round | Who acts | What happens |
|-------|----------|--------------|
| 1 — Independent | All ministers | Respond without seeing each other |
| 2 — Brainstorming | Judge + ministers | Judge formulates directed questions per dimension |
| 3 — Comparison | Judge + ministers | Judge presents matrix; ministers evaluate each other |
| 4 — Synthesis | Judge | Proposes combined response; ministers confirm or defend |
| Tiebreak | Judge or user | No consensus after max_rounds: judge decides or escalates |

## Watchdog Protocol

Sub-agents and tribunal participants write heartbeat files on a regular schedule. The orchestrator and Judge monitor these to detect and replace dead agents.

### Heartbeat flow

```
Agent writes heartbeat -> Orchestrator polls -> Stale? -> Read fallback chain -> Spawn replacement
```

### Orchestrator watchdog

```
.gsr/watchdog/
  {taskId}.json     # { agentId, taskId, model, lastSeen, status }
```

- Written every 15-30 seconds by each sub-agent
- Monitored by orchestrator on each polling cycle
- Stale threshold: 90 seconds without update
- On stale: orchestrator reads `minister_fallbacks` from preset and spawns replacement

### Tribunal heartbeat

```
.tribunal/{sdd}/{phase}/
  heartbeat-{name}.json   # { name, role, model, lastSeen }
```

- Written every 5-15 seconds by each tribunal participant (judge, ministers, radar)
- Monitored by Judge every 10-20 seconds
- On stale minister: Judge picks next model from `minister_fallbacks` list
- On stale radar: Judge continues without it (radar is optional)
- On stale judge: escalates to orchestrator (orchestrator restarts the tribunal)

## Key Design Decisions

### Normalization gateway

All schema versions converge to one internal format (`router-schema-v3-view`). This means:
- Adding a new schema version only requires a new normalizer
- All downstream code works unchanged
- Testing covers one format, not N

### Non-enumerable metadata

v4 assembled configs carry `_v4Source` as a non-enumerable property. This lets the save path know the config came from multi-file loading, without polluting the config object visible to consumers.

### Controller resolution

The controller label ("Alan/gentle-ai" or "host") is resolved at runtime by scanning PATH directories for the `gentle-ai` binary. No process execution — just `fs.existsSync()`. The result is cached for the process lifetime.

### Persona and pricing hints

`router/router.yaml` can declare a `persona` value (`gentleman`, `neutral`, `custom`) and lanes can declare `inputPerMillion`, `outputPerMillion`, and `contextWindow`. These are declarative hints used by hosts and UIs — not runtime execution controls.

### Atomic writes

All file writes use temp-file + rename pattern. For v4 multi-file saves, profiles are written first, core file last. If the process crashes mid-write, the core file still points to valid profile files.

### Auto-wiring

`preset create` and legacy internal-source operations automatically trigger `unifiedSync`. This means a single operation keeps contracts, overlay, and commands in sync without requiring a manual `gsr sync`.

### Simple status vocabulary

`gsr status` shows a unified output: state header (Ready/Needs sync/Not installed), configuration (schema, environment, OS), active preset with phase count, SDD, scope, visibility, identity, debug wiring, preset counts, custom SDD counts, and an SDD connections summary.

## Dependencies

**Production**:
- `@clack/prompts` — interactive fallback wizard
- `ink` ^6.8.0 — React renderer for the terminal TUI
- `react` ^19.2.4 — component model for the TUI
- `@inkjs/ui` ^2.0.0 — pre-built Ink UI components (split panels, text input, etc.)
- `fullscreen-ink` ^0.1.0 — fullscreen mode wrapper for Ink apps

**Development**: none

**Runtime**: Node.js 20+ standard library (`node:fs`, `node:path`, `node:crypto`, `node:test`, `node:assert`)

## Schema Versions

| Version | Introduced | Structure |
|---------|-----------|-----------|
| v1 | Initial | `profiles.{name}.phases.{phase}[]` — flat arrays of model targets |
| v3 | Multimodel | `catalogs.{name}.presets.{name}.phases.{phase}[]` — lanes with kind/role/target/fallbacks |
| v4 | Multi-file | Core YAML + `profiles/*.router.yaml` — one file per preset, assembled into v3 format |

## Testing

```bash
node --test                    # run all tests
node --test test/specific.js   # run specific test file
```

Tests use `node:test` (built-in) and `node:assert/strict`. Temp directories with cleanup for file I/O tests.
