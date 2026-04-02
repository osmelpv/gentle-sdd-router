<div align="center">

<a href="assets/img/gsr-logo.png">
<img src="assets/img/gsr-logo.png" alt="GSR — Gentle SDD Router" width="200">
</a>

<h1>Gentle SDD Router</h1>

<p><strong>AI context system. Dynamic workflow factory. Multi-model routing. Three pillars, one name.</strong></p>

<p>
<img src="https://img.shields.io/badge/status-BETA-orange?style=for-the-badge" alt="Beta">
</p>

<p>
<a href="https://github.com/osmelpv/gentle-sdd-router/releases"><img src="https://img.shields.io/github/v/release/osmelpv/gentle-sdd-router" alt="Release"></a>
<img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg" alt="License: UNLICENSED">
<img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js 20+">
<img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows%20WSL-lightgrey" alt="Platform">
</p>

<blockquote>
<p>⚠️ <strong>Beta</strong> — This project is under active development. APIs, schema, and presets may change. <a href="https://github.com/osmelpv/gentle-sdd-router/issues">Report issues</a>.</p>
</blockquote>

</div>

---

**`gentle-sdd-router`** is a declarative, non-executing router. The name is the architecture:

| Component | Pillar | What it does |
|-----------|--------|--------------|
| **gentle** | AI Context System | Identity, AGENTS.md inheritance, persona contracts |
| **sdd** | Dynamic Workflow Factory | Custom phases, cross-catalog invocation, department workflows |
| **router** | Model Routing | Phase-based model assignment, fallbacks, judge/radar patterns |

Each pillar is useful independently. All three compose naturally. `gsr` reads YAML, resolves routes, and writes invocation records. **It never calls models, runs providers, or executes orchestration.**

---

## Three Pillars

### 🟣 Gentle — AI Context System

The **gentle** pillar manages the AI agent identity and context ecosystem. It:

- Inherits `AGENTS.md` context through directory trees (project → global → user)
- Defines per-preset persona overrides (Gentleman style, neutral, custom)
- Ships agent contracts (9 role contracts + 10 phase compositions) as skills
- Publishes `/gsr` session-sync metadata for the host TUI

```bash
gsr identity show [--preset <name>]   # Resolve layered AGENTS.md context
gsr sync                               # Push contracts to host (idempotent)
```

Start here if you want **consistent AI personas** and **inherited context** across all your agents.

---

### 🔵 SDD — Dynamic Workflow Factory

The **sdd** pillar turns your project into a factory of named workflows. Each workflow (SDD) defines its own phases, role contracts, and — most powerfully — **cross-catalog invocations**.

#### Custom SDDs

```bash
gsr sdd create game-design            # Scaffold a new SDD catalog
gsr sdd list                          # List all SDD workflows
gsr sdd show game-design              # Show phases and invoke declarations
```

An `sdd.yaml` defines your workflow structure:

```yaml
name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define the game concept"
    execution: parallel
    agents: 2
    judge: true
  level-design:
    intent: "Design levels and encounters"
    depends_on:
      - concept
    # Invoke another catalog when this phase runs
    invoke:
      catalog: art-production
      sdd: asset-pipeline
      payload_from: output
      await: true
```

#### Cross-Catalog Invocation — The Key Differentiator

A phase can declare its intent to **invoke another SDD catalog**. `gsr` writes an invocation record to `.gsr/invocations/` — a pure data operation. **No execution happens here.** The host or orchestrator reads the record and launches the callee.

```bash
# Create an invocation record (data-only, non-executing)
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Level 3 assets needed"

# The command prints the invocation id:
# Invocation created: 550e8400-e29b-41d4-a716-446655440000

# When the callee completes, mark it:
gsr sdd invoke-complete 550e8400-e29b-41d4-a716-446655440000 --result "Assets delivered"

# Check status:
gsr sdd invoke-status 550e8400-e29b-41d4-a716-446655440000

# List all invocations (filter by status):
gsr sdd invocations [--status pending|completed|failed]
```

**Non-executing boundary**: `gsr` writes the record. The record declares intent. Execution belongs to the host.

#### Department-Style Collaboration

Cross-catalog invocation enables department workflows: `game-design` invokes `art-production`, which invokes `sound-design`. Each catalog is a team. Each invocation record is a work order. `gsr` manages the records — your orchestrator manages the work.

Start here if you want **named development workflows** with **cross-team coordination**.

---

### 🔴 Router — Model Routing

The **router** pillar assigns AI models to development phases with fallbacks, multi-vendor diversity, and judge/radar patterns.

#### The Octopus Pattern: Multi-Agent by Phase

```
    PREPARATION                  EXECUTION                VERIFICATION
    (the tentacles)              (the brain)              (the sabuesos)
    ─────────────                ─────────                ─────────────
    N agents from                ONE agent                Specialized
    different providers          writes code              testers in
    explore the same             with full                parallel
    prompt                       context                  verify
         │                           │                         │
         ▼                           ▼                         ▼
    ┌─────────┐                ┌───────────┐            ┌───────────┐
    │ Agent A │ GPT-5          │           │            │ Code Test │
    │ Agent B │ Claude Opus    │  Apply    │            │ UI Test   │
    │ Agent C │ Gemini Pro     │  (best    │            │ Risk Det. │
    │ Radar   │ scans blinds   │   coder)  │            │ Security  │
    │ Judge   │ synthesizes    │           │            │ Judge     │
    └─────────┘                └───────────┘            └───────────┘
```

**An army prepares context. ONE king executes. A team of sabuesos verifies.**

#### 10 SDD Phases

| Phase | Job | Composition | Execution |
|-------|-----|-------------|-----------|
| **orchestrator** | Coordinate the pipeline | 1 agent + optional judge | Sequential |
| **explore** | Investigate codebase | 2+ agents + judge + radar | **Parallel** |
| **propose** | Structure a formal proposal | 1 agent + optional judge | Sequential |
| **spec** | Write requirements | 2+ agents + judge + investigator | **Parallel** |
| **design** | Architecture and decisions | 2+ agents + judge + radar | **Parallel** |
| **tasks** | Task checklist + TDD tests | 1 agent | Sequential |
| **apply** | Write code. **Always ONE agent.** | 1 agent only | Sequential |
| **verify** | Validate implementation | 2+ sabuesos + judge + radar | **Parallel** |
| **debug** | Diagnose bugs | Full mini-SDD cycle | **Conditional** |
| **archive** | Sync specs, archive change. **Always ONE agent.** | 1 agent only | Sequential |

#### Built-in Presets

| Preset | Best for |
|--------|----------|
| **multivendor** | Best model per phase across all providers |
| **claude** | Anthropic-only workflows |
| **openai** | GPT-focused workflows |
| **multiagent** | Cross-provider validation (2 lanes per phase) |
| **ollama** | 100% local models, zero cloud costs |
| **local-hybrid** | Local first, free cloud fallbacks |
| **cheap** | Budget models with solid performance |
| **heavyweight** | Maximum depth (5 lanes: 3 models + judge + radar) |
| **safety** | Read-only analysis mode |

```bash
gsr route use multivendor             # Switch preset
gsr route show                        # See resolved routes
gsr status                            # Current state + pricing
```

Start here if you want **multi-model routing** with **fallbacks and judge/radar patterns**.

---

## Installation

### From npm (recommended)

```bash
npm install -g gentle-sdd-router
```

### From source

```bash
git clone https://github.com/osmelpv/gentle-sdd-router.git
cd gentle-sdd-router
npm install && npm link
```

### First setup

```bash
gsr                    # interactive wizard
gsr setup install      # or direct install
```

---

## Quick Start

```bash
# 1. Install globally
npm install -g gentle-sdd-router

# 2. Initialize in your project
cd your-project
gsr setup install

# 3. Sync contracts + overlay (do everything at once)
gsr sync

# 4. Check status
gsr status
```

See [Getting Started](docs/getting-started.md) for the full AI-operable setup guide.

---

## Commands

```
gsr status [--verbose]              Current state, routes, pricing
gsr version                         Installed version
gsr help [command]                  Help for any command
gsr sync [--dry-run] [--force]      Full sync: contracts + overlay + commands

gsr route use <preset>              Switch active preset
gsr route show                      Show resolved routes
gsr route activate                  gsr takes routing control
gsr route deactivate                Host takes control back

gsr profile list                    List profiles with catalog info
gsr profile show [name]             Show routes for a profile
gsr profile create <name>           Create empty profile (auto-syncs)
gsr profile delete <name>           Delete profile
gsr profile rename <old> <new>      Rename profile
gsr profile copy <src> <dest>       Clone profile
gsr profile export <name>           Export for sharing (--compact)
gsr profile import <source>         Import from file/URL/gsr://

gsr catalog list                    List catalogs with status
gsr catalog create <name>           Create catalog (auto-enables + auto-syncs)
gsr catalog delete <name>           Delete empty catalog
gsr catalog enable <name>           Show in TUI host (TAB cycling) + auto-sync
gsr catalog disable <name>          Hide from TUI host + auto-sync
gsr catalog move <profile> <cat>    Move a profile to a different catalog
gsr catalog use <name> [preset]     Set active catalog and preset

gsr inspect browse [selector]       Multimodel metadata
gsr inspect compare <a> <b>         Compare two presets
gsr inspect render <target>         Host boundary preview

gsr setup install                   Install router config
gsr setup uninstall [--confirm]     Remove gsr overlay + router/ (with backup)
gsr setup bootstrap                 Guided first-time setup
gsr setup update [--apply]          Config migrations
gsr setup apply <target> [--apply]  Generate TUI overlay (writes to ./opencode.json)

gsr identity show [--preset <name>] Resolve and display agent identity

gsr sdd create <name>               Create custom SDD workflow
gsr sdd list                        List custom SDDs
gsr sdd show <name>                 Show SDD phases and triggers
gsr sdd delete <name> [--yes]       Delete custom SDD

gsr sdd invoke <catalog>/<sdd>      Create cross-catalog invocation record
  --from <catalog>/<sdd>              Caller identity (required)
  --phase <name>                      Calling phase name (required)
  --payload <string>                  Data to pass to callee (optional)

gsr sdd invoke-complete <id>        Mark invocation as completed
  --result <string>                   Result data (optional)
  --failed                            Mark as failed instead

gsr sdd invoke-status <id>          Show invocation record details
gsr sdd invocations                 List all invocations
  --status <filter>                   Filter: pending | running | completed | failed

gsr role create <name> --sdd <sdd>  Create role contract for a custom SDD
gsr phase create <name> --sdd <sdd> Create phase contract for a custom SDD
```

Each category supports `help`: `gsr route help`, `gsr catalog help`, `gsr sdd help`, etc.

---

## Sync Manifest Versions

The `.sync-manifest.json` file version reflects what the catalog contains:

| Version | When generated | Contents |
|---------|---------------|----------|
| v1 | No custom SDDs | Global contracts only |
| v2 | Custom SDDs, no invoke | + custom_sdds array |
| v3 | Any phase has `invoke` | + invoke declarations per phase |

---

## Agent Contracts

`gsr` ships with 19 contracts:

```
router/contracts/
  roles/                          # 9 role contracts
    agent.md                      # Generic sub-agent
    judge.md                      # Debate director (anonymous synthesis)
    radar.md                      # Blind-spot scanner
    tester.md                     # TDD test writer (tests must FAIL first)
    risk-detector.md              # Incompatibility/regression scanner
    security-auditor.md           # Security vulnerability detector
    investigator.md               # External research (APIs, prior art)
    judge-debate-protocol.md      # Master debate protocol
    radar-context-protocol.md     # How radar feeds the judge
  phases/                         # 10 phase compositions
    orchestrator.md ... archive.md
```

`gsr sync` generates `.sync-manifest.json` so the host TUI can discover and consume all contracts.

---

## Profile Structure

### Multi-file v4 layout

```
router/
  router.yaml                    # core config
  profiles/
    multivendor.router.yaml      # one preset per file
    claude.router.yaml
    ...
```

### Core file (`router/router.yaml`)

```yaml
version: 4
active_preset: multivendor
activation_state: active
metadata:
  installation_contract:
    source_of_truth: router/router.yaml
    runtime_execution: false
catalogs:
  default:
    displayName: SDD-Orchestrator
    enabled: true
```

---

## Architecture

### Non-executing boundary

`gsr` is a **report-only, non-executing** tool. It:

- Reads and writes YAML configuration
- Resolves phase routes and fallback chains
- Writes invocation records to `.gsr/invocations/` (pure data)
- Reports compatibility and boundary metadata
- **Never** calls models, providers, or agents
- **Never** evaluates `invoke` declarations — only persists them as records

Execution belongs to the host (gentle-ai, agent-teams-lite, or your own orchestrator).

### Invocation Records

When a phase declares `invoke:`, `gsr sdd invoke` writes:

```
.gsr/invocations/{uuid}.json
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "caller": { "catalog": "game-design", "sdd": "game-design", "phase": "level-design" },
  "callee": { "catalog": "art-production", "sdd": "asset-pipeline" },
  "payload": "Level 3 assets needed",
  "result": null,
  "created_at": "2026-04-01T00:00:00.000Z",
  "updated_at": "2026-04-01T00:00:00.000Z",
  "completed_at": null
}
```

The record is data. Your orchestrator decides what to do with it.

### Schema versions

| Version | Structure | Status |
|---------|-----------|--------|
| v1 | Single file, profiles with phases | Supported (backward compat) |
| v3 | Single file, catalogs with presets and metadata | Supported (backward compat) |
| v4 | Multi-file: core + profiles directory | **Current** (default for new installs) |

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | AI-operable setup guide: install, sync, status, identity, SDDs, invoke |
| [Architecture](docs/architecture.md) | How gsr works, module structure, invocation flow, design decisions |
| [Presets Guide](docs/presets-guide.md) | Built-in presets, creating custom presets, sharing |
| [Import/Export Guide](docs/import-export.md) | Export presets, compact sharing strings, import flows |
| [Migration Guide](docs/migration-guide.md) | Upgrading schema versions safely |
| [Release Checklist](docs/release-checklist.md) | npm publish readiness and launch checklist |
| [Host Adoption (EN)](docs/host-adoption.en.md) | Host-local install/uninstall for OpenCode and other TUIs |
| [Host Adoption (ES)](docs/host-adoption.es.md) | Adopcion host-local para OpenCode y otros TUIs |

---

## Standalone Mode

`gsr` works with or without [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) installed:

| Mode | Controller | Execution owners |
|------|-----------|-----------------|
| **With gentle-ai** | `Alan/gentle-ai` | `gentle-ai`, `agent-teams-lite` |
| **Without gentle-ai** | `host` | `host` |

---

## Migrations

```bash
gsr setup update                 # preview pending migrations (dry-run)
gsr setup update --apply         # apply with automatic backup
```

---

## Boundary Notes

- external router boundary, non-executing.
- `router/router.yaml` is the source of truth.
- does not execute models, providers, or agent orchestration.
- exposes `/gsr` session-sync metadata for the active host TUI, but slash-command registration stays host-owned and non-executing.
- browse/compare visibility flags are explicit for availability, pricing, labels, and guidance; hidden metadata stays redacted
- render opencode also surfaces a multimodel orchestration manager plan that only labels split/dispatch/merge/judge/radar steps
- compatibility is explicit: schema v1, v3, and v4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format
- Host sync: /gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing.
- Multimodel browse/compare expose shareable schema v3 metadata only.
- Compatibility: router.yaml versions 1, 3, and 4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format.
- Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing.
- Select the active profile in router/router.yaml without changing who is in control.
- Show current router status. Use --verbose or --debug for full details.
- Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.
- Compare two shareable multimodel projections without recommending or executing anything.
- Inspect or apply a YAML-first install intent to router/router.yaml.
- Show or apply a step-by-step bootstrap path for adoption.
- Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.
- Invocation records (`.gsr/invocations/`) are pure data — non-executing, report-only

### Minimal v1 setup

Save this as `router/router.yaml`:

```yaml
version: 1
active_profile: default
profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
      explore:
        - openai/gpt-4o-mini
```

- `gsr render opencode`

---

## Contributing

This project follows [Spec-Driven Development](https://github.com/Gentleman-Programming/gentle-ai) (SDD). Changes go through: explore → propose → spec → design → tasks → apply → verify → (debug if needed) → archive.

---

<div align="center">

<p>Part of the <a href="https://github.com/Gentleman-Programming">Gentleman Programming</a> ecosystem</p>

<img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg" alt="License: UNLICENSED">

</div>
