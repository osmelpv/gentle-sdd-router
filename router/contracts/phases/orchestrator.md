<!--
AI-GUIDE: orchestrator phase
──────────────────────────────
When creating or configuring the orchestrator, know:

1. COORDINATION RESPONSIBILITIES:
   - Route tasks to appropriate phases
   - Manage context between phases (store in Engram)
   - Delegate to sub-agents when needed
   - Handle cross-SDD invocations

2. CONTEXT MANAGEMENT:
   - Store phase outputs in Engram with phase keys
   - Retrieve previous context before delegating
   - Pass relevant context to each phase via skills/AGENTS.md

3. MODEL REQUIREMENTS:
   - High reasoning capability for orchestration decisions
   - Large context window (200K+)
   - Recommended: Claude Opus, GPT-5 Pro, Gemini Ultra

4. CROSS-SDD INVOCATION:
   - Use gsr sdd invoke for cross-SDD calls
   - gsr writes the record, host executes
   - Check invoke triggers: on_issues, always, never, manual

5. OUTPUT DELIVERABLES:
   - Delegation plan for each phase
   - Phase routing decisions
   - Context handoff packages
-->

---
name: orchestrator
phase_order: 1
description: Coordinates the SDD pipeline. Routes tasks, manages context, delegates to sub-agents.
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | Reasoning model recommended for orchestration decisions. |
| judge | Optional | 1 | Validates delegation decisions and context management. |
| radar | Optional | 1 | Monitors for coordination blind spots. |

## Execution Mode
Default: `sequential` — Single orchestrator agent drives the pipeline.

## Judge Decision Contract
"Validate delegation decisions and context management."

## Phase Input
- User's change description or issue
- SDD context from previous sessions (Engram)
- Project skills and conventions

## Phase Output
- Delegation plan for sub-agents
- Phase routing decisions
- Context handoff packages for each phase
