---
name: archive-debug
phase_order: 7
description: Archives the complete debug session to memory (Engram or file-based) FIRST, then generates the standardized debug_result output for the calling SDD workflow.
---

## Intent

Persist the debug session knowledge before it is lost, then generate the structured output that the calling SDD workflow needs to continue. The archive step is not optional — it is how the organization learns from debugging and avoids repeating the same root causes. Memory comes before output.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| debug-archiver | Fixed | 1 | Session persistence and output generation specialist |

Mono-agent variant: single debug-archiver, no judge, no radar.

## Execution Mode
`sequential` — depends on `validate-fix` output; archives only after validation is complete.

## Input Contract

Receives from `validate-fix`:
- Validation report (status, regressions, confidence)
- Issue resolution status table
- Test suite comparison

Also receives all prior phase outputs:
- Impact maps (from explore-issues)
- Triage report (from triage)
- Diagnosis report (from diagnose)
- Fix proposals (from propose-fix)
- Implementation reports and diffs (from apply-fix)

## Output Contract

Produces two outputs:

**1. Memory persistence** (Engram or file-based, created BEFORE debug_result):
- Decisions recorded for each fixed issue
- Session checkpoint with full summary
- Lessons learned stored for future reference

**2. `debug_result`** (standardized YAML output for calling SDD):
- `status`: resolved | partial | failed | escalated
- `summary`: human-readable one-liner
- `persistence_status`: saved | failed | partial
- `issues_resolved`: list with root cause, fix, tests added, confidence
- `issues_unresolved`: list with reason and recommendation
- `issues_escalated`: list with reason
- `regressions`: detected flag, count, details
- `requires_reverify`: true/false
- `reverify_reason`: why re-verification is needed (if applicable)
- `lessons_learned`: non-obvious findings for future reference
- `test_baseline_delta`: before/after/added/delta

## Skills

- Engram memory persistence (`record_decision`, `record_change`, `checkpoint`)
- File-based fallback persistence
- Structured debug_result generation
- Session summarization and lessons synthesis

## Hard Constraints

- **PERSIST FIRST**: never generate debug_result before persistence is attempted
- **HONEST STATUS**: `status: "resolved"` only if ALL issues resolved with zero regressions
- **NO SILENT DROPS**: unresolved and escalated issues MUST appear in debug_result
- **PERSISTENCE FAILURE VISIBLE**: if Engram write fails, report it in `persistence_status`
- **REQUIRES_REVERIFY ACCURACY**: must be true if new production code was added or side effects were detected
- **LESSONS REQUIRED**: at least one lesson_learned entry per debugging session

## Success Criteria

- Memory was persisted before debug_result was generated
- `persistence_status` accurately reflects whether the save succeeded
- `status` reflects the actual validation outcome (not optimistic)
- All resolved, unresolved, and escalated issues are accounted for
- `requires_reverify` is set correctly (true if new code was written)
- `lessons_learned` contains at least one actionable finding
- The calling SDD can act on `debug_result` without reading any prior phase output
