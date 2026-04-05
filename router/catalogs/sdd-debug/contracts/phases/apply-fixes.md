---
name: apply-fixes
phase_order: 4
description: Implements the approved fix with minimal change surface. Runs FULL regression check. Verifies fix works AND no previously-passing test fails. Does NOT refactor working code. Does NOT change public APIs.
---

## Composition
| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| fix-implementer | Fixed | 1 | Implements the approved fix with surgical precision, runs full regression |

## Execution Mode
Default: `sequential` — Single agent implements the fix carefully.

## Delegation
`sub-agent` — This phase is delegated to a sub-agent. The orchestrator does NOT handle this directly.

## Dependencies
- `collect-and-diagnose` — Requires the approved proposed solution (user checkpoint passed).

## Dynamic Skill Loading
The agent MUST detect the target language and load the appropriate skill:

```
Detect language from files_to_touch in proposed-solutions:
├── *.ts, *.js → Load skill: apply-typescript
├── *.py → Load skill: apply-python
├── *.go → Load skill: apply-go
├── *.cs → Load skill: apply-dotnet
├── *.java → Load skill: apply-java
├── *.rs → Load skill: apply-rust
└── Unknown → Standard apply mode

Each apply skill provides:
- Code formatting conventions for that language
- Testing patterns (where to put tests, naming conventions)
- Import/module resolution rules
- Error handling idioms
```

## Phase Input
- Approved proposed solution from checkpoint (user approved in collect-and-diagnose)
- Files to touch with impact analysis
- Root cause analysis and evidence chain
- From Engram: `engram_memory(action: "search", query: "sdd-debug/{issue}/proposed-solutions")`

## TDD Implementation Cycle

The fix MUST follow strict TDD discipline:

```
TDD Cycle for Debug Fixes:
1. BASELINE: Run the full test suite → record total/passing/failing counts
2. RED: Write a test that demonstrates the bug
   ├── The test MUST fail BEFORE the fix is applied
   ├── The test MUST target the exact root cause identified
   └── The test MUST be specific enough to prevent regression
3. GREEN: Apply the MINIMAL fix that makes the RED test pass
   ├── Touch ONLY the files listed in the proposal
   ├── Change ONLY what is necessary
   └── Match existing code patterns and conventions
4. FULL SUITE: Run ALL tests (not just the new one)
   ├── Record total/passing/failing counts
   ├── Compare with BASELINE
   └── Identify any new failures (regressions)
5. REPORT: Produce regression report with before/after comparison
```

## Hard Constraints

1. **Do NOT refactor working code** — even if it's ugly, if it works, leave it alone
2. **Do NOT change public APIs** — unless the API itself is the documented root cause
3. **Do NOT add features** — implement ONLY the approved fix, nothing more
4. **Do NOT touch files outside the proposal** — if the fix requires touching an unlisted file, STOP and report back to orchestrator
5. **Do NOT skip the RED test** — never write production code before the failing test
6. **FULL suite MUST run after implementation** — not just the affected test file
7. **If full suite regresses**: document the regression, do NOT attempt to fix it within this phase — report to finalize for loop decision
8. **Match existing code patterns** — do not introduce new patterns, conventions, or libraries

## Regression Report Format

```yaml
regression_report:
  baseline:
    total: N
    passing: N
    failing: N
    timestamp: "ISO-8601"
  after_fix:
    total: N
    passing: N
    failing: N
    timestamp: "ISO-8601"
  delta:
    tests_added: N
    tests_fixed: N     # previously failing, now passing
    tests_regressed: N # previously passing, now failing
    tests_removed: N
  regressions:
    - test_name: "test description"
      file: "path/to/test"
      error: "error message"
      likely_cause: "which change caused this"
  fix_verification:
    red_test_name: "test that demonstrates the bug"
    red_test_file: "path/to/test"
    red_confirmed: true | false  # did it fail before the fix?
    green_confirmed: true | false # did it pass after the fix?
  confidence: high | medium | low
  confidence_justification: "why this confidence level"
```

## Phase Output
- **Modified files** written to filesystem
- **New tests** added (RED → GREEN cycle)
- **Regression report** with complete before/after comparison
- **Apply progress** persisted to Engram
- Return to orchestrator:
  ```yaml
  status: success | partial | regressed | blocked
  executive_summary: "1-2 sentence summary"
  artifacts:
    - "sdd-debug/{issue}/apply-progress"
    - "sdd-debug/{issue}/regression-report"
  next_recommended: finalize
  files_changed: N
  tests_added: N
  regressions_detected: N
  confidence: high | medium | low
  ```

## Engram Persistence
- **Apply Progress**:
  - Topic Key: `sdd-debug/{issue}/apply-progress`
  - Type: `architecture`
  - Content: Files changed, diff summary, new tests, deviations from proposal
- **Regression Report**:
  - Topic Key: `sdd-debug/{issue}/regression-report`
  - Type: `architecture`
  - Content: Full regression report (baseline, after_fix, delta, regressions)
- **Persist calls**:
  ```
  engram_memory(action: "record_observation", content: "<progress>", category: "finding",
    tags: ["sdd-debug/{issue}/apply-progress"])
  engram_memory(action: "record_observation", content: "<regression>", category: "finding",
    tags: ["sdd-debug/{issue}/regression-report"])
  ```
