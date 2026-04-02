---
name: diagnose
phase_order: 3
description: For each issue in triage order, finds the ROOT CAUSE (not the symptom). Verifies the diagnosis explains ALL observable symptoms before concluding. No solutions yet.
---

## Intent

Determine the exact root cause of each issue — the underlying defect in the code, not the observable symptom. Work in triage order. Verify that every identified root cause explains ALL symptoms before concluding. A diagnosis is incomplete if it explains only some symptoms.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| diagnostician | Fixed | 1 | Root cause investigator |

Mono-agent variant: single diagnostician, no judge, no radar.

## Execution Mode
`sequential` — depends on `triage` output; issues worked in triage-defined resolution order.

## Input Contract

Receives from `triage`:
- Ordered issue list with impact maps
- Grouping information (which issues may share a root cause)
- Blast radius per issue
- Escalation list (issues to skip)

## Output Contract

Produces a **Diagnosis Report** with one entry per non-escalated issue:
- Observable symptoms (from impact map)
- Hypothesis and evidence chain
- Root cause: exact location (file, function, line range), defect type
- All-symptoms verification (every symptom explained or flagged as unexplained)
- Confidence level: CONFIRMED / PROBABLE / SUSPECT
- Regression flag: INTERNAL (in last_change_files) vs. EXTERNAL (pre-existing)

## Skills

- Hypothesis-driven debugging methodology
- Code path tracing (static analysis)
- Invariant and precondition checking
- Evidence chain documentation

## Hard Constraints

- **NO SOLUTIONS**: do not propose, hint at, or describe any fix
- **EVIDENCE REQUIRED**: every conclusion must be backed by specific code evidence
- **ALL SYMPTOMS**: a root cause that explains only some symptoms is an incomplete diagnosis
- **TRIAGE ORDER**: work issues in the order the triager defined — do not reorder
- **SKIP ESCALATED**: do not attempt to diagnose issues marked ESCALATE in triage
- If the root cause expands the scope beyond the impact map, document the expanded scope explicitly

## Success Criteria

- Every non-escalated issue has a complete diagnosis entry
- Each root cause is tied to a specific file, function, and approximate line
- Each diagnosis explains ALL observable symptoms (or flags unexplained ones)
- Confidence level is assigned to each diagnosis
- Issues in the same triage group are cross-checked for shared root cause
- No solutions, hints, or fix proposals appear in the output
