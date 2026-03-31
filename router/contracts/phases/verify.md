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
- Recommendation: proceed to archive OR trigger debug
