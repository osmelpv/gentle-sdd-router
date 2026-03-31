---
name: design
phase_order: 5
description: Produces technical architecture, module design, and key decisions.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 2+ | Parallel design for approach diversity. |
| judge | Optional | 1 | Chooses the architecture that fits best. |
| radar | Optional | 1 | Identifies blind spots in proposed architectures. |

## Execution Mode
Default: `parallel` — Agents produce independent designs. Judge synthesizes using radar's blind-spot report.

## Judge Decision Contract
"Choose architecture that fits existing patterns AND spec requirements. Fuse complementary design decisions. Escalate contradictions with tradeoff analysis."

## Phase Input
- Spec phase output (requirements, scenarios)
- Codebase context (existing patterns, module structure)
- Explore findings (affected areas map)

## Phase Output
- Technical architecture with module boundaries
- Key design decisions with rationale
- Interface contracts between modules
- Risks and mitigation strategies
