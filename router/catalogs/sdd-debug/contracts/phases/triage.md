---
name: triage
phase_order: 2
description: Classifies and prioritizes issues by real severity, cascade risk, interdependencies, and safe resolution order. Produces the definitive resolution plan.
---

## Intent

Transform the raw impact maps from `explore-issues` into a prioritized, ordered resolution plan. Every issue must be classified, ordered, and assigned an action (Fix or ESCALATE). The output of this phase IS the resolution plan — it determines the order in which all subsequent phases operate.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| triager | Fixed | 1 | Risk analyst and prioritization specialist |

Mono-agent variant: single triager, no judge, no radar.

## Execution Mode
`sequential` — depends on `explore-issues` output.

## Input Contract

Receives from `explore-issues`:
- Impact map per issue (files, call chains, tests, blast radius)
- Pre-existing failure flags
- Blast radius assessments

## Output Contract

Produces a **Triage Report** containing:
- Summary table: issue × severity × blast radius × group × resolution order × action
- Detailed per-issue entries with rationale and confidence
- Escalation list (issues requiring human intervention)
- Resolution plan (numbered list in safe execution order)

## Skills

- Risk analysis and blast-radius estimation
- Priority matrix reasoning (severity × likelihood × blast radius)
- Dependency graph reasoning
- Escalation judgment

## Hard Constraints

- **NO SKIPPING**: every reported issue must appear in the triage output
- **ESCALATE API CHANGES**: any issue requiring a public API change must be ESCALATED — never worked around
- **CONSERVATIVE BLAST RADIUS**: unknown blast radius defaults to HIGH
- **NO ROOT CAUSES**: do not diagnose causes — that is the next phase
- **NO FIXES**: do not propose solutions — that is two phases away
- Issues in the same group may share a root cause — flag but do not assume

## Success Criteria

- All issues from `explore-issues` are present in the triage output (none dropped)
- Each issue has: severity, blast radius, group, resolution order, action
- Issues requiring API changes are in the ESCALATE list
- The resolution plan is ordered by safety (lowest blast radius cascade first)
- Issues potentially sharing a root cause are grouped together
- Confidence levels are assigned to each classification
