---
name: collect-and-diagnose
phase_order: 3
description: "THE CRIME SCENE. Orchestrator handles this directly — NOT delegated. Determines execution path using AI-first protocol, collects ALL logs, builds complete forensic timeline, and proposes solutions addressing root cause. Checkpoint gate before apply-fixes."
---

## Composition
| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| orchestrator | Fixed | 1 | Handles directly — the orchestrator MUST experience the crime scene firsthand |

## Execution Mode
Default: `sequential` — Orchestrator handles this directly.

## Delegation
`orchestrator` — This phase is **NOT** delegated to a sub-agent. The orchestrator MUST handle this directly. The crime scene investigation requires the orchestrator's full context, judgment, and ability to make strategic decisions about execution paths and proposed solutions.

### Why Not Delegated
- The orchestrator has the FULL context of the debug request, user history, and prior decisions
- Evidence collection requires adaptive judgment — not a mechanical task
- The checkpoint gate at the end requires direct user interaction
- Proposed solutions must be evaluated against the orchestrator's understanding of the system
- A sub-agent would lose the strategic context needed for accurate diagnosis

## Dependencies
- `implant-logs` — Requires the Guard Position Registry and implanted guards.

## Enriched Context (from Engram)

The orchestrator MUST load these artifacts before starting:

```
From Engram (parallel retrieval):
├── engram_memory(action: "search", query: "sdd-debug/{issue}/area-analysis")
│   └── Fields needed: testability_assessment, risk_zones, dependency_graph, ecosystem_map
├── engram_memory(action: "search", query: "sdd-debug/{issue}/guard-registry")
│   └── Fields needed: all_positions, log_types, tdd_tests
└── If cycling (cycle > 1):
    └── engram_memory(action: "search", query: "sdd-debug/{issue}/forensic-analysis")
        └── Previous forensic data to avoid repeating failed approaches
```

## AI-First Execution Protocol

**This is the CORE behavioral contract for this phase.** The orchestrator MUST follow this priority chain to determine HOW to collect evidence. Asking the user is the LAST RESORT.

```
Level 1 (MANDATORY FIRST — Autonomous):
├── Run existing tests → capture output, identify which fail and why
├── Run TDD tests created in implant-logs → capture results
├── Use bash/shell to execute scripts that trigger the scenario
├── Use browser MCP (if web-related) to reproduce the behavior
├── Use platform tools (docker, kubectl, aws cli, etc.) if applicable
├── Create minimal mock scripts that isolate the problem
└── Analyze logs from guards directly (file read, grep)

Level 2 (Synthetic Reproduction):
├── Write a minimal reproduction script that triggers the exact scenario
├── Create a test harness that exercises the failing code path
├── Use environment manipulation (env vars, config changes) to trigger edge cases
└── Simulate external dependencies with stubs/mocks

Level 3 (LAST RESORT — User Assistance):
├── Provide the user with CONCRETE, MINIMAL steps to reproduce
│   ├── Exact commands to run
│   ├── Exact inputs to provide
│   ├── Exact output to capture and return
│   └── Estimated time: < 2 minutes of user effort
├── Explain which autonomous approaches were tried
├── Explain WHY they failed
└── Ask for SPECIFIC information, never vague requests

Re-evaluation Clause:
├── IF the user demonstrates that an autonomous approach WOULD have worked:
│   ├── Acknowledge the oversight explicitly
│   ├── Record it as a convention in Engram:
│   │   topic_key: "conventions/{ecosystem}/debug-automation/{pattern}"
│   ├── Attempt the autonomous approach retroactively
│   └── Update the forensic timeline with the new evidence
└── This clause exists because AI capabilities evolve — always re-evaluate assumptions
```

### AI-First Enforcement Rules

1. **NEVER ask the user to reproduce something you can reproduce autonomously**
2. **NEVER ask "can you run X?" if you have bash access** — just run it
3. **NEVER ask for logs if you can read the log files directly**
4. **ALWAYS attempt Level 1 before considering Level 2**
5. **ALWAYS attempt Level 2 before considering Level 3**
6. **ALWAYS explain what you tried when falling back to the next level**
7. If a Level 1 approach partially works — build on it instead of jumping to Level 2

## Evidence Collection

### What to Collect

```
Collect ALL of the following (not just the first error):
├── Full log output from ALL guards (every SDD-DBG-GXXX marker)
├── Test results from ALL tests (not just failing ones)
├── Stack traces (complete, not truncated)
├── State snapshots at decision points
├── Timing data from timing guards
├── Error messages and error chains (root cause, not just surface error)
├── Environment state at time of failure
└── Output from TDD tests created in implant-logs
```

### Forensic Timeline Construction

Build a complete timeline of execution:

```
Forensic Timeline Format:
[timestamp] [SDD-DBG-GXXX] [type] [file:line] → description
───────────────────────────────────────────────────────────
[T+0ms]     SDD-DBG-G001   entry  auth/validator.js:10 → validateToken(user="abc123")
[T+2ms]     SDD-DBG-G002   state  auth/validator.js:15 → session lookup: cache=miss
[T+35ms]    SDD-DBG-G003   error  auth/validator.js:22 → Redis timeout after 30ms
[T+35ms]    SDD-DBG-G004   state  auth/validator.js:25 → session=null (unexpected)
[T+36ms]    SDD-DBG-G005   error  auth/validator.js:42 → TypeError: Cannot read 'token' of null
[T+36ms]    SDD-DBG-G006   exit   auth/validator.js:50 → threw: TypeError

Root Cause Chain:
  Redis timeout → null session → unguarded property access → 500 error
  ROOT CAUSE: Missing null check on session after Redis timeout
```

## Proposed Solutions

After evidence collection and forensic analysis, propose solutions:

```
Solution Proposal Format:
├── Root Cause: "<specific, evidence-backed root cause>"
├── Proposed Fix:
│   ├── Description: "<what to change>"
│   ├── Files to Touch: [list of files]
│   ├── Estimated Lines Changed: N
│   ├── Risk Assessment: low | medium | high
│   └── Rationale: "<why this fix addresses the root cause>"
├── Alternative Fixes (if any):
│   └── [list with tradeoffs]
├── Tests to Add:
│   └── [list of tests that would catch this in the future]
└── Confidence: high | medium | low
    └── Justification: "<what evidence supports this confidence>"
```

## Checkpoint Gate

**MANDATORY** — Before advancing to apply-fixes, the orchestrator MUST present the forensic report to the user.

### What to Show

```yaml
checkpoint:
  before_next: true
  show_user:
    - forensic_report     # Complete timeline with evidence
    - proposed_changes    # What will be changed and why
    - files_to_touch      # Which files will be modified
    - root_cause_analysis # The diagnosed root cause with evidence chain
```

### User Actions

| Action | Behavior |
|--------|----------|
| `approve` | Proceed to apply-fixes with the proposed solution |
| `question` | Answer the user's question, then re-present the checkpoint |
| `contradict` | Loop back to the beginning of collect-and-diagnose. The user's input is added to the enriched context for the next iteration. `on_contradict: loop_self` |

### Checkpoint Rules

1. **NEVER advance to apply-fixes without user approval**
2. Present information CLEARLY — the user must understand what will change
3. If the user questions: answer thoroughly, then re-present the same checkpoint
4. If the user contradicts: DO NOT argue. Incorporate their context and re-analyze
5. If the user provides new evidence: add it to the forensic timeline and re-diagnose

## Phase Output
- **Complete log dump** — all SDD-DBG-GXXX output collected
- **Forensic timeline** — ordered execution trace with root cause chain
- **Error chain** — complete error propagation path
- **TDD results** — test results from tests created in implant-logs
- **Proposed solutions** — with root cause analysis, files to touch, risk assessment
- **Checkpoint status** — user approved / questioned / contradicted

## Engram Persistence
- **Forensic Analysis**:
  - Topic Key: `sdd-debug/{issue}/forensic-analysis`
  - Type: `architecture`
  - Content: Full forensic timeline, evidence collected, root cause chain
- **Proposed Solutions**:
  - Topic Key: `sdd-debug/{issue}/proposed-solutions`
  - Type: `architecture`
  - Content: Proposed fix, alternatives, confidence, files to touch
- **Persist calls**:
  ```
  engram_memory(action: "record_observation", content: "<forensic>", category: "finding",
    tags: ["sdd-debug/{issue}/forensic-analysis"])
  engram_memory(action: "record_observation", content: "<solutions>", category: "finding",
    tags: ["sdd-debug/{issue}/proposed-solutions"])
  ```

## Return to Orchestrator
```yaml
status: approved | looping | blocked
executive_summary: "1-2 sentence summary of findings and user decision"
artifacts:
  - "sdd-debug/{issue}/forensic-analysis"
  - "sdd-debug/{issue}/proposed-solutions"
next_recommended: apply-fixes  # or collect-and-diagnose if looping
root_cause: "<one-line root cause>"
files_to_touch: [list]
user_decision: approve | question | contradict
confidence: high | medium | low
```
