---
name: archive
phase_order: 10
description: Syncs delta specs to main docs. Mechanical file operation. Always ONE agent.
alwaysMono: true
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | ALWAYS mono. Mechanical file operations only. |

## Execution Mode
Default: `sequential` — ONE agent. No parallelism. No judge. Mechanical operations only.

## Judge Decision Contract
N/A — This phase is always mono. No judgment required.

## Mono Enforcement Rationale

Archive is always one agent because:
- File operations are deterministic — no need for parallel synthesis
- Multiple agents writing to the same docs files creates conflicts
- The operation is mechanical: copy, sync, move. Not creative.

## Phase Input
- All SDD artifacts from this change (spec, design, tasks, implementation notes)
- Existing main documentation
- Verify phase confirmation (must pass before archive)

## Phase Output
- Delta specs merged into main spec files
- Change log entry created
- SDD change folder archived or closed
- Engram session summary saved
