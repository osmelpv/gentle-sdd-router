---
name: validate-fix
phase_order: 6
description: Runs the FULL test suite after all fixes are applied. Compares against baseline. Verifies issue tests pass and no previously-passing test now fails. Zero tolerance for regressions.
---

## Intent

Be the definitive quality gate before the debug session is archived. Run the entire test suite, compare every metric against the original baseline, and produce a validation report that honestly reflects whether the debug session succeeded, partially succeeded, or failed. No regressions are acceptable. The calling SDD trusts this report to decide whether to proceed.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| fix-validator | Fixed | 1 | Quality gate specialist |

Mono-agent variant: single fix-validator, no judge, no radar.

## Execution Mode
`sequential` — depends on `apply-fix` output; validates the complete set of applied fixes.

## Input Contract

Receives from `apply-fix`:
- Implementation reports for all applied fixes
- List of new tests added
- From original `debug_request`: test baseline (total, passing, failing)

## Output Contract

Produces a **Validation Report** containing:
- Test suite comparison table (baseline vs. after debug)
- Issue resolution status table (per issue: test added? test passes? regression detected?)
- Regression analysis (if any new failures detected)
- Side effects detected (even if not test failures)
- Confidence level: HIGH / MEDIUM / LOW
- Overall result: PASSED / FAILED / PARTIAL
- Re-investigation triggers (which issues need re-investigation and why)

## Skills

- Full test suite execution and result comparison
- Baseline delta analysis
- Side effect detection
- Confidence assessment methodology

## Hard Constraints

- **FULL SUITE**: run all tests — partial runs are not validation
- **BASELINE IS TRUTH**: compare against the original test_baseline, not the apply-fix reports
- **ZERO REGRESSIONS**: any previously-passing test now failing = FAILED validation
- **TEST COUNT FLOOR**: if total tests DECREASED from baseline, validation FAILS
- **ALL ISSUES CHECKED**: every issue from the debug_request must appear in the resolution status table
- **SIDE EFFECTS MANDATORY**: even if no test fails, side effects must be reported
- **HONEST CONFIDENCE**: derive confidence from the data — do not inflate it

## Success Criteria

- Full suite was run (not partial)
- Comparison table is complete (all metrics vs. baseline)
- All issue tests are verified (pass or fail)
- Zero regressions detected (or regression causes FAILED status)
- Test count is ≥ baseline
- Confidence level matches the actual evidence
- Overall result accurately reflects the state: PASSED (all green), FAILED (any regression), PARTIAL (some resolved, some not)
