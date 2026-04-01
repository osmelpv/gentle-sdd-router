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
│   ├── sync.js                     # Low-level contract manifest generation
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
            ├── manage.js           # Profile/catalog management
            ├── catalog-profiles.js # Catalog + profiles view
            ├── catalogs.js         # Catalog list screen
            ├── profile-detail.js   # Profile detail and route view
            ├── create-profile-wizard.js  # Profile creation wizard
            ├── edit-profile-wizard.js    # Profile editing wizard
            ├── agent-identity-editor.js  # Identity resolution viewer
            ├── sdd-list.js         # Custom SDD list
            ├── sdd-detail.js       # Custom SDD detail view
            ├── sdd-create-wizard.js # Custom SDD creation wizard
            ├── sdd-phase-editor.js # Phase contract editor
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

`catalog create`, `catalog enable`, `catalog disable`, and `profile create` automatically trigger `unifiedSync`. This means a single operation keeps contracts, overlay, and commands in sync without requiring a manual `gsr sync`.

### Simple status vocabulary

`gsr status` (without flags) shows a simplified view: emoji, one-line message, active preset, activation state. Full details are behind `--verbose`. This hides overlay mechanics from everyday use.

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
