---
name: explore
phase_order: 2
description: Investigates the codebase, maps affected areas, compares approaches.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 2+ | Different providers recommended for diversity |
| judge | Optional | 1 | Reasoning model required. Synthesizes agent findings. |
| radar | Optional | 1 | Scans for blind spots independently. |
| risk-detector | Optional | 1 | Identifies potential risks early. |
| security-auditor | Optional | 1 | Security scan of affected areas. |

## Execution Mode
Default: `parallel` — All agents and radar work simultaneously. Judge synthesizes after.

## Judge Decision Contract
"Synthesize explorations. Fuse unique findings from each agent. Discard redundancy. Incorporate radar findings for completeness. Use anonymous brainstorming if agents diverge on affected areas."

## Phase Input
- User's change description or issue
- Codebase access
- Previous session context from Engram

## Phase Output
- Affected areas map
- Approach comparison (if multiple approaches found)
- Risk assessment (if risk-detector present)
- Security notes (if security-auditor present)
