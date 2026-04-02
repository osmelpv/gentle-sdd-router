# sdd-debug Output Contract

## Overview

Every execution of the `sdd-debug` catalog **MUST** produce a `debug_result` object
conforming to this contract. This contract is consumed by:
- The calling `verify` phase (to decide archive vs re-verify)
- Any orchestrator that invoked `sdd-debug` via cross-catalog mechanism
- Human operators reviewing debug outcomes

---

## Output Schema

```yaml
debug_result:
  status: resolved | partial | failed | escalated
  summary: "Human-readable summary of what was debugged and what happened"
  baseline:
    tests_before: { total: N, passing: N, failing: N }
    tests_after: { total: N, passing: N, failing: N }
  issues_resolved:
    - id: N
      fix_description: "Brief description of the fix applied"
      files_modified: [path/to/file1.ext, path/to/file2.ext]
      tests_added: [path/to/test1.ext]
      confidence: high | medium | low
  issues_unresolved:
    - id: N
      reason: "Why this issue was not resolved"
      recommendation: "What should be done next"
  issues_escalated:
    - id: N
      reason: "Why this requires human or higher-tier intervention"
      evidence: "Specific evidence that triggered escalation"
  regressions:
    - description: "What regressed"
      files_affected: [path/to/file.ext]
      introduced_by: "Fix applied to issue N"
  side_effects:
    - description: "Unexpected behavioral change observed"
      severity: high | medium | low
  requires_reverify: true | false
```

---

## Field Definitions

### `status`
- `resolved` — All reported issues fixed, tests passing, no regressions
- `partial` — Some issues fixed, some remain; `issues_unresolved` is non-empty
- `failed` — Debug was unable to resolve issues; implementation reverted or not applied
- `escalated` — Issues exceed the debug SDD's scope; human or specialist intervention required

### `summary`
Short prose description. Required. Must explain what was debugged, what succeeded,
and any blockers.

### `baseline`
Captures the test delta as proof of no regressions:
- `tests_before` — state of tests when debug started
- `tests_after` — state of tests after all fix attempts

Both objects include: `total`, `passing`, `failing`.

### `issues_resolved`
Array of issues that were successfully fixed. Each entry:
- `id` — Issue identifier from the input payload
- `fix_description` — What was done to fix it
- `files_modified` — List of file paths changed
- `tests_added` — New test files or functions added as proof
- `confidence` — Agent's confidence: `high` (tests prove it), `medium` (manual evidence), `low` (best effort)

### `issues_unresolved`
Issues that were investigated but not fixed:
- `id` — Issue identifier
- `reason` — Why it wasn't fixed (out of scope, time, complexity, etc.)
- `recommendation` — Next step for the caller

### `issues_escalated`
Issues that triggered the escalation guard:
- `id` — Issue identifier
- `reason` — Why it was escalated
- `evidence` — Concrete evidence that triggered the decision

### `regressions`
Any breakage introduced by fix attempts:
- `description` — What broke
- `files_affected` — Files where regression was introduced
- `introduced_by` — Which fix caused it (reference to issue ID)

### `side_effects`
Unexpected behavioral changes that are not strictly regressions but warrant attention.

### `requires_reverify`
Boolean. `true` if the caller (`verify`) should run its own validation cycle again
after receiving this result. MUST be `true` when:
- Any issue was resolved (even partially)
- Any file was modified
- Any test was added

MUST be `false` only when the debug run made zero changes (pure investigation with no fixes).

---

## Hard Constraints

1. `debug_result.status` MUST be one of the four valid enum values — no free text
2. `baseline.tests_after.failing` MUST be `<= baseline.tests_before.failing` unless `status = escalated`
3. `requires_reverify` MUST default to `true` when unsure
4. If `regressions` is non-empty, `status` MUST be `partial`, `failed`, or `escalated` — NEVER `resolved`
5. `confidence: high` REQUIRES at least one entry in `tests_added`

---

## Example: Fully Resolved

```yaml
debug_result:
  status: resolved
  summary: "Fixed 2 failing tests in auth module. All 3 reported issues resolved."
  baseline:
    tests_before: { total: 150, passing: 147, failing: 3 }
    tests_after: { total: 153, passing: 153, failing: 0 }
  issues_resolved:
    - id: 1
      fix_description: "Fixed null check in token validator"
      files_modified: [src/auth/token-validator.js]
      tests_added: [test/auth/token-validator.test.js]
      confidence: high
    - id: 2
      fix_description: "Added missing await in session refresh"
      files_modified: [src/auth/session.js]
      tests_added: [test/auth/session.test.js]
      confidence: high
  issues_unresolved: []
  issues_escalated: []
  regressions: []
  side_effects: []
  requires_reverify: true
```

## Example: Partial with Escalation

```yaml
debug_result:
  status: partial
  summary: "Fixed 1 of 3 issues. Issue 2 requires architecture change. Issue 3 escalated."
  baseline:
    tests_before: { total: 150, passing: 147, failing: 3 }
    tests_after: { total: 151, passing: 148, failing: 2 }
  issues_resolved:
    - id: 1
      fix_description: "Fixed off-by-one in pagination"
      files_modified: [src/pagination.js]
      tests_added: [test/pagination.test.js]
      confidence: high
  issues_unresolved:
    - id: 2
      reason: "Fix requires redesigning the event bus — out of sdd-debug scope"
      recommendation: "Create a new sdd change for event bus refactor"
  issues_escalated:
    - id: 3
      reason: "Security vulnerability — requires security team review"
      evidence: "User input reaches SQL query without sanitization in src/db/query.js:42"
  regressions: []
  side_effects: []
  requires_reverify: true
```
