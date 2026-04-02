---
name: apply-fix
phase_order: 5
description: Implements fixes ONE AT A TIME in triage order. Strict TDD cycle per fix. Snapshots state before each fix. Reverts immediately if the full suite regresses.
---

## Intent

Apply the fix proposals with surgical precision, one fix at a time. For each fix: establish the safety net (run affected tests), write the RED test, implement the minimum code to turn it GREEN, then run the FULL suite and compare against baseline. If any regression appears, revert the fix entirely and report. Never move to the next fix until the current one is fully verified.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| fix-implementer | Fixed | 1 | Strict TDD implementer |

Mono-agent variant: single fix-implementer, no judge, no radar.

## Execution Mode
`sequential` — depends on `propose-fix` output; fixes applied in triage order, one at a time.

## Input Contract

Receives from `propose-fix`:
- Fix proposals in triage order
- Files to touch per fix
- Stay-out zones per fix
- RED test specifications
- Test baseline (from original debug_request)

## Output Contract

Produces a **Fix Implementation Report** with one section per fix:
- Safety net result (tests passing before fix)
- RED phase: test written, confirmed failing
- GREEN phase: code changed, test passing
- Full suite result: before/after comparison
- Status per fix: APPLIED / REVERTED / BLOCKED
- Exact diffs for applied changes

## Skills

- Strict TDD cycle execution (RED → GREEN → TRIANGULATE → REFACTOR)
- Minimal code change discipline
- Full suite regression detection
- Revert and recovery discipline

## Hard Constraints

- **ONE AT A TIME**: complete full cycle before starting the next fix
- **SAFETY NET FIRST**: run existing tests for affected files before any code change
- **STOP ON PRE-EXISTING FAILURE**: if safety net reveals new pre-existing failures, STOP and report
- **RED BEFORE GREEN**: write the test BEFORE touching production code — non-negotiable
- **PROPOSAL ONLY**: implement exactly what the proposal specifies — no improvisation
- **STAY-OUT ZONES**: never touch files listed in the proposal's stay-out zones
- **FULL SUITE AFTER EACH FIX**: run all tests, not just the affected file
- **REVERT ON REGRESSION**: any new failure in the full suite triggers immediate revert

## Success Criteria

- Each fix is applied in triage order
- Each fix has a documented safety net result
- Each fix has a documented RED test (written before production code)
- Each fix has a documented full suite comparison (before vs. after)
- No fix introduces regressions (full suite result ≥ baseline)
- Reverted fixes are fully documented with revert reason
- The final output includes the complete diff for every APPLIED fix
