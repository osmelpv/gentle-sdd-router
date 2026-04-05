---
name: finalize
phase_order: 5
description: "STRATEGIC — Orchestrator handles this directly. Re-executes scenario to verify fix. If NOT fixed: cycles back to collect-and-diagnose with new evidence. If FIXED: cleans ALL guards, delivers final report, suggests tests, records lessons in Engram."
---

## Composition
| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| orchestrator | Fixed | 1 | Handles directly — makes loop/close decision, cleans guards, records lessons |

## Execution Mode
Default: `sequential` — Orchestrator handles this directly. NOT delegated to sub-agent.

## Delegation
`orchestrator` — This phase is **NOT** delegated. The orchestrator MUST handle this directly because:
- The loop/close decision requires strategic judgment
- Guard cleanup requires access to the full Guard Position Registry
- Engram archival requires the orchestrator's full session context
- Final report delivery is a direct user interaction

## Dependencies
- `apply-fixes` — Requires the regression report and fix status.

## Loop Target
`collect-and-diagnose` — If the fix is NOT verified, flow returns to collect-and-diagnose for another cycle.

## Enriched Context (from Engram)

The orchestrator MUST load ALL artifacts for complete evaluation:

```
From Engram (parallel retrieval — ALL phases):
├── engram_memory(action: "search", query: "sdd-debug/{issue}/area-analysis")
│   └── Full area analysis report
├── engram_memory(action: "search", query: "sdd-debug/{issue}/guard-registry")
│   └── All guard positions (for cleanup)
├── engram_memory(action: "search", query: "sdd-debug/{issue}/forensic-analysis")
│   └── Forensic timeline and evidence
├── engram_memory(action: "search", query: "sdd-debug/{issue}/proposed-solutions")
│   └── What was proposed and approved
├── engram_memory(action: "search", query: "sdd-debug/{issue}/apply-progress")
│   └── What was changed
└── engram_memory(action: "search", query: "sdd-debug/{issue}/regression-report")
    └── Fix status, regression data, confidence
```

## Verification Protocol

### Step 1: Re-Execute Scenario

Re-run the original failing scenario to verify the fix actually works:

```
Verification approaches (same AI-first priority as collect-and-diagnose):
├── Level 1: Run tests — the RED test from apply-fixes MUST be GREEN
├── Level 2: Run the reproduction script from collect-and-diagnose
├── Level 3: Ask user to verify (LAST RESORT — provide exact steps)
```

### Step 2: Loop Decision

```
Decision tree:
├── IF fix IS verified (tests pass, scenario works):
│   ├── Proceed to Guard Cleanup (Step 3)
│   ├── Proceed to Final Report (Step 4)
│   ├── Proceed to Engram Archival (Step 5)
│   └── Proceed to Test Suggestions (Step 6)
│
├── IF fix is NOT verified (tests still fail, scenario still broken):
│   ├── Increment cycle_count
│   ├── Record what went wrong in this cycle
│   ├── Add new evidence to enriched_context
│   ├── Return to collect-and-diagnose via loop_target
│   └── The new cycle gets: previous forensic data + what failed this time
│
└── IF max cycles reached (cycle_count > 3):
    ├── Do NOT loop again
    ├── Proceed to Guard Cleanup (Step 3) — clean up even on failure
    ├── Set status: escalated
    └── Report: "Unable to resolve after N cycles. Escalating."
```

## Step 3: Guard Cleanup

**MANDATORY** — ALL SDD-DBG-GXXX markers MUST be removed from the codebase, regardless of fix outcome.

### Cleanup Procedure

```
Guard Cleanup Protocol:
1. Load Guard Position Registry from Engram
2. For EACH entry in the registry:
   ├── IF action == "inserted":
   │   └── DELETE the entire line containing the SDD-DBG-GXXX marker
   ├── IF action == "modified":
   │   └── RESTORE the line to original_content
   └── Mark entry as cleaned in local tracking
3. VERIFICATION: grep -rn "SDD-DBG-G" across the codebase
   ├── MUST find ZERO matches
   └── If matches found: report as orphaned guards
4. COUNT CHECK: guards_cleaned MUST equal registry total_guards
   ├── If match: cleanup successful
   └── If mismatch: report error with details of missing/orphaned guards
```

### Cleanup Hard Constraints

1. **Clean ALL guards** — not just the ones related to the fix. ALL SDD-DBG-GXXX markers.
2. **Verify with grep** — do not trust the registry alone. Grep the codebase as final verification.
3. **Count MUST match** — `guards_cleaned` == `guard_registry.total_guards`. Any mismatch is an error.
4. **Clean even on failure** — if the debug session fails or escalates, STILL clean all guards.
5. **Do NOT leave temporary test files** — if TDD tests were created ONLY for guard testing (not for the fix itself), remove them.

## Step 4: Final Report to User

Deliver a comprehensive final report:

```
Final Debug Report:
├── Status: resolved | partial | failed | escalated
├── Summary: "1-2 sentence human-readable summary"
├── Cycle Count: N (how many times the debug loop ran)
├── Root Cause: "What actually caused the problem"
├── Fix Applied:
│   ├── Description: "What was changed"
│   ├── Files Modified: [list]
│   └── Tests Added: [list]
├── Evidence:
│   ├── Key Log Entries: ["file:line → log output"]
│   ├── Forensic Timeline: "Summary of execution path"
│   └── TDD Results: "Test results summary"
├── Regressions: [list] or "None"
├── Side Effects: [list] or "None"
├── Guards Cleaned: N
└── Requires Re-verify: true | false
```

## Step 5: Engram Archival

Record the debug session for future reference:

```
Engram entries to create (4 topic_keys):

1. Root Cause:
   engram_memory(action: "record_observation",
     content: "<root cause with evidence>",
     category: "finding",
     tags: ["sdd-debug/{issue}/root-cause"])

2. Fix Applied:
   engram_memory(action: "record_decision",
     decision: "Fixed {issue}: {root cause summary}",
     rationale: "{why this fix was chosen}",
     affected_files: [list],
     tags: ["sdd-debug/{issue}/fix-applied"])

3. Lessons Learned:
   engram_memory(action: "record_observation",
     content: "<lessons from this debug session>",
     category: "pattern",
     tags: ["sdd-debug/{issue}/lessons-learned"])

4. Conventions (if new patterns discovered):
   engram_memory(action: "add_convention",
     rule: "<new convention>",
     category: "conventions/{ecosystem}/{pattern}",
     examples: ["<code example>"])
```

## Step 6: Test Suggestions

Suggest additional tests to prevent this bug from returning:

```yaml
tests_suggested:
  - name: "should handle <edge case>"
    scenario: "What this test verifies"
    file: "path/to/test/file.ext"
    priority: high | medium | low
  - name: "should not regress on <related behavior>"
    scenario: "Regression guard for related code"
    file: "path/to/test/file.ext"
    priority: medium
```

Test suggestion rules:
1. Each suggestion MUST have a specific name and scenario — not vague "add more tests"
2. Suggest tests for RELATED edge cases discovered during investigation
3. Suggest regression tests for code paths near the fix
4. Do NOT suggest tests that already exist

## Phase Output
- **If cycling**: recovered logs and failure analysis for the next collect-and-diagnose iteration
- **If resolved/escalated**:
  - Final debug report delivered to user
  - All guards cleaned (verified by grep)
  - Engram entries created (root-cause, fix-applied, lessons-learned, conventions)
  - Test suggestions provided
  - `debug_result` output conforming to output-contract.md

## Engram Persistence
- **Final Report**:
  - Topic Key: `sdd-debug/{issue}/final-report`
  - Type: `architecture`
  - Content: Complete final debug report

## Return to Orchestrator
```yaml
# If cycling back:
status: cycling
executive_summary: "Fix not verified. Cycling back to collect-and-diagnose."
cycle_count: N
loop_to: collect-and-diagnose
new_evidence: "<what was learned this cycle>"

# If resolved:
status: resolved
executive_summary: "Fix verified. All guards cleaned. Session archived."
cycle_count: N
guards_cleaned: N
engram_entries: [list of topic_keys]
requires_reverify: true
debug_result: { ... }  # Full output per output-contract.md
```
