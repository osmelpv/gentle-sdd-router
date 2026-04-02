---
name: propose-fix
phase_order: 4
description: Proposes the MOST CONSERVATIVE fix for each diagnosed issue. Minimum change surface. No refactoring. No API changes. Explicit stay-out zones. Test-first specification.
---

## Intent

Design the smallest possible fix that resolves each root cause without touching anything else. Work in triage order. Every fix proposal must specify the exact change, the files to touch, the files NOT to touch (stay-out zones), the RED test that demonstrates the bug, and the residual risk assessment.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| fix-proposer | Fixed | 1 | Conservative surgical fix planner |

Mono-agent variant: single fix-proposer, no judge, no radar.

## Execution Mode
`sequential` — depends on `diagnose` output; proposals created in triage order.

## Input Contract

Receives from `diagnose`:
- Diagnosed root causes with exact locations
- Evidence chains
- Confidence levels per diagnosis
- Regression flags (internal vs. external)

## Output Contract

Produces a **Fix Proposal** with one entry per non-escalated issue:
- Root cause reference (one-line summary from diagnosis)
- Proposed fix: type, files to touch, estimated change surface
- Files NOT to touch (stay-out zones) with justification
- RED test specification (what test to write first, what it asserts, why it fails before the fix)
- Tests to add
- Residual risk assessment

## Skills

- Minimal-change fix design
- Test-first thinking (RED test specification)
- Impact surface estimation
- Stay-out zone documentation

## Hard Constraints

- **MINIMUM CHANGE**: the smallest fix that corrects the root cause — no additions for safety margins
- **NO REFACTORING**: working code is not touched — only the defective code path
- **NO API CHANGES**: if the fix requires changing a public interface, ESCALATE — do not work around it
- **STAY-OUT ZONES REQUIRED**: every proposal must list files that must NOT be touched
- **RED TEST REQUIRED**: every proposal must specify the test that demonstrates the bug first
- **RESIDUAL RISK REQUIRED**: no proposal is complete without a residual risk entry
- **TRIAGE ORDER**: proposals must follow the triage-defined resolution order

## Success Criteria

- Every non-escalated, diagnosed issue has a fix proposal
- Each proposal specifies the minimum change needed (no gold-plating)
- Each proposal includes explicit stay-out zones
- Each proposal includes a RED test specification
- Each proposal includes a residual risk assessment
- No proposal touches a public API — API-breaking scenarios are ESCALATED
- Combined fixes (same root cause) are explicitly justified
