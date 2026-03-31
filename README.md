<div align="center">

<a href="assets/img/gsr-logo.png">
<img src="assets/img/gsr-logo.png" alt="GSR — Gentle SDD Router" width="200">
</a>

<h1>Gentle SDD Router</h1>

<p><strong>Multi-model routing by phase. Judge, compare, refine. Your models, your rules.</strong></p>

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

Gentle SDD Router (gsr) is a declarative, non-executing router that assigns AI models to development phases. It tells your agent ecosystem which model to use when — with fallbacks, multi-agent judging, and cross-provider diversity. gsr reads YAML, resolves routes, reports metadata. It never calls models or runs providers.

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

## What It Does

`gsr` is a **declarative, non-executing router** that assigns AI models to development phases. It doesn't run models -- it tells your agent ecosystem *which* model to use *when*, with what role, what contract, and what execution mode.

### The Octopus Pattern: Multi-Agent by Phase

The octopus has many tentacles that work in parallel, and ONE brain that synthesizes. That's exactly how `gsr` routes multi-agent development:

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

### The Judge: Debate Director, Not Reviewer

The Judge is NOT a simple reviewer that says "looks good." It is a **debate director** powered by a high-reasoning model (o3, GPT-5 Pro, Claude Opus):

1. **Anonymous responses**: The judge receives agent outputs labeled Agent-1, Agent-2, Agent-3 -- never the provider name. It evaluates content quality, not brand.

2. **Brainstorming**: When agents diverge, the judge opens a brainstorming session. It asks each agent targeted questions without revealing what the others said: *"How would you approach this angle?"* not *"Agent-2 suggested X, what do you think?"*

3. **Indirect confrontation**: To validate claims, the judge asks agents indirectly. This prevents the elogio problem -- models tend to praise each other's ideas instead of thinking critically. The judge forces genuine independent thought.

4. **Synthesis**: The judge fuses the best elements from every response, incorporates radar findings (blind spots, risks, edge cases), and produces ONE refined output with a confidence level and a dissent log of what was deliberately excluded.

### The Radar: Independent Blind-Spot Scanner

The Radar works the same prompt as the agents but with a fundamentally different objective. It is NOT trying to complete the task. It is trying to find what the task-focused agents will MISS:

- Missing dependencies and cross-module impact
- Edge cases nobody considered
- Implicit assumptions that might be wrong
- Pattern violations in the existing codebase
- Security vulnerabilities

Radar findings feed directly to the judge, giving it ammunition for better brainstorming questions and more informed synthesis.

### 10 SDD Phases

`gsr` routes models across 10 development phases. Each phase has an optimal composition:

| Phase | Job | Composition | Execution |
|-------|-----|-------------|-----------|
| **orchestrator** | Coordinate the pipeline, delegate | 1 agent + optional judge | Sequential |
| **explore** | Investigate codebase, map affected areas | 2+ agents + judge + radar | **Parallel** |
| **propose** | Structure a formal proposal from exploration | 1 agent + optional judge | Sequential |
| **spec** | Write requirements and behavioral scenarios | 2+ agents + judge + investigator | **Parallel** |
| **design** | Produce architecture and key decisions | 2+ agents + judge + radar | **Parallel** |
| **tasks** | Break design into task checklist + TDD tests | 1 agent (tasks first, TDD second) | Sequential |
| **apply** | Implement: write code. **Always ONE agent.** | 1 agent only | Sequential |
| **verify** | Validate implementation against spec | 2+ sabuesos + judge + radar | **Parallel** |
| **debug** | Diagnose bugs found by verify | Full mini-SDD cycle | **Conditional** |
| **archive** | Sync specs, archive change. **Always ONE agent.** | 1 agent only | Sequential |

**Key insight**: `apply` and `archive` are ALWAYS mono. One agent writes the code so everything stays contextually consistent from start to finish. The army's job is to prepare such thorough context that the coder can't fail.

### Specialized Agent Roles

Beyond the core agents, judge, and radar, `gsr` defines specialized roles:

| Role | Job | Used in |
|------|-----|---------|
| **Investigator** | Researches external prior art, API docs, industry patterns | spec |
| **Risk Detector** | Scans for incompatibilities, orphaned code, regressions | explore, verify |
| **Security Auditor** | Finds injection, auth bypass, data exposure, CVEs | explore, verify |
| **Tester** | Writes TDD tests that FAIL (defines "done") | tasks |

Each role has a contract (skill) that defines its input, output, and behavioral rules. Contracts are shipped with gsr and synced to Engram for persistent access across sessions.

### Catalogs: Switch Your Entire Setup Instantly

Each catalog groups a complete routing configuration. In OpenCode, catalogs map to TAB-switchable modes:

- **`multivendor`** -- Best model per phase across all providers
- **`ollama`** -- 100% local models, zero cloud costs, works offline
- **`safety`** -- Read-only analysis mode, no write permissions
- **`claude`** / **`openai`** -- Single-provider setups

One keystroke to go from cloud to local. One keystroke to enter analysis-only mode. No reconfiguration needed.

### Key Features

| Feature | Description |
|---------|-------------|
| **Multi-agent by phase** | Army of agents from different providers + judge that synthesizes via debate |
| **10 SDD phases** | orchestrator, explore, propose, spec, design, tasks, apply, verify, debug, archive |
| **Judge debate protocol** | Anonymous responses, brainstorming, indirect confrontation, confidence levels |
| **Specialized roles** | Investigator, risk detector, security auditor, tester -- each with defined contracts |
| **Parallel + sequential** | Phases declare execution mode. Agents explore in parallel, judge synthesizes sequentially |
| **Conditional phases** | Debug triggers only when verify fails. No wasted computation on clean runs |
| **Dynamic model picker** | Fetches models from OpenRouter + Ollama in real time. Always fresh pricing and capabilities |
| **Catalog switching** | Switch entire routing configurations instantly (cloud, local, hybrid, analysis-only) |
| **8 built-in presets** | multivendor, claude, openai, multiagent, ollama, cheap, heavyweight, safety |
| **Agent contracts** | 9 role contracts + 10 phase compositions shipped as skills. `gsr sync` pushes to Engram |
| **Interactive TUI** | Split-panel wizard for profile creation, editing, and comparison |
| **Non-executing boundary** | Declares routing only -- never calls models or runs providers |

---

## Commands

```
gsr status                          Current state, routes, pricing
gsr version                         Installed version
gsr help [command]                  Help for any command

gsr route use <preset>              Switch active preset
gsr route show                      Show resolved routes
gsr route activate                  gsr takes routing control
gsr route deactivate                Host takes control back

gsr profile list                    List profiles with catalog info
gsr profile create <name>           Create empty profile
gsr profile delete <name>           Delete profile
gsr profile rename <old> <new>      Rename profile
gsr profile copy <src> <dest>       Clone profile
gsr profile export <name>           Export for sharing (--compact)
gsr profile import <source>         Import from file/URL/gsr://

gsr catalog list                    List catalogs with status
gsr catalog create <name>           Create catalog (disabled by default)
gsr catalog delete <name>           Delete empty catalog
gsr catalog enable <name>           Show in TUI host (TAB cycling)
gsr catalog disable <name>          Hide from TUI host

gsr inspect browse [selector]       Multimodel metadata
gsr inspect compare <a> <b>         Compare two presets
gsr inspect render <target>         Host boundary preview

gsr setup install                   Install router config
gsr setup uninstall                 Remove gsr overlay
gsr setup bootstrap                 Guided first-time setup
gsr setup update [--apply]          Config migrations
gsr setup apply <target> [--apply]  Generate TUI overlay

gsr sync                            Push global contracts to Engram
gsr catalog use <name> [preset]     Set active catalog and preset
```

Each category supports `help`: `gsr route help`, `gsr catalog help`, etc.

Old flat commands (`gsr use`, `gsr list`, `gsr install`, `gsr reload`, `gsr activate`, `gsr deactivate`, `gsr browse`, `gsr compare`, `gsr render`, `gsr apply`, `gsr bootstrap`, `gsr update`, `gsr export`, `gsr import`) still work as backward-compat aliases.

---

## Catalog Visibility

Catalogs control which presets appear in TUI host TAB cycling (e.g., OpenCode).

- The **SDD-Orchestrator** (default) catalog is enabled by default
- New catalogs start **disabled** — enable them when ready
- Only **enabled** catalogs generate agents in the TUI overlay

### router.yaml catalog metadata

```yaml
catalogs:
  default:
    displayName: SDD-Orchestrator
    enabled: true
  experimental:
    enabled: false
```

### Managing visibility

```bash
gsr catalog enable experimental    # show in OpenCode TAB
gsr catalog disable experimental   # hide from OpenCode TAB
```

---

## Token Budget Hints

Lanes can declare `contextWindow`, `inputPerMillion`, and `outputPerMillion` metadata. These are declarative hints — gsr never makes API calls, it only reports them.

`gsr status` displays the context window alongside pricing for each phase:

```
- orchestrator: anthropic / claude-opus ($15/$75) [200K ctx]
- explore:      google / gemini-pro    ($1.25/$5) [2M ctx]
```

TUI hosts can use the `tokenBudgetHint` field in the session sync contract to render context window bars and session cost estimators. See [Host Adoption (EN)](docs/host-adoption.en.md) for the full contract shape.

---

## Presets

`gsr` ships with 8 ready-to-use presets, each optimized for a different use case:

| Preset | Description | Best for |
|--------|-------------|----------|
| **multivendor** | Best model per phase across all providers | Default, balanced performance |
| **claude** | Anthropic models only | Claude-heavy workflows |
| **openai** | OpenAI models only | GPT-focused workflows |
| **multiagent** | 2 lanes per phase (primary + judge/radar) | Cross-provider validation |
| **ollama** | All local models (Qwen, QwQ, Devstral) | Offline, no tokens needed |
| **cheap** | Budget models with solid performance | Cost-sensitive projects |
| **heavyweight** | 5 lanes per phase (3 models + judge + radar) | Maximum depth and quality |
| **safety** | Restricted read-only routing profile for analysis and planning | Investigation, debugging, planning |

### Switching presets

```bash
gsr route use multivendor            # production: best of each provider
gsr route use ollama                 # ran out of tokens? go local
gsr route use heavyweight            # critical decisions: full multi-agent

# backward-compat aliases still work:
gsr use multivendor
gsr use ollama
```

---

## Profile Structure

### Multi-file v4 layout

Each preset is a self-contained YAML file in `router/profiles/`:

```
router/
  router.yaml                    # core config
  profiles/
    multivendor.router.yaml      # one preset per file
    claude.router.yaml
    openai.router.yaml
    multiagent.router.yaml
    ollama.router.yaml
    cheap.router.yaml
    heavyweight.router.yaml
    safety.router.yaml
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

### Profile file example (`router/profiles/multivendor.router.yaml`)

```yaml
name: multivendor
availability: stable
aliases: latest
complexity: high
phases:
  orchestrator:
    - target: anthropic/claude-opus
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: openai/gpt-5
  explore:
    - target: google/gemini-pro
      kind: lane
      phase: explore
      role: primary
      fallbacks: anthropic/claude-sonnet
  apply:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: apply
      role: primary
      fallbacks: openai/gpt-5
  verify:
    - target: openai/gpt-5
      kind: lane
      phase: verify
      role: judge
      fallbacks: anthropic/claude-opus
```

### Creating your own preset

Use the CLI or copy directly:

```bash
# CLI approach (recommended)
gsr profile create my-custom
gsr profile copy multivendor my-custom

# Or copy manually and edit
cp router/profiles/multivendor.router.yaml router/profiles/custom.router.yaml
gsr route use custom
```

### Sharing presets

```bash
gsr profile export multivendor                      # print preset YAML to stdout
gsr profile export multivendor --compact            # compact gsr:// string for chat/issues

gsr profile import ./some-preset.router.yaml        # import from local file
gsr profile import https://example.com/preset.yaml  # import from HTTPS URL
gsr profile import --compact 'gsr://...'            # import compact shared string

# backward-compat aliases still work:
gsr export multivendor
gsr import ./some-preset.router.yaml
```

---

## Agent Contracts

`gsr` ships with 19 contracts that define how each role behaves in each phase:

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

### Syncing contracts to Engram

Contracts are pushed to Engram for persistent access across sessions:

```bash
gsr sync                          # push all 19 contracts to Engram (idempotent)
```

This runs automatically on `npm install -g` via postinstall. Use `gsr sync` manually during development (npm link) or as a repair command if Engram data is lost.

### Global vs Project data

| Data | Scope | Created by | Cleaned by |
|------|-------|-----------|------------|
| Role contracts, phase compositions | **Global** | `npm install -g` / `gsr sync` | `npm uninstall -g` |
| Custom profiles, project agents | **Project** | `gsr install` / TUI wizard | `gsr setup uninstall` |

`gsr setup uninstall` NEVER touches global contracts. It only cleans project-specific data.

---

## Standalone Mode

`gsr` works with or without [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) installed:

| Mode | Controller | Execution owners |
|------|-----------|-----------------|
| **With gentle-ai** | `Alan/gentle-ai` | `gentle-ai`, `agent-teams-lite` |
| **Without gentle-ai** | `host` | `host` |

Override the controller label and persona in `router/router.yaml`:

```yaml
controller: my-custom-agent
persona: neutral
```

Supported personas:
- `gentleman` — use the Gentleman-style persona when integrated with gentle-ai
- `neutral` — neutral architect tone for standalone or calmer host setups
- `custom` — reserved for future custom persona wiring

---

## Migrations

When the router schema evolves, `gsr` migrates your config safely:

```bash
gsr setup update                 # preview pending migrations (dry-run)
gsr setup update --apply         # apply with automatic backup

# backward-compat alias still works:
gsr update --apply
```

The migration system:
- Creates a full backup before each migration (`router/backups/`)
- Rolls back automatically on failure
- Tracks applied migrations in `router/.migrations.yaml`
- Preserves user data and unknown YAML keys

---

## Architecture

### Non-executing boundary

`gsr` is a **report-only** tool. It:

- Reads and writes YAML configuration
- Resolves phase routes and fallback chains
- Reports compatibility and boundary metadata
- **Never** calls models, providers, or agents
- **Never** owns runtime behavior

Execution belongs to the host (gentle-ai, agent-teams-lite, or your own orchestrator).

### Schema versions

| Version | Structure | Status |
|---------|-----------|--------|
| v1 | Single file, profiles with phases | Supported (backward compat) |
| v3 | Single file, catalogs with presets and metadata | Supported (backward compat) |
| v4 | Multi-file: core + profiles directory | **Current** (default for new installs) |

### Configuration limits

The bundled YAML parser is intentionally minimal. It supports the subset used by `router/router.yaml`: mappings, sequences, nested objects, strings, numbers, booleans, and null-like values. Advanced YAML features (anchors, tags, multiline scalars) are out of scope.

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first setup, basic usage |
| [Presets Guide](docs/presets-guide.md) | Built-in presets, creating custom presets, sharing |
| [Import/Export Guide](docs/import-export.md) | Export presets, compact sharing strings, import flows |
| [Migration Guide](docs/migration-guide.md) | Upgrading schema versions safely |
| [Architecture](docs/architecture.md) | How gsr works, module structure, design decisions |
| [Release Checklist](docs/release-checklist.md) | npm publish readiness and launch checklist |
| [Host Adoption (EN)](docs/host-adoption.en.md) | Host-local install/uninstall for OpenCode and other TUIs |
| [Host Adoption (ES)](docs/host-adoption.es.md) | Adopcion host-local para OpenCode y otros TUIs |

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
- Show who is in control, how to toggle it, the active profile, and resolved routes.
- Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.
- Compare two shareable multimodel projections without recommending or executing anything.
- Inspect or apply a YAML-first install intent to router/router.yaml.
- Show or apply a step-by-step bootstrap path for adoption.
- Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.

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

## Host Adoption

- host-local adoption lives outside the router CLI; it installs the router skill into `.gsr/skills/router-skill/` and manages one guarded block in `.gsr/policy/rules.md`
- install/uninstall use a manifest plus `<!-- gsr:managed:start -->` / `<!-- gsr:managed:end -->` markers so user edits outside the block stay untouched
- safe uninstall fails closed on missing or duplicate markers, hash mismatches, or ambiguous ownership
- bilingual guides live in `docs/host-adoption.en.md` and `docs/host-adoption.es.md`
- `/gsr` TUI/slash-command integration is host-owned and live-synced separately from host adoption; the router only publishes the declarative contract

## Contributing

This project follows [Spec-Driven Development](https://github.com/Gentleman-Programming/gentle-ai) (SDD). Changes go through: explore → propose → spec → design → tasks → apply → verify → (debug if needed) → archive.

---

<div align="center">

<p>Part of the <a href="https://github.com/Gentleman-Programming">Gentleman Programming</a> ecosystem</p>

<img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg" alt="License: UNLICENSED">

</div>
