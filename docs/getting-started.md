# Getting Started

> **This documentation is designed for both humans and AI agents.**
> An AI agent can install, configure, and operate GSR by following these instructions step by step.
> Each step includes expected output so you can verify correct execution.

---

## AI Agent Operational Guide

If you are an AI agent setting up GSR for a project, follow this sequence exactly:

### Step 1 — Install globally

```bash
npm install -g gentle-sdd-router
```

**Expected output**: npm progress + success message. No error.

Verify installation:

```bash
gsr version
```

**Expected output**:
```
gsr v<X.Y.Z>
Tip: check for updates with npm update -g gentle-sdd-router
```

### Step 2 — Initialize the project

Run this from inside the project directory:

```bash
gsr setup install
```

**Expected output**:
```
Command: install opencode
Status: ready
...
```

This creates the `router/` directory with `router.yaml` and default profiles. If config already exists, skip this step.

### Step 3 — Run a full sync

```bash
gsr sync
```

**Expected output**:
```
Synced <N> role contracts + <N> phase compositions (<total> total).
Manifest: router/contracts/.sync-manifest.json
<N> agent(s) synced to opencode.json.
Commands: <N> written, <N> already up to date.
Synchronized.
```

`gsr sync` is idempotent — running it again produces "Already up to date."

### Step 4 — Check status

```bash
gsr status
```

**Expected output** (simplified):
```
✅ Ready — Synchronized

Preset      multivendor (8 phases)
Catalog     default (SDD-Orchestrator)
Identity    AGENTS.md inherited
Debug       sdd-debug-mono → on_issues
Catalogs    2 enabled: default, sdd-debug
Connections SDD-Orchestrator/verify → sdd-debug-mono (on_issues)

  gsr status --verbose   full routes, pricing & SDD graph
  gsr route use <name>   switch preset
  gsr sync               re-sync everything
```

For full details including routes, pricing, all presets, and the SDD connections graph:

```bash
gsr status --verbose
```

**Expected output** includes: configuration (schema, controller, manifest), active preset with identity and debug wiring, resolved routes per phase with pricing and context window, all catalogs and presets, and an ASCII **SDD CONNECTIONS** graph showing how SDDs invoke each other (e.g., verify → sdd-debug).

### Step 5 — Create a catalog (optional)

```bash
gsr catalog create my-catalog
```

**Expected output**:
```
Created catalog 'my-catalog' at router/profiles/my-catalog/
...
Synchronized.
```

`catalog create` auto-enables and auto-syncs. New agents appear in the TUI host after reopening.

### Step 6 — Create a preset (optional)

```bash
# Create empty preset
gsr profile create my-preset

# Or clone an existing preset as a starting point
gsr profile copy multivendor my-preset
```

**Expected output**:
```
Created profile 'my-preset' → router/profiles/my-preset.router.yaml
...
Synchronized.
```

Profile creation auto-triggers sync. Edit the YAML file to configure model targets.

### Step 7 — Verify identity resolution (optional)

```bash
gsr identity show
```

**Expected output** (per enabled preset):
```
=== multivendor ===
Sources: global-agents-md, preset-agents-md
Prompt:
<resolved identity context>
```

Identity is layered: global `AGENTS.md` → project `AGENTS.md` → preset-level overrides.

### Step 8 — Create custom SDDs (optional)

```bash
gsr sdd create game-design --description "Game design workflow"
```

**Expected output**:
```
Created SDD 'game-design' at router/catalogs/game-design/
```

List custom SDDs:

```bash
gsr sdd list
```

Add role contracts and phase contracts to the SDD:

```bash
gsr role create director --sdd game-design
gsr phase create concept --sdd game-design
```

### Step 9 — Connect SDDs with invoke declarations (optional)

You can wire two SDDs together so one invokes the other after a phase completes.

```bash
# Add an invoke declaration to an existing phase in a custom SDD
gsr phase invoke level-design \
  --sdd game-design \
  --target art-production/asset-pipeline \
  --trigger on_issues \
  --input-from phase_output \
  --required-fields "issues,affected_files"
```

**Expected output**:
```
Invoke added to phase 'level-design' in SDD 'game-design'.
  catalog: art-production
  trigger: on_issues
```

This writes the invoke declaration to `router/catalogs/game-design/sdd.yaml`. `gsr` stores it as plain data — never executes it.

To manually trigger an invocation record (as an orchestrator sub-agent would do after phase completion):

```bash
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Level 3 assets needed"
```

**Expected output**:
```
Invocation created: inv-550e8400-e29b-41d4-a716-446655440000
```

When the callee finishes:

```bash
gsr sdd invoke-complete inv-550e8400-e29b-41d4-a716-446655440000 \
  --result "All assets delivered"
```

---

## Prerequisites

- **Node.js 20+** — required for running gsr
- **A project directory** — gsr creates config inside your project

## Installation

### From npm (recommended)

```bash
npm install -g gentle-sdd-router
```

### From source

```bash
git clone https://github.com/osmelpv/gentle-sdd-router.git
cd gentle-sdd-router
npm install
npm link
```

This makes `gsr` available globally in your terminal.

### With gentle-ai (recommended)

If you use the [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) ecosystem, gsr integrates automatically. When gentle-ai is detected, gsr uses it as the routing controller.

### Without gentle-ai (standalone)

gsr works independently. Without gentle-ai, the controller label defaults to `host`, the default persona is `neutral`, and all execution owners fall back to `['host']`. You get the same routing features — just without the Gentleman persona injection and ecosystem integration.

---

## First Setup

### Interactive wizard

Run `gsr` with no arguments in your project directory:

```bash
cd your-project
gsr
```

The wizard detects your project state and offers options:
- **No router config found** → Install gsr
- **Outdated config** → Update to latest version
- **Current config** → Switch presets, view status, manage profiles

### Direct install

```bash
cd your-project
gsr setup install
```

> **Note**: The old `gsr install` command still works as a backward-compat alias.

This creates the v4 multi-file layout:

```
your-project/
  router/
    router.yaml                    # core config
    profiles/
      multivendor.router.yaml      # default preset
```

---

## Basic Usage

```bash
# Check current state
gsr status

# Full details (routes, pricing, activation)
gsr status --verbose

# List available presets
gsr profile list

# Switch to a different preset
gsr route use claude

# View resolved routes
gsr route show

# Sync contracts + overlay
gsr sync

# Import or export presets
gsr profile export multivendor --compact
gsr profile import ./shared.router.yaml
```

> **Backward-compat aliases**: The old commands `gsr list`, `gsr use claude`, `gsr reload`, and `gsr install` still work. The new tree (`gsr profile list`, `gsr route use`, etc.) is the recommended form going forward.

---

## Available Presets

| Preset | Description | Best for |
|--------|-------------|----------|
| **multivendor** | Best model per phase across all providers | Default, balanced performance |
| **claude** | Anthropic models only | Claude-heavy workflows |
| **openai** | OpenAI models only | GPT-focused workflows |
| **multiagent** | 2 lanes per phase (primary + judge/radar) | Cross-provider validation |
| **ollama** | All local models (Qwen, QwQ, Devstral) | Offline, no tokens needed |
| **local-hybrid** | Local models + free cloud fallbacks | Free tier / Ollama first |
| **cheap** | Budget models with solid performance | Cost-sensitive projects |
| **heavyweight** | 5 lanes per phase (3 models + judge + radar) | Maximum depth and quality |
| **safety** | Restricted read-only routing profile | Investigation, debugging, planning |

---

## Identity Configuration

gsr resolves agent identity from layered context:

1. **Global `AGENTS.md`** — system-wide persona (e.g., from `gentle-ai`)
2. **Project `AGENTS.md`** — project-specific overrides
3. **Preset-level overrides** — inline `agentsContext` in the preset YAML

Verify what identity gets resolved for each preset:

```bash
gsr identity show
gsr identity show --preset multivendor
```

---

## Status Checking

```bash
# Simple status (default)
gsr status

# Verbose: full routes, pricing, activation state
gsr status --verbose
```

The simple status shows: status indicator, active preset, activation state, and a hint for `--verbose`.

---

## Command Reference

### Top-level

```
gsr status [--verbose] [--debug]   Current state, routes, pricing
gsr version                         Installed version
gsr help [command]                  Help for any command
gsr sync [--dry-run] [--force]      Full sync: contracts + overlay + commands + validate
```

### Route

```
gsr route use <preset>              Switch active preset
gsr route show                      Show resolved routes
gsr route activate                  gsr takes routing control
gsr route deactivate                Host takes control back
```

### Profile

```
gsr profile list                    List profiles with catalog info
gsr profile show [name]             Show routes for a profile
gsr profile create <name>           Create empty profile (auto-syncs)
gsr profile delete <name>           Delete profile
gsr profile rename <old> <new>      Rename profile
gsr profile copy <src> <dest>       Clone profile
gsr profile export <name>           Export for sharing (--compact for gsr:// string)
gsr profile import <source>         Import from file/URL/gsr://
```

### Catalog

```
gsr catalog list                    List catalogs with status
gsr catalog create <name>           Create catalog (auto-enables + auto-syncs)
gsr catalog delete <name>           Delete empty catalog
gsr catalog enable <name>           Show in TUI host (TAB cycling) + auto-sync
gsr catalog disable <name>          Hide from TUI host + auto-sync
gsr catalog move <profile> <cat>    Move a profile to a different catalog
gsr catalog use <name> [preset]     Set active catalog and preset
```

### Inspect

```
gsr inspect browse [selector]       Multimodel metadata
gsr inspect compare <a> <b>         Compare two presets
gsr inspect render <target>         Host boundary preview
```

### Setup

```
gsr setup install                   Install router config
gsr setup uninstall [--confirm]     Remove gsr overlay and router/ (with backup)
gsr setup bootstrap                 Guided first-time setup
gsr setup update [--apply]          Config migrations
gsr setup apply <target> [--apply]  Generate TUI overlay (writes to ./opencode.json)
```

### Identity

```
gsr identity show [--preset <name>] Resolve and display agent identity
```

### SDD (Custom Workflows)

```
gsr sdd create <name> [--description <desc>]  Create custom SDD
gsr sdd list                                   List custom SDDs
gsr sdd show <name>                            Show SDD phases and triggers
gsr sdd delete <name> [--yes]                  Delete custom SDD
```

### Role & Phase (within a custom SDD)

```
gsr role create <name> --sdd <sdd>   Create role contract
gsr phase create <name> --sdd <sdd>  Create phase contract
gsr phase invoke <name> --sdd <sdd> --target <catalog>/<sdd> --trigger <trigger>
                                     Add/update invoke declaration on a phase
```

### Phase Invoke (adding cross-SDD wiring to existing phases)

```
gsr phase invoke <phase-name> --sdd <sdd-name> --target <catalog>/<sdd> --trigger <trigger>
  [--input-from <field>] [--required-fields <comma-separated>]
```

Adds or updates the invoke declaration on a specific phase in a custom SDD. Trigger options: `on_issues | always | never | manual`.

### Cross-Catalog Invocations

Cross-catalog invocations let one SDD declare its intent to launch another. `gsr` writes a record — the host executes.

> **Built-in example: sdd-debug** — GSR ships with a working cross-catalog invocation. When the default SDD-Orchestrator's verify phase finds issues, it automatically invokes the `sdd-debug` catalog (7 phases: explore-issues → triage → diagnose → propose-fix → apply-fix → validate-fix → archive-debug). Every built-in preset has a `debug_invoke` block pre-configured — no manual wiring needed. You can do the same for your own SDDs using `gsr phase invoke` or by editing `sdd.yaml` directly. See the README for the full sdd-debug architecture.

#### 1. Declare invoke in sdd.yaml

```yaml
phases:
  level-design:
    intent: "Design levels and encounters"
    invoke:
      catalog: art-production
      sdd: asset-pipeline     # optional — defaults to catalog name
      payload_from: output    # output | input | custom
      await: true
```

#### 2. Create the invocation record

```bash
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Level 3 assets needed"
# Output: Invocation created: inv-550e8400-e29b-41d4-a716-446655440000
```

#### 3. Complete the invocation when the callee finishes

```bash
gsr sdd invoke-complete inv-550e8400-e29b-41d4-a716-446655440000 \
  --result "All assets delivered"
```

#### 4. Check status

```bash
gsr sdd invoke-status inv-550e8400-e29b-41d4-a716-446655440000
gsr sdd invocations                        # list all
gsr sdd invocations --status pending       # filter by status
```

**Important**: `gsr` writes the invocation record to `.gsr/invocations/inv-{id}.json`. It never executes the callee. Your orchestrator reads the record and launches the target SDD.

### Flags

```
--dry-run     Preview changes without writing files (sync, setup)
--force       Overwrite existing files (import, sync)
--verbose     Show full internal details (status)
--debug       Alias for --verbose (status)
--confirm     Required for destructive operations (uninstall)
--compact     Use compact gsr:// encoding (export, import)
```

---

## Connecting SDDs

Cross-SDD wiring lets one workflow invoke another as a work-order. This is how department-style collaboration works.

### Step-by-step: Create two SDDs and connect them

```bash
# 1. Create source SDD (game design)
gsr sdd create game-design --description "Game design workflow"

# 2. Create target SDD (art production)
gsr sdd create art-production --description "Art production workflow"

# 3. Add an invoke declaration to a phase in game-design
gsr phase invoke level-design \
  --sdd game-design \
  --target art-production/asset-pipeline \
  --trigger on_issues \
  --input-from phase_output \
  --required-fields "issues,affected_files"

# Expected:
# Invoke added to phase 'level-design' in SDD 'game-design'.
#   catalog: art-production
#   trigger: on_issues

# 4. Show the updated SDD to verify
gsr sdd show game-design
```

### Testing the flow

```bash
# When level-design phase completes and issues are found:
gsr sdd invoke art-production/asset-pipeline \
  --from game-design/game-design \
  --phase level-design \
  --payload "Issues found in level 3 assets"
# → Invocation created: inv-<uuid>

# When art-production finishes its work:
gsr sdd invoke-complete inv-<uuid> \
  --result "Assets corrected and delivered"

# Verify the record:
gsr sdd invoke-status inv-<uuid>
```

### AI Agent Operational Guide — Setting Up Inter-SDD Connections

As an AI agent, follow this sequence to set up cross-SDD connections:

1. **Identify the caller phase**: which SDD/phase needs to invoke another
2. **Identify the callee**: which catalog/sdd should be invoked
3. **Choose the trigger**: `on_issues` (most common), `always`, `never`, or `manual`
4. **Declare the invoke**:
   ```bash
   gsr phase invoke <phase> --sdd <caller-sdd> --target <callee-catalog>/<callee-sdd> --trigger <trigger>
   ```
5. **During execution**, when the phase completes and trigger condition is met:
   ```bash
   gsr sdd invoke <callee-catalog>/<callee-sdd> --from <caller-catalog>/<caller-sdd> --phase <phase> --payload "<context>"
   ```
6. **Mark complete** when the callee finishes:
   ```bash
   gsr sdd invoke-complete <inv-id> --result "<result>"
   ```
7. **If re-verification is needed** (e.g., trigger was `on_issues`), run the verify phase again after completion.

### What GSR does vs. what the orchestrator does

| Responsibility | Owner |
|---------------|-------|
| Store invoke declaration in sdd.yaml | GSR (`gsr phase invoke`) |
| Write invocation record to `.gsr/invocations/` | GSR (`gsr sdd invoke`) |
| Read the record and launch the callee | **Your orchestrator** |
| Mark the invocation complete | GSR (`gsr sdd invoke-complete`) |
| Re-run verification after completion | **Your orchestrator** |

GSR is always report-only. Execution belongs to the host.

---

## Next Steps

- [Presets Guide](presets-guide.md) — understand and customize presets
- [Import/Export Guide](import-export.md) — share, package, and import presets
- [Migration Guide](migration-guide.md) — upgrading from older schema versions
- [Architecture](architecture.md) — how gsr works under the hood, including invocation flow
- [Host Adoption (EN)](host-adoption.en.md) — integrating gsr with OpenCode
