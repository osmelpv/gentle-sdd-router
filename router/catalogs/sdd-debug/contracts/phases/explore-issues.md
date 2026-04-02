---
name: explore-issues
phase_order: 1
description: Investigates ALL code related to reported issues. Maps dependencies, call chains, test coverage, and side-effect risks. Read-only phase.
---

## Intent

Produce a complete impact map for every reported issue before any diagnostic or fix work begins. This phase is READ-ONLY. Nothing is changed. Nothing is proposed. The goal is accurate, evidence-based mapping.

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| explorer | Fixed | 1 | Read-only code investigator |

Mono-agent variant: single explorer, no judge, no radar. Multi-agent variant overrides this via preset.

## Execution Mode
`parallel` — the explorer maps all issues simultaneously, grouping them by shared code paths.

## Input Contract

Receives `debug_request` containing:
- `issues`: list of issue descriptions (from verify phase output)
- `affected_files`: files flagged by the verify phase
- `last_change_files`: files actually modified in the current change
- `test_baseline`: test count and pass/fail state before the change

## Output Contract

For each reported issue, produces an **Impact Map** containing:
- Observable symptoms (with confidence levels)
- Affected files table (file, role, how affected)
- Call chain from entry point to defect location
- Reverse dependencies (what imports the affected code)
- Test coverage table (which tests exercise the affected code)
- Blast radius assessment (HIGH / MEDIUM / LOW)
- Pre-existing failures flagged separately

## Skills

- Code reading and static analysis
- Import/dependency graph traversal
- Test coverage mapping
- Pattern recognition for coupling

## Hard Constraints

- **READ-ONLY**: no file modifications of any kind
- **NO SOLUTIONS**: do not propose fixes, workarounds, or hints
- **NO ASSUMPTIONS**: every finding must be traced to actual code
- **SEPARATE MAPS**: one impact map per issue — never merge findings across issues
- If a file is inaccessible, report it as a gap — do not skip silently

## Success Criteria

- Every reported issue has a complete impact map
- All affected files are identified (direct + reverse dependencies)
- All tests covering the affected code are listed (passing and failing)
- Blast radius is assessed for each issue
- Pre-existing failures are clearly separated from new failures
- No solutions, hints, or proposals appear anywhere in the output
