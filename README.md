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

## What It Does

`gsr` is a **declarative, non-executing router** that assigns AI models to development phases. It doesn't run models -- it tells your agent ecosystem *which* model to use *when*, with fallbacks, multi-agent lanes, and cross-provider diversity built in.

### The Power of the Judge

What makes `gsr` different from anything else out there is **multi-agent judging per phase**. In a multi-agent preset, each development phase runs multiple models simultaneously -- a primary, a secondary, a radar, and a **judge**:

- **Primary + Secondary**: Two or more models work the same phase independently, each bringing a different perspective from a different provider
- **Radar**: An additional model scans for blind spots, risks, and edge cases the others may miss
- **Judge**: A high-reasoning model that collects ALL responses, cross-references them, confronts the different viewpoints, and produces a **refined final answer** -- the best synthesis of every perspective. If the judge has doubts, it can trigger a multi-agent brainstorm before deciding

The judge doesn't just "validate" -- it **decides** which combination of ideas produces the strongest result. It's the difference between one model guessing and multiple models debating.

**Before**: One model does everything. No specialization, no cross-checking, no second opinion.

**After**: Each phase has a team of models. The judge picks the best synthesis. The radar catches what everyone else missed. When tokens run out, switch to local models with a single keystroke.

### Catalogs: Switch Your Entire Setup Instantly

Each catalog groups a complete routing configuration. In OpenCode, catalogs map to TAB-switchable modes:

- **`multivendor`** -- Cloud models from every provider, full write access
- **`ollama`** -- 100% local models, zero cloud costs, works offline
- **`safety`** -- Read-only analysis mode with multi-agent judge, no write permissions
- **`claude`** / **`openai`** -- Single-provider setups

One keystroke to go from cloud to local. One keystroke to enter analysis-only mode. No reconfiguration needed.

### Key Features

| Feature | Description |
|---------|-------------|
| **Multi-agent judging** | Multiple models per phase with a judge that cross-references and refines all responses into the best answer |
| **Phase-based routing** | Assign models to 8 SDD phases (orchestrator, explore, spec, design, tasks, apply, verify, archive) |
| **Catalog switching** | Switch entire routing configurations instantly (cloud, local, hybrid, analysis-only) |
| **8 built-in presets** | multivendor, claude, openai, multiagent, ollama, cheap, heavyweight, safety |
| **Multi-file profiles** | Each preset is a separate YAML file -- easy to share, import, customize |
| **Migration system** | Safe schema upgrades with backup, rollback, and version tracking |
| **Interactive wizard** | Run `gsr` with no args for a guided setup experience |
| **Standalone or integrated** | Works alone or alongside the [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) ecosystem |
| **Non-executing boundary** | Declares routing only -- never calls models or runs providers |

---

## Quick Start

### Install

```bash
# Clone and link globally
git clone https://github.com/osmelpv/gentle-sdd-router.git
cd gentle-sdd-router
npm install
npm link
```

### First use

```bash
# Interactive wizard (detects project state)
gsr

# Or install directly in a project
gsr install
```

This creates a v4 multi-file layout:

```
router/
  router.yaml                    # core: version, active preset, metadata
  profiles/
    multivendor.router.yaml      # default: best model per phase, mixed providers
```

### Basic commands

```bash
gsr status                       # who's in control, active preset, resolved routes
gsr list                         # available presets
gsr use claude                   # switch to Claude-only preset
gsr update                       # check for config migrations (dry-run)
gsr update --apply               # apply pending migrations
gsr help                         # all commands
```

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
gsr use multivendor              # production: best of each provider
gsr use ollama                   # ran out of tokens? go local
gsr use heavyweight              # critical decisions: full multi-agent
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

Copy any profile, rename it, and customize:

```bash
cp router/profiles/multivendor.router.yaml router/profiles/custom.router.yaml
# Edit the file with your preferred models
gsr use custom
```

### Sharing presets

Share a profile file with your team by copying it into their `router/profiles/` directory. No credentials or secrets -- just model routing declarations.

### Import and export

```bash
gsr export multivendor                      # print preset YAML to stdout
gsr export multivendor --compact            # compact gsr:// string for chat/issues
gsr export multivendor --out /tmp/p.yaml    # write to a file
gsr export --all                            # export all presets

gsr import ./some-preset.router.yaml        # import from local file
gsr import https://example.com/preset.yaml  # import from HTTPS URL
gsr import --compact 'gsr://...'            # import compact shared string
gsr import ./preset.yaml --catalog local    # place preset under router/profiles/local/
```

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
gsr update                       # preview pending migrations (dry-run)
gsr update --apply               # apply with automatic backup
```

The migration system:
- Creates a full backup before each migration (`router/backups/`)
- Rolls back automatically on failure
- Tracks applied migrations in `router/.migrations.yaml`
- Preserves user data and unknown YAML keys

---

## Commands

| Command | Description |
|---------|-------------|
| `gsr` | Interactive wizard (TTY) or help (non-TTY) |
| `gsr status` | Show controller, active preset, and resolved routes |
| `gsr list` | List available presets |
| `gsr use <preset>` | Switch the active preset |
| `gsr reload` | Reload config and print resolved routes |
| `gsr install` | Set up gsr in the current project |
| `gsr update [--apply]` | Check for and apply config migrations |
| `gsr activate` | Take control of routing |
| `gsr deactivate` | Hand control back to the host controller |
| `gsr browse [selector]` | Inspect multimodel metadata |
| `gsr compare <left> <right>` | Compare two preset projections |
| `gsr bootstrap [--intent]` | Step-by-step adoption path |
| `gsr render opencode` | Preview OpenCode boundary report |
| `gsr apply opencode [--apply]` | Preview or write OpenCode TAB-switching overlay entries |
| `gsr export <preset>` | Export a preset to stdout, file, or compact string |
| `gsr import <source>` | Import a preset from file, URL, or compact string |
| `gsr version` | Show installed version |
| `gsr help [command]` | Show help |

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

This project follows [Spec-Driven Development](https://github.com/Gentleman-Programming/gentle-ai) (SDD). Changes go through: explore → propose → spec → design → tasks → implement → verify → archive.

---

<div align="center">

<p>Part of the <a href="https://github.com/Gentleman-Programming">Gentleman Programming</a> ecosystem</p>

<img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg" alt="License: UNLICENSED">

</div>
