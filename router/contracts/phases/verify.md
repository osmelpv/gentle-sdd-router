<!--
AI-GUIDE: verify phase
───────────────────────
When creating or configuring verification, ask:

1. WHAT TO VERIFY:
   - List all acceptance criteria from the spec phase
   - List all failing tests from the tasks phase
   - List all security/risk requirements

2. VERIFICATION APPROACH:
   - 2+ agents for independent verification
   - Compare results to detect false positives
   - Judge synthesizes and decides pass/fail

3. CONFIDENCE LEVELS:
   - HIGH: 2+ agents agree on pass
   - MEDIUM: Agents agree on pass but note different gaps
   - LOW: Agents diverge on pass/fail → escalate to user

4. WHEN ISSUES FOUND:
   - Check active preset's `debug_invoke.preset` (sdd-debug-mono or sdd-debug-multi)
   - Use gsr sdd invoke for cross-SDD debugging
   - Only invoke if `required_fields` are present in payload

5. RE-VERIFY LOOP:
   - After sdd-debug completes, verify runs again
   - Max 2 cycles before escalation to orchestrator
   - Infinite loops are PROHIBITED
-->

---
name: verify
phase_order: 8
description: Validates implementation against spec. Runs tests. Reports gaps.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 2+ | Independent verification for higher confidence. |
| judge | Optional | 1 | Synthesizes verification findings. Decides pass/fail. |
| radar | Optional | 1 | Scans for gaps the verification agents might miss. |
| risk-detector | Optional | 1 | Final risk sweep before archive. |
| security-auditor | Optional | 1 | Final security audit before archive. |

## Execution Mode
Default: `parallel` — Multiple verification agents work simultaneously. Judge adjudicates.

## Judge Decision Contract
"Confirmed if 2+ agents agree on pass. Suspect if only 1 finds issues. Escalate contradictions. CRITICAL radar findings block archive."

## Confidence Rules

- HIGH: 2+ agents agree on the same outcome
- MEDIUM: Agents agree on outcome but note different gaps
- LOW: Agents diverge on pass/fail — escalate to user

## Phase Input
- Apply phase output (implementation, updated task checklist)
- Spec requirements (acceptance criteria)
- Failing tests from tasks phase (must now pass)

## Phase Output
- Verification report: pass/fail per spec requirement
- Test run results
- Gap list (spec requirements not met)
- Security/risk findings (if auditors present)
- Recommendation: proceed to archive OR invoke sdd-debug

## sdd-debug Invocation

### Selecting the sdd-debug Variant
Read the active preset's `debug_invoke.preset` field to determine which sdd-debug variant to use.
Do NOT hardcode `sdd-debug-mono` or `sdd-debug-multi` — use the configured value:

```
active_preset.debug_invoke.preset  →  "sdd-debug-mono" | "sdd-debug-multi"
```

### When Issues Found
If verify finds failing tests, spec gaps, or security/risk findings, consult the active preset's
`debug_invoke` block to determine whether invocation is required (trigger, required_fields).
When invocation is warranted, use the cross-catalog mechanism:

```
gsr sdd invoke sdd-debug/<debug_invoke.preset> --from <caller> --phase verify --payload "<issues JSON>"
```

The `--payload` carries the verify output (issues array, affected_files, last_change_files,
test_baseline) as JSON. Only invoke if all `required_fields` are present in the payload.

### When No Issues Found
If verify finds NO issues (all spec requirements met, all tests passing, no security flags),
proceed directly to `archive` — do NOT invoke sdd-debug.

## Re-Verify Loop

After `sdd-debug` returns its `debug_result`:

1. If `debug_result.requires_reverify = true` → verify runs AGAIN on the modified codebase
2. The re-verify cycle uses the same composition and criteria as the original verify pass

### Re-Verify Outcomes
- **Clean pass** → proceed to `archive` normally
- **New issues introduced by the fix** → judge evaluates the delta:
  - `revert` — if the fix introduced more problems than it solved
  - `escalate` — if the issue exceeds the current change scope
  - `retry` — if a narrow targeted fix could work (judge must specify the scope)

### Escalation Guard
After 2 full sdd-debug + re-verify cycles without resolution, verify MUST escalate to the
orchestrator with a full report. Infinite retry loops are PROHIBITED.
