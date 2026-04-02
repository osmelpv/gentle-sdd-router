<div align="center">

<a href="assets/img/gsr-logo.png">
<img src="assets/img/gsr-logo.png" alt="GSR — Gentle SDD Router" width="360">
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

## Why Are You Here?

**"I want multi-model routing with fallbacks"** → Jump to [Router — Model Routing](#-router--model-routing)

**"I want custom AI workflows with cross-team collaboration"** → Jump to [SDD — Dynamic Workflow Factory](#-sdd--dynamic-workflow-factory)

**"I want consistent AI personas across all my agents"** → Jump to [Gentle — AI Context System](#-gentle--ai-context-system)

**"I want all three"** → Read on. The name IS the architecture, and they compose naturally.

---

## The Name IS the Architecture

Here's the thing — most tools name themselves after a feature. `gsr` names itself after its *entire model of the world*:

| Pillar | WHO / WHAT / WITH WHAT | What it does |
|--------|------------------------|--------------|
| **gentle** | **WHO** your agents are | Identity, AGENTS.md inheritance, persona contracts |
| **sdd** | **WHAT** they do | Custom phases, cross-catalog invocation, department workflows |
| **router** | **WITH WHAT** they work | Phase-based model assignment, fallbacks, judge/radar patterns |

Think of it this way: **Gentle** gives your agents personality. **SDD** gives them purpose. **Router** gives them the right tools for each job. All three compose into one coherent AI operations layer — declarative, non-executing, report-only.

`gsr` reads YAML, resolves routes, and writes records. **It never calls models, runs providers, or executes orchestration.** Execution belongs to the host.

---

## For AI Agents — Operational Context

> **This README is your operational manual.** An AI agent can install, configure, and manage GSR for any project by following these instructions. No human intervention needed.

### Install & Initialize

```bash
npm install -g gentle-sdd-router
cd <project>
gsr setup install
gsr sync
gsr status
```

### Common Operations

```bash
gsr route use <preset>                     # Switch routing preset
gsr catalog create <name>                  # Create catalog (auto-syncs)
gsr sdd create <name>                      # Create custom SDD workflow
gsr identity show                          # Check resolved agent identity
gsr sdd invoke <catalog>/<sdd> \
  --from <caller-catalog>/<caller-sdd> \
  --phase <phase>                          # Cross-catalog invocation record
gsr sync                                   # Full sync (idempotent, always safe)
```

### What You Need to Know

- `gsr sync` does EVERYTHING — contracts, overlay, commands, validation. Run it freely.
- Creating catalogs and profiles auto-triggers sync. You don't need to call it manually after those.
- `gsr status` tells you if everything is OK. `gsr status --verbose` gives full route details for debugging.
- Identity inherits from `AGENTS.md` automatically — no manual configuration needed.
- **GSR NEVER executes** — it writes config and records that the host reads and acts on.
- Invocation IDs use the `inv-` prefix: `inv-{uuid}` (e.g., `inv-550e8400-e29b-41d4-a716-446655440000`).

### Decision Tree for AI

| Situation | Action |
|-----------|--------|
| User asks to set up GSR | `gsr setup install && gsr sync` |
| User wants a different model | `gsr route use <preset>` |
| User needs a custom workflow | `gsr sdd create <name>` |
| User needs department collaboration | Set up `invoke` in `sdd.yaml`, then `gsr sdd invoke` |
| Something seems wrong | `gsr status --verbose` |
| User modified agents manually | `gsr sync` (or `gsr sync --force` to overwrite) |
| No router config found | `gsr setup install` |

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

---

## Quick Start

```bash
# 1. Install globally
npm install -g gentle-sdd-router

# 2. Initialize in your project
cd your-project
gsr setup install

# 3. Sync everything (contracts + overlay + commands + validation)
gsr sync

# 4. Check status
gsr status
```

> **Example**: After `gsr sync` you'll see:
> ```
> Synced 9 role contracts + 10 phase compositions (19 total).
> Manifest: router/contracts/.sync-manifest.json
> 3 agent(s) synced to opencode.json.
> Commands: 5 written, 0 already up to date.
> Synchronized.
> ```

> **Example**: `gsr status` shows:
> ```
> ✅ Ready — Synchronized
>
> Preset      multivendor (8 phases)
> Catalog     default (SDD-Orchestrator)
> Identity    AGENTS.md inherited
> Debug       sdd-debug-mono → on_issues
> Catalogs    2 enabled: default, sdd-debug
> Connections SDD-Orchestrator/verify → sdd-debug-mono (on_issues)
> ```

See [Getting Started](docs/getting-started.md) for the full AI-operable setup guide with expected outputs per step.

---

## Three Pillars

### 🟣 Gentle — AI Context System

The **gentle** pillar manages agent identity and context. It:

- Inherits `AGENTS.md` context through directory trees (project → global → user)
- Defines per-preset persona overrides (Gentleman style, neutral, custom)
- Ships 9 role contracts + 10 phase compositions as skills
- Publishes `/gsr` session-sync metadata for the host TUI

```bash
gsr identity show [--preset <name>]   # Resolve layered AGENTS.md context
gsr sync                               # Push contracts to host (idempotent)
```

> **Example**: `gsr identity show` resolves the full context chain:
> ```
> === multivendor ===
> Sources: global-agents-md, project-agents-md
> Prompt:
> # Senior Architect, 15+ years experience...
> (inherited from AGENTS.md — no manual config needed)
> ```

> **Example**: Adding identity to a preset YAML:
> ```yaml
> # router/profiles/my-preset.router.yaml
> name: my-preset
> identity:
>   inherit_agents_md: true    # checked by default in TUI
>   persona: gentleman
>   context: "Extra context for this specific preset"
> phases:
>   orchestrator:
>     - target: anthropic/claude-opus-4-6
> ```

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
    invoke:
      catalog: art-production
      sdd: asset-pipeline
      payload_from: output
      await: true
```

#### Cross-Catalog Invocation — The Key Differentiator

A phase can declare its intent to **invoke another SDD catalog**. `gsr` writes an invocation record to `.gsr/invocations/` — a pure data operation. **No execution happens here.** The host or orchestrator reads the record and launches the callee.

##### How to connect two SDDs

Here's the full flow for connecting `game-design` → `art-production` with debug-aware invocation:

**Step 1 — Declare the invoke in sdd.yaml**

```yaml
# router/catalogs/game-design/sdd.yaml
name: game-design
version: 1
phases:
  level-design:
    intent: "Design levels and encounters"
    invoke:
      catalog: art-production
      sdd: asset-pipeline      # optional — defaults to catalog name
      payload_from: output     # output | input | custom
      await: true
      trigger: on_issues       # on_issues | always | never | manual
      input_from: phase_output
      required_fields:
        - issues
        - affected_files
```

Or use the CLI to add/update the invoke declaration on an existing phase:

```bash
gsr phase invoke level-design \
  --sdd game-design \
  --target art-production/asset-pipeline \
  --trigger on_issues \
  --input-from phase_output \
  --required-fields "issues,affected_files"
```

**Step 2 — Create the invocation record** (during execution, when the phase completes)

```bash
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Level 3 assets needed"
# Output: Invocation created: inv-550e8400-e29b-41d4-a716-446655440000
```

**Step 3 — invoke-complete** (when the callee finishes all its phases)

```bash
gsr sdd invoke-complete inv-550e8400-e29b-41d4-a716-446655440000 \
  --result "Assets delivered: tree_bioluminescent.fbx"
```

**Step 4 — Re-verify if needed**

If the callee reported issues, the `trigger: on_issues` declaration means the orchestrator should re-verify the caller's phase. GSR writes the record — the orchestrator decides what to do with it.

> **Presets with `debug_invoke` built-in**: The built-in presets (multivendor, claude, openai, etc.) ship with a `debug_invoke` block pre-configured. When a verify phase fails, no manual wiring is needed — the preset already declares when and how to invoke the debug SDD. Custom SDDs need to declare their own invoke blocks using `gsr phase invoke` or by editing `sdd.yaml` directly.

```bash
# Create an invocation record (data-only, non-executing)
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Level 3 assets needed"

# The command prints the invocation id:
# Invocation created: inv-550e8400-e29b-41d4-a716-446655440000

# When the callee completes, mark it:
gsr sdd invoke-complete inv-550e8400-e29b-41d4-a716-446655440000 --result "Assets delivered"

# Check status:
gsr sdd invoke-status inv-550e8400-e29b-41d4-a716-446655440000

# List all invocations (filter by status):
gsr sdd invocations [--status pending|completed|failed]
```

**Non-executing boundary**: `gsr` writes the record. The record declares intent. Execution belongs to the host.

#### Built-in Example: sdd-debug — How GSR Uses Its Own Invocation System

GSR ships with a real cross-catalog invocation out of the box: **sdd-debug**. This is not a toy example — it's how the default SDD-Orchestrator handles bugs found during verify.

**How it works:**

```
SDD-Orchestrator (default)
  └─ verify phase finds issues
       └─ debug_invoke.trigger = on_issues → INVOKES sdd-debug
            └─ sdd-debug runs 7 phases:
                 explore-issues → triage → diagnose → propose-fix
                 → apply-fix → validate-fix → archive-debug
            └─ returns standardized debug_result
       └─ verify re-runs
            └─ PASS → continue to archive ✅
            └─ FAIL → judge evaluates: revert | escalate | retry (max 2 cycles)
```

**The sdd-debug catalog** (`router/catalogs/sdd-debug/`) ships globally with GSR and includes:
- **7 phases** with a strict dependency chain — no shortcuts
- **7 role contracts** (explorer, triager, diagnostician, fix-proposer, fix-implementer, fix-validator, debug-archiver) — each with professional constraints, red lines, and security-first rules
- **7 phase contracts** with input/output specifications and required skills
- **Standardized `debug_result` output** so the caller knows exactly what happened

**Two preset variants** ship with GSR:

| Preset | Agents per phase | Judge | Models |
|--------|-----------------|-------|--------|
| `sdd-debug-mono` | 1 | No | GPT-5.4 across all phases |
| `sdd-debug-multi` | 2 + judge | Yes (mandatory, reasoning model) | GPT-5.4 + Claude + Gemini judge |

> **Key constraint**: `apply-fix` is ALWAYS 1 agent — even in multi mode. No parallel code writing during debug.

Every built-in preset (multivendor, claude, local-hybrid, etc.) comes with a `debug_invoke` block pre-wired:

```yaml
# Inside multivendor.router.yaml
debug_invoke:
  preset: sdd-debug-mono       # which debug variant to use
  trigger: on_issues            # only when verify finds problems
  input_from: verify_output     # payload comes from verify's findings
  required_fields:              # mandatory fields — missing any = no invoke
    - issues
    - affected_files
    - last_change_files
    - test_baseline
```

**You don't configure this.** It works out of the box. Install GSR → verify finds a bug → sdd-debug runs automatically.

#### Do the Same for Your Own SDDs

The sdd-debug pattern is exactly what you'd build for any cross-catalog workflow. You can connect any SDD to any other SDD from any phase:

> **Example**: A game studio with department collaboration:
> ```bash
> # 1. Create department catalogs
> gsr sdd create game-design
> gsr sdd create art-production
> gsr sdd create sound-design
>
> # 2. Connect level-design → art-production
> gsr phase invoke level-design \
>   --sdd game-design \
>   --target art-production/asset-pipeline \
>   --trigger always \
>   --input-from phase_output \
>   --required-fields "level_name,art_style,faction"
>
> # 3. Add rich context to the invocation (in sdd.yaml):
> #    invoke:
> #      catalog: art-production
> #      sdd: asset-pipeline
> #      payload_from: output
> #      await: true
> #      on_failure: escalate
> #      input_context:
> #        - artifact: level-layout
> #          field: zones.north
> #      output_expected:
> #        - artifact: fbx-model
> #          format: "FBX rigged"
>
> # 4. During execution, the sub-agent creates the invocation:
> gsr sdd invoke art-production/asset-pipeline \
>   --from game-design/game-design \
>   --phase level-design \
>   --payload "Forest level — bioluminescent trees, Nature faction style"
> # → Invocation created: inv-a1b2c3d4-...
>
> # 5. When art-production completes:
> gsr sdd invoke-complete inv-a1b2c3d4-... \
>   --result "Assets delivered: tree_bioluminescent.fbx, forest_ground.png"
>
> # 6. See all declared connections for an SDD:
> gsr sdd invocations game-design
>
> # 7. Validate everything is wired correctly:
> gsr sdd validate game-design
> ```

The pattern is always the same: **declare the intent in sdd.yaml → GSR writes the record → the host executes**. Whether it's the built-in sdd-debug or your own department workflows.

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

> **Example**: A preset YAML assigns models per phase with fallbacks:
> ```yaml
> # router/profiles/multivendor.router.yaml
> name: multivendor
> phases:
>   orchestrator:
>     - target: anthropic/claude-opus-4-6
>       kind: lane
>       role: agent
>   explore:
>     - target: openai/gpt-5.4
>       kind: lane
>       role: agent
>       fallbacks:
>         - anthropic/claude-sonnet-4-6
>         - google/gemini-3-pro
>   verify:
>     - target: openai/gpt-5.4
>       kind: lane
>       role: judge
> ```

> **Example**: Switch presets instantly:
> ```bash
> gsr route use ollama        # switch to 100% local models
> gsr route use multivendor   # switch back to multi-provider
> gsr route show              # see what model goes where
> ```

Start here if you want **multi-model routing** with **fallbacks and judge/radar patterns**.

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
gsr phase invoke <name> --sdd <sdd> --target <catalog>/<sdd> --trigger <trigger>
                                    Add/update invoke declaration on a phase
```

Each category supports `help`: `gsr route help`, `gsr catalog help`, `gsr sdd help`, etc.

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
.gsr/invocations/inv-{uuid}.json
```

```json
{
  "id": "inv-550e8400-e29b-41d4-a716-446655440000",
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

## Standalone Mode

**GSR is its own ecosystem. gentle-ai enhances it but is not required.**

`gsr` works with or without [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) installed:

| Mode | Controller | Execution owners | Persona | Persistence |
|------|-----------|-----------------|---------|-------------|
| **With gentle-ai** | `Alan/gentle-ai` | `gentle-ai`, `agent-teams-lite` | Gentleman | Engram memory |
| **Without gentle-ai** | `host` | `host` | Neutral (no accent) | File-based |

### When gentle-ai is NOT installed

- GSR uses a **neutral agent persona** — no Gentleman accent, no ecosystem branding
- All SDD contracts ship **with GSR** (self-contained) — no dependency on gentle-ai files
- **File-based persistence** is used instead of Engram
- **All features work** — routing, custom SDDs, cross-catalog invocations, identity resolution, TUI
- The controller label defaults to `host` and execution owners to `['host']`

### When gentle-ai IS installed

- GSR **auto-detects** gentle-ai and switches to use `AGENTS.md`, Engram, and the Gentleman persona
- No manual configuration needed — detection is automatic
- Identity layering uses global `AGENTS.md` → project `AGENTS.md` → preset overrides

> **Note**: The standalone fallback implementation (file-based Engram substitute, persona switching) is defined by a separate SDD. This section documents the intent and expected user experience.

---

## Migrations

```bash
gsr setup update                 # preview pending migrations (dry-run)
gsr setup update --apply         # apply with automatic backup
```

---

## Boundary Notes

These phrases form the contractual boundary of `gsr` and are referenced by coherence tests. They read as a functional summary of what `gsr` does and does not do.

**Core boundary**: external router boundary, non-executing. `router/router.yaml` is the source of truth. `gsr` does not execute models, providers, or agent orchestration.

**Session sync**: `gsr` exposes `/gsr` session-sync metadata for the active host TUI, but slash-command registration stays host-owned and non-executing. Host sync: /gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing.

**Visibility and metadata**: browse/compare visibility flags are explicit for availability, pricing, labels, and guidance; hidden metadata stays redacted. Multimodel browse/compare expose shareable schema v3 metadata only. Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything. Compare two shareable multimodel projections without recommending or executing anything.

**Render and orchestration**: render opencode also surfaces a multimodel orchestration manager plan that only labels split/dispatch/merge/judge/radar steps. Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.

**Compatibility and routing**: compatibility is explicit: schema v1, v3, and v4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format. Compatibility: router.yaml versions 1, 3, and 4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format. Select the active profile in router/router.yaml without changing who is in control.

**Setup and status**: Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing. Show current router status. Use --verbose or --debug for full details. Inspect or apply a YAML-first install intent to router/router.yaml. Show or apply a step-by-step bootstrap path for adoption.

**Invocation records**: Invocation records (`.gsr/invocations/`) are pure data — non-executing, report-only.

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

## Contributing

This project follows [Spec-Driven Development](https://github.com/Gentleman-Programming/gentle-ai) (SDD). Changes go through: explore → propose → spec → design → tasks → apply → verify → (debug if needed) → archive.

---

<div align="center">

<p>Recommended with <a href="https://github.com/Gentleman-Programming/gentle-ai">gentle-ai</a> for the full experience. Works independently without it.</p>

<img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg" alt="License: UNLICENSED">

</div>
