---
name: propose
phase_order: 3
description: Structures a formal proposal from exploration — scope, risk, approach.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | Uses explore output as primary input. |
| judge | Optional | 1 | Evaluates proposal clarity, scope definition, and feasibility. |

## Execution Mode
Default: `sequential` — Single agent structures the proposal, judge reviews if present.

## Judge Decision Contract
"Evaluate proposal clarity, scope definition, and feasibility."

## Phase Input
- Explore phase output (affected areas, approaches, risks)
- User's original change intent
- Project constraints and conventions

## Phase Output
- Formal change proposal with: scope definition, risk summary, recommended approach
- Open questions requiring user decision
- Success criteria for downstream phases
