---
name: apply
phase_order: 7
description: Implements tasks — writes code following spec and design. Always ONE agent.
alwaysMono: true
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | ALWAYS mono. ONE agent. No exceptions. |

## Execution Mode
Default: `sequential` — ONE agent. No parallelism. No judge. No secondary. ALWAYS.

## Judge Decision Contract
N/A — This phase is always mono. No judge allowed.

## Mono Enforcement Rationale

Apply is always one agent because:
- Multiple agents writing code simultaneously create merge conflicts
- Consistency of style and approach requires a single author
- The task checklist is sequential by design — tasks depend on each other
- The apply agent must maintain full context of all changes made

## Batch Execution (for large changes)

For large changes that cannot fit in one context window:
- Split tasks into batches by file or module boundary
- Each batch runs as a separate sequential apply session
- Each session reads the previous session's progress from Engram
- Tasks are marked `[x]` as they complete

## Phase Input
- Tasks phase output (task checklist, failing tests)
- Design decisions (must be followed — no freelancing)
- Spec requirements (acceptance criteria)
- Codebase (existing patterns to match)

## Phase Output
- Implemented code that makes the failing tests pass
- Updated task checklist with `[x]` marks
- Implementation notes for verify phase
