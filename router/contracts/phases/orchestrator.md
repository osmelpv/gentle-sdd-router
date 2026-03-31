---
name: orchestrator
phase_order: 1
description: Coordinates the SDD pipeline. Routes tasks, manages context, delegates to sub-agents.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | Reasoning model recommended for orchestration decisions. |
| judge | Optional | 1 | Validates delegation decisions and context management. |
| radar | Optional | 1 | Monitors for coordination blind spots. |

## Execution Mode
Default: `sequential` — Single orchestrator agent drives the pipeline.

## Judge Decision Contract
"Validate delegation decisions and context management."

## Phase Input
- User's change description or issue
- SDD context from previous sessions (Engram)
- Project skills and conventions

## Phase Output
- Delegation plan for sub-agents
- Phase routing decisions
- Context handoff packages for each phase
