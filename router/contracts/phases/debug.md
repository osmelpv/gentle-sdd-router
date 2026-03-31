---
name: debug
phase_order: 9
description: Diagnoses root cause when verify fails. Full mini-SDD cycle internally.
trigger: on-failure
depends_on: verify
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 2+ | Parallel root cause analysis for faster diagnosis. |
| judge | Optional | 1 | Validates diagnosis. Distinguishes cause from symptom. |
| radar | Optional | 1 | Identifies secondary failures and systemic issues. |

## Execution Mode
Default: `parallel` — Agents diagnose simultaneously. Judge validates diagnosis before fix.

## Trigger
This phase is NOT part of the normal pipeline. It activates ONLY when:
- `verify` reports a failure
- One or more spec requirements are not met
- Test suite does not pass

## Depends On
`verify` — Debug always follows a failed verify.

## Judge Decision Contract
"Validate root cause diagnosis. Is this the cause or a symptom? Escalate if diagnosis is contradictory."

## Mini-SDD Internal Cycle

Debug runs a condensed SDD cycle internally:
1. **Diagnose**: Identify root cause (parallel agents)
2. **Plan**: Define minimal fix (judge synthesizes)
3. **Fix**: Apply the fix (single agent — mono apply)
4. **Re-verify**: Run targeted tests to confirm fix

## Phase Input
- Verify phase output (failure report, gap list)
- Apply phase output (implementation)
- Spec requirements (expected behavior)

## Phase Output
- Root cause analysis with evidence
- Fix applied (or fix plan if blocked)
- Targeted test results confirming fix
- Recommendation: re-verify full suite OR escalate to user
