# sdd-debug Output Contract (v2)

## Overview

Every execution of the `sdd-debug` catalog v2 **MUST** produce a `debug_result` object conforming to this contract. This is a **SUPERSET** of the v1 sdd-debug and sdd-debug-by-logs output contracts — all v1 fields are preserved, new fields are added.

This contract is consumed by:
- The calling `verify` phase (to decide archive vs re-verify)
- Any orchestrator that invoked `sdd-debug` via cross-catalog mechanism or `debug_invoke`
- Human operators reviewing debug outcomes
- Future debug sessions (via Engram lessons-learned)

---

## Output Schema

```yaml
debug_result:
  status: resolved | partial | failed | escalated | cycling
  summary: "Human-readable summary of what was debugged and what happened"
  cycle_count: N
  baseline:
    tests_before: { total: N, passing: N, failing: N }
    tests_after: { total: N, passing: N, failing: N }
  root_cause: "What actually caused the problem"
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
  evidence:
    key_log_entries: ["file:line → log output"]
    forensic_timeline: "Summary of the execution sequence from guard logs"
    tdd_results: "Test results that proved/disproved hypotheses"
  lessons_learned:
    - "Lesson 1: What this debug session taught us"
    - "Lesson 2: Pattern discovered"
  conventions_created:
    - topic_key: "conventions/{ecosystem}/{pattern}"
      description: "New convention discovered during debug"
  tests_suggested:
    - name: "test_name"
      scenario: "What this test should verify"
      file: "path/to/test/file.ext"
  guards_cleaned: N
  requires_reverify: true | false
  engram_entries:
    - "sdd-debug/{issue}/root-cause"
    - "sdd-debug/{issue}/fix-applied"
    - "sdd-debug/{issue}/lessons-learned"
```

---

## Field Definitions

### `status`
- `resolved` — Root cause identified, fix applied, ALL tests passing, no regressions, ALL guards cleaned
- `partial` — Fix applied but some uncertainty remains; `issues_unresolved` or `lessons_learned` is non-empty
- `failed` — Debug was unable to identify root cause or fix did not resolve the issue after max cycles
- `escalated` — Issue exceeds sdd-debug scope; human or specialist intervention required
- `cycling` — Still in the debug loop (returned mid-cycle from finalize back to collect-and-diagnose)

### `summary`
Short prose description. Required. Must explain what was debugged, what succeeded, and any blockers.

### `cycle_count`
Number of times the debug loop ran: `collect-and-diagnose → apply-fixes → finalize`.
- `1` = fixed on first attempt
- `2-3` = normal iteration
- `>3` = complex issue, should escalate

### `baseline`
Captures the test delta as proof of no regressions:
- `tests_before` — state of tests when debug started
- `tests_after` — state of tests after all fix attempts

Both objects include: `total`, `passing`, `failing`.

### `root_cause`
The ACTUAL cause of the problem (not the symptom). Must be specific and evidence-backed. This field is the single most important piece of information — it answers "why did this happen?"

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
Unexpected behavioral changes that are not strictly regressions but warrant attention:
- `description` — What changed unexpectedly
- `severity` — `high` (user-facing), `medium` (internal), `low` (cosmetic)

### `evidence`
Forensic evidence that proves the root cause:
- `key_log_entries` — The specific SDD-DBG-GXXX log entries that revealed the root cause
- `forensic_timeline` — Brief summary of what happened at each step in the execution path
- `tdd_results` — Test results that proved/disproved hypotheses during investigation

### `lessons_learned`
What this debug session taught us about the codebase. Each lesson should be actionable — not "things were broken" but "always check X when Y happens because Z."

### `conventions_created`
New coding patterns or practices discovered during the debug session that should be adopted project-wide:
- `topic_key` — Engram topic key for retrieval
- `description` — What the convention is and why it matters

### `tests_suggested`
Additional tests that should be created to prevent this bug from returning:
- `name` — Specific test name (not vague)
- `scenario` — What the test verifies
- `file` — Where the test should live

### `guards_cleaned`
Number of log guards that were planted (implant-logs) and subsequently removed (finalize). MUST equal the count from the Guard Position Registry.

### `requires_reverify`
Boolean. `true` when:
- Any issue was resolved (even partially)
- Any file was modified
- Any test was added

`false` only when the debug run made zero changes (pure investigation with no fixes).

### `engram_entries`
List of Engram topic_keys created during the session for future retrieval.

---

## Hard Constraints

1. `debug_result.status` MUST be one of the five valid enum values — no free text
2. `baseline.tests_after.failing` MUST be `<= baseline.tests_before.failing` unless `status = escalated`
3. `guards_cleaned` MUST equal the total count in the Guard Position Registry — any mismatch MUST be reported as an error
4. If `cycle_count > 3` and `status != resolved`, `status` SHOULD be `escalated`
5. `confidence: high` REQUIRES at least one entry in `tests_added`
6. `requires_reverify` MUST default to `true` when unsure
7. If `regressions` is non-empty, `status` MUST be `partial`, `failed`, or `escalated` — NEVER `resolved`
8. `root_cause` MUST be evidence-backed — reference specific log entries or test results
9. `lessons_learned` entries MUST be actionable — "always do X" not "Y was broken"
10. `tests_suggested` entries MUST have specific names and scenarios — not "add more tests"

---

## Example: Fully Resolved

```yaml
debug_result:
  status: resolved
  summary: "Fixed null pointer in token validator. Root cause: missing null check on user.session after Redis timeout."
  cycle_count: 1
  baseline:
    tests_before: { total: 150, passing: 147, failing: 3 }
    tests_after: { total: 153, passing: 153, failing: 0 }
  root_cause: "user.session is null when Redis connection times out. The token validator assumed session was always present."
  issues_resolved:
    - id: 1
      fix_description: "Added null check for user.session before accessing session.token. Returns 401 instead of 500."
      files_modified: [src/auth/token-validator.js]
      tests_added: [test/auth/token-validator.test.js]
      confidence: high
  issues_unresolved: []
  issues_escalated: []
  regressions: []
  side_effects: []
  evidence:
    key_log_entries:
      - "token-validator.js:42 → SDD-DBG-G005: ERROR: Cannot read property 'token' of null"
      - "redis-client.js:15 → SDD-DBG-G003: WARN: Connection timed out after 30000ms"
      - "token-validator.js:38 → SDD-DBG-G001: INFO: Validating token for user: abc123"
    forensic_timeline: "Request arrives → Redis timeout (SDD-DBG-G003) → session is null (SDD-DBG-G004) → validator crashes with 500 (SDD-DBG-G005)"
    tdd_results: "Added test: 'should return 401 when session is null' → PASS after fix"
  lessons_learned:
    - "Always check for null session when Redis is involved — timeouts are inevitable in production"
    - "500 errors in auth module are almost always missing null checks, not logic bugs"
  conventions_created:
    - topic_key: "conventions/nodejs/null-session-check"
      description: "All auth middleware must check for null session before accessing session properties"
  tests_suggested:
    - name: "should handle Redis timeout gracefully"
      scenario: "Mock Redis timeout and verify 401 response instead of 500"
      file: "test/auth/token-validator.test.js"
    - name: "should handle null session in all middleware"
      scenario: "Test all auth middleware with null session injection"
      file: "test/auth/middleware.test.js"
  guards_cleaned: 12
  requires_reverify: true
  engram_entries:
    - "sdd-debug/auth-null-session/root-cause"
    - "sdd-debug/auth-null-session/fix-applied"
    - "sdd-debug/auth-null-session/lessons-learned"
    - "conventions/nodejs/null-session-check"
```

## Example: Partial with Cycling History

```yaml
debug_result:
  status: partial
  summary: "Fixed primary issue (null session) after 2 cycles. Secondary race condition requires architecture change — escalated."
  cycle_count: 2
  baseline:
    tests_before: { total: 150, passing: 145, failing: 5 }
    tests_after: { total: 154, passing: 151, failing: 3 }
  root_cause: "Two root causes: (1) null session after Redis timeout, (2) race condition in session refresh"
  issues_resolved:
    - id: 1
      fix_description: "Added null check for user.session"
      files_modified: [src/auth/token-validator.js]
      tests_added: [test/auth/token-validator.test.js]
      confidence: high
  issues_unresolved:
    - id: 2
      reason: "Race condition in session refresh requires redesigning the session lock mechanism — out of sdd-debug scope"
      recommendation: "Create a new sdd change for session lock refactor. See evidence in Engram: sdd-debug/auth-race-condition/forensic-analysis"
  issues_escalated: []
  regressions: []
  side_effects:
    - description: "401 responses are now returned 15ms slower due to null check logic"
      severity: low
  evidence:
    key_log_entries:
      - "token-validator.js:42 → SDD-DBG-G005: ERROR: null session"
      - "session-refresh.js:28 → SDD-DBG-G011: STATE: concurrent refresh detected"
    forensic_timeline: "Cycle 1: identified null session, fixed, but race condition remained. Cycle 2: confirmed race condition is architectural."
    tdd_results: "Null session test: PASS. Race condition test: FAIL (expected — architectural issue)"
  lessons_learned:
    - "Null checks and race conditions often co-occur in session management — always investigate both"
    - "Race conditions cannot be reliably fixed with point changes — they need architectural solutions"
  conventions_created: []
  tests_suggested:
    - name: "should detect concurrent session refresh"
      scenario: "Simulate two concurrent session refreshes and verify no data corruption"
      file: "test/auth/session-refresh.test.js"
  guards_cleaned: 18
  requires_reverify: true
  engram_entries:
    - "sdd-debug/auth-null-session/root-cause"
    - "sdd-debug/auth-null-session/fix-applied"
    - "sdd-debug/auth-null-session/lessons-learned"
```
