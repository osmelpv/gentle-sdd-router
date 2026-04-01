# Feature Request: Custom SDD Workflows (SDD Factory)

> **Origin**: ArchonLord project (game development)
> **Requested by**: osmelpv
> **Date**: 2026-04-01
> **Priority**: High — blocks game design workflow and debug workflow adoption

---

## Executive Summary

GSR currently routes models to the 10 fixed SDD phases. This feature request asks GSR to evolve into an **SDD Factory** — capable of creating complete, purpose-built SDD workflows with custom phases, custom agent roles, and inter-SDD linking. The default SDD remains global; custom SDDs live at project level.

---

## Why This Is Needed

### The Problem

The current SDD workflow (explore → propose → spec → design → tasks → apply → verify → archive) is designed for **code development**. But real projects need multiple specialized workflows:

1. **Game Design SDD** — phases that produce design documents, not code. Agents with game industry roles (Game Director, Narrative Designer, Balance Designer). The output feeds INTO the code SDD later.

2. **Debug SDD** — a focused workflow triggered when `verify` finds issues. It has its own TDD phase, targeted exploration, fix, and re-verify. When it completes, control returns to the main SDD's verify phase. This is more efficient than re-running the full SDD for bug fixes.

3. **Domain-specific SDDs** — as projects grow, new workflows emerge. DevOps, content creation, QA certification — each has its own phases, roles, and deliverables.

The 10 SDD phases CAN be adapted to many scenarios, but when you need agents fulfilling specific industry roles (a Narrative Writer who understands story arcs, a Balance Designer who understands game economy), with specific inputs/outputs per phase, and the ability to chain SDDs together — you need purpose-built workflows.

### The Vision

```
OpenCode TAB switching:

TAB 1: SDD-Orchestrator (default, global)     → code development
TAB 2: Game-Design-SDD (project-level)         → design documents
TAB 3: Debug-SDD (project-level)               → focused bug fixing
```

Each catalog maps to a complete SDD with its own phases, agents, contracts, and execution flow.

---

## Feature Breakdown

### Feature 1: Per-Catalog Contracts Directory

**Current state**: Contracts live in `router/contracts/` (global, npm package level). All catalogs share the same role and phase contracts.

**Needed**: Each catalog can optionally have its own `contracts/` directory with custom roles and phase compositions.

```
router/
  contracts/                          # Global contracts (default SDD)
    roles/
    phases/
  profiles/
    game-design/                      # Project-level catalog
      contracts/                      # <-- NEW: catalog-specific contracts
        roles/
          game-director.md
          narrative-designer.md
          balance-designer.md
          multiplayer-architect.md
          art-director.md
        phases/
          concept.md
          narrative.md
          mechanics.md
          balance.md
          tech-spec.md
      game-design.router.yaml
```

**Resolution order**: Catalog contracts → Global contracts → Error if not found.

**Why**: A Game Director agent needs completely different behavioral rules than a code Agent. Their input/output contracts, personality, expertise scope, and output format are all different. Mixing them in global contracts pollutes the standard SDD.

---

### Feature 2: Custom Phase Definitions with Intent

**Current state**: Phases are the 10 fixed SDD phases. Profiles can only assign models to these known phases.

**Needed**: Profiles can define arbitrary phase names, each with:
- **Intent/purpose**: What this phase produces and why
- **Composition**: How many agents, which roles, parallel/sequential
- **Input contract**: What this phase receives (from previous phase or external)
- **Output contract**: What this phase produces
- **Dependency graph**: Which phases must complete before this one runs

```yaml
# game-design.router.yaml
name: game-design
catalog: game-design
custom_phases:
  concept:
    intent: "Define high-level game concept, pillars, and unique selling points"
    composition:
      agents: 2
      judge: true
      radar: false
    execution: parallel
    input: "Reference data, market research, player motivations"
    output: "Game Concept Document (GCD)"
    depends_on: []

  narrative:
    intent: "Write the game's story, lore, world-building, and faction histories"
    composition:
      agents: 1
      judge: false
    execution: sequential
    input: "Game Concept Document"
    output: "Narrative Bible"
    depends_on: [concept]

  mechanics:
    intent: "Design core gameplay loops, systems, and interactions"
    composition:
      agents: 2
      judge: true
      radar: true
    execution: parallel
    input: "Game Concept Document, Reference DB (archonlord_core.db)"
    output: "Game Design Document (GDD) — Mechanics Section"
    depends_on: [concept]

  balance:
    intent: "Design numerical balance, economy, progression curves"
    composition:
      agents: 1
      judge: false
    execution: sequential
    input: "GDD Mechanics, Reference DB stats"
    output: "Balance Sheet + Economy Model"
    depends_on: [mechanics]

  multiplayer:
    intent: "Design networking architecture, matchmaking, PvP/PvE flows"
    composition:
      agents: 2
      judge: true
    execution: parallel
    input: "GDD Mechanics, Game Concept"
    output: "Multiplayer Architecture Document"
    depends_on: [mechanics]

  tech-spec:
    intent: "Technical specification for implementation: stack, DB, modules"
    composition:
      agents: 2
      judge: true
      radar: true
    execution: parallel
    input: "All previous documents"
    output: "Technical Specification Document"
    depends_on: [mechanics, multiplayer, balance]

phases:
  concept:
    - target: anthropic/claude-opus
      kind: lane
      phase: concept
      role: game-director
  narrative:
    - target: anthropic/claude-opus
      kind: lane
      phase: narrative
      role: narrative-designer
  mechanics:
    - target: anthropic/claude-opus
      kind: lane
      phase: mechanics
      role: game-director
  balance:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: balance
      role: balance-designer
  multiplayer:
    - target: openai/gpt-5
      kind: lane
      phase: multiplayer
      role: multiplayer-architect
  tech-spec:
    - target: anthropic/claude-opus
      kind: lane
      phase: tech-spec
      role: primary
```

---

### Feature 3: Custom Agent/Skill Creation with Context

**Current state**: GSR ships 9 global role contracts (agent, judge, radar, etc.). No mechanism to create project-specific roles.

**Needed**: `gsr` CLI commands to create custom agent roles within a catalog, with:
- Role definition (personality, expertise, behavioral rules)
- Input/output contract
- Engram integration (same memory system, scoped appropriately)
- Skill format compatible with agent-teams-lite

```bash
gsr role create game-director --catalog game-design
gsr role create narrative-designer --catalog game-design
gsr role create balance-designer --catalog game-design
```

Each creates a contract `.md` file in the catalog's `contracts/roles/` directory.

**Critical**: These agents must use the SAME methodology as current SDD agents:
- Engram for persistent memory
- Skill injection from the orchestrator
- Structured output with status, artifacts, next_recommended
- The orchestrator resolves skills and injects compact rules just like code SDD

The difference is WHAT they produce (documents vs code) and their EXPERTISE (game design vs software engineering).

---

### Feature 4: SDD Linking (Inter-SDD Triggers)

**Current state**: Each SDD runs independently. No mechanism to trigger one SDD from another.

**Needed**: SDDs can declare trigger points that launch another SDD and return control when done.

**Use case: Debug SDD**

```
Main SDD:
  ... → apply → verify → [issues found] → TRIGGER debug-sdd → [fixes applied] → verify (re-run)

Debug SDD (triggered):
  tdd-first → explore-bug → design-fix → apply-fix → verify-fix → RETURN to caller
```

```yaml
# debug-sdd.router.yaml
name: debug-sdd
catalog: debug
trigger:
  from: sdd-orchestrator
  phase: verify
  condition: "issues_found > 0"
  return_to: verify    # re-run verify after debug completes

custom_phases:
  tdd-first:
    intent: "Write failing tests that reproduce the issues"
    depends_on: []
  explore-bug:
    intent: "Investigate root cause of each issue"
    depends_on: [tdd-first]
  design-fix:
    intent: "Design the minimal fix approach"
    depends_on: [explore-bug]
  apply-fix:
    intent: "Implement the fixes"
    depends_on: [design-fix]
  verify-fix:
    intent: "Run tests, verify fixes don't break other things"
    depends_on: [apply-fix]
```

---

### Feature 5: Project-Level vs Global Scope

**Current state**: GSR configuration lives in `router/` at project root. Contracts are global (npm package).

**Needed**: Clear scope separation:

| Scope | What | Where | Example |
|-------|------|-------|---------|
| **Global** | Default SDD, built-in presets, standard contracts | npm package | `sdd-orchestrator`, multivendor preset |
| **Project** | Custom catalogs, custom SDDs, custom contracts | `router/catalogs/{name}/` at project root | game-design, debug-sdd |

```
router/
  router.yaml                           # Core config (global reference)
  profiles/
    multivendor.router.yaml             # Global preset (default SDD)
  catalogs/                             # <-- NEW: project-level catalogs
    game-design/
      sdd.yaml                          # SDD definition (phases, deps, triggers)
      profiles/
        game-design.router.yaml         # Model routing
      contracts/
        roles/
          game-director.md
          narrative-designer.md
        phases/
          concept.md
          narrative.md
    debug/
      sdd.yaml
      profiles/
        debug.router.yaml
      contracts/
        phases/
          tdd-first.md
          explore-bug.md
```

**Key rule**: The default SDD (`sdd-orchestrator`) stays GLOBAL. Custom SDDs are PROJECT-LEVEL and travel with the repo.

---

### Feature 6: Host Sync for Custom Phases

**Current state**: `gsr sync` generates a manifest for the 10 standard SDD phases. The host (opencode) only recognizes these phases.

**Needed**: `gsr sync` must include custom phases from all enabled catalogs in the manifest, so the host can discover and execute them.

The sync manifest should include:
- Phase name, intent, composition, execution mode
- Associated role contracts (inline or referenced)
- Dependency graph
- Trigger/return points for linked SDDs

The host then uses this manifest to:
1. Register custom phases as executable
2. Load catalog-specific role contracts for agent injection
3. Respect the dependency graph when orchestrating
4. Handle inter-SDD triggers

---

## Implementation Priority

| Priority | Feature | Reason |
|----------|---------|--------|
| **P0** | Per-catalog contracts (F1) | Without this, can't define custom agent roles |
| **P0** | Custom phase definitions (F2) | Without this, can't define custom workflows |
| **P1** | Custom agent creation CLI (F3) | Quality of life for creating roles |
| **P1** | Project-level scope (F5) | Needed for catalogs to travel with repos |
| **P2** | SDD linking (F4) | Debug SDD is important but not blocking |
| **P2** | Host sync for custom phases (F6) | Needed for end-to-end execution |

---

## Context: ArchonLord Project

This feature request originates from the ArchonLord game project, which needs:

1. **A Game Design SDD** to coordinate AI agents that design the game (narrative, mechanics, balance, multiplayer, art direction). The agents would analyze reference data from a scraped encyclopedia database and produce game design documents.

2. **A Debug SDD** to handle issues found during verification — focused TDD-first workflow that feeds fixes back to the main SDD.

3. **Future SDDs** as the project grows (QA certification, deployment, content updates).

The current default SDD is already being used for code development in the project. The game design workflow needs to run alongside it, switchable via TAB, with its own agents that have game-industry expertise.

---

## Notes for Development

- The `gsr catalog create` command already works. The extension would be to allow catalogs to contain full SDD definitions, not just model routing.
- Engram integration should be preserved — custom SDD agents should save/search memory with the same protocol, possibly with a catalog-scoped namespace.
- The non-executing boundary of GSR is respected: GSR declares the SDD structure, the HOST executes it. But the host needs the manifest to know WHAT to execute.
- Consider backward compatibility: existing catalogs with only model routing should continue to work unchanged.
