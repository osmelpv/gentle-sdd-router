---
name: spec
phase_order: 4
description: Writes formal requirements and behavioral scenarios.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 2+ | Parallel spec writing for diversity of coverage. |
| judge | Optional | 1 | Synthesizes specs. Must be a reasoning model. |
| investigator | Optional | 1 | External research for grounding spec in reality. |
| security-auditor | Optional | 1 | Flags security requirements early. |

## Execution Mode
Default: `parallel` — Agents write specs simultaneously. Judge synthesizes, incorporating investigator and security findings.

## Judge Decision Contract
"Choose most verifiable spec. Eliminate ambiguity. Ensure line coherence. Cross-reference external research from investigator."

## Phase Input
- Proposal phase output (scope, approach, success criteria)
- Investigator findings (if present)
- Project conventions and existing spec patterns

## Phase Output
- Formal requirements (numbered, traceable)
- Behavioral scenarios (Given/When/Then or equivalent)
- Security requirements (if security-auditor present)
- Open questions that block spec completion
