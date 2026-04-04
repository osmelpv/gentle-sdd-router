<!--
AI-GUIDE: explore phase
─────────────────────────
When creating a new phase or SDD that involves exploration, ask:

1. WHAT AREAS? What parts of the codebase will be affected?
   - List specific files, modules, or directories
   - Identify dependencies and side effects

2. CONTEXT NEEDED:
   - Previous exploration results (from Engram)
   - Project skills for codebase navigation
   - AGENTS.md inherited context

3. OUTPUT STRUCTURE:
   - Affected areas map
   - Approach comparison (if multiple paths exist)
   - Risk assessment
   - Security notes (if applicable)

4. AGENTS & ROLES:
   - 2+ agents for diverse perspectives (different providers)
   - Optional judge for synthesis
   - Optional radar for blind spots
   - Optional security-auditor for security scan
-->

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
