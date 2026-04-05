# sdd-debug Guide

## 1. Overview

`sdd-debug` is the unified debug system for SDD workflows. It handles scenarios where **TDD alone cannot solve the problem** — when a bug resists test-driven isolation and requires forensic investigation with log guards, evidence collection, and iterative fix verification.

It consolidates the old `sdd-debug` v1 (7 phases, reactive) and `sdd-debug-by-logs` (draft) into a single 5-phase catalog with clear separation between **strategic work** (retained by the orchestrator) and **mechanical work** (delegated to sub-agents).

Key principles:
- **AI-First**: The system tries to reproduce and diagnose autonomously before asking the user for help.
- **Evidence-Driven**: Every fix must be backed by forensic evidence from log guards.
- **Non-Destructive**: All log guards are cleaned up after the bug is resolved.
- **Iterative**: If the fix doesn't work, the system loops back with new evidence — up to a max cycle count.

---

## 2. Process Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          sdd-debug v2 (5 Phases)                         │
│                                                                          │
│  ┌─────────────────────────┐    ┌──────────────────────────┐            │
│  │ Phase 1: analyze-area   │    │ Phase 2: implant-logs    │            │
│  │   [SUB-AGENT]           │───▶│   [SUB-AGENT]            │            │
│  │                         │    │                          │            │
│  │ - Map ecosystem         │    │ - Plant log guards at    │            │
│  │   (lang, runtime, deps) │    │   every execution point  │            │
│  │ - Select logging system │    │ - Create TDD tests where │            │
│  │ - Classify: TDD-testable│    │   scenario is testable   │            │
│  │   vs needs log guards   │    │ - Build Guard Position   │            │
│  │ - Produce Area Analysis │    │   Registry (SDD-DBG-GXXX │            │
│  │   Report                │    │   markers for cleanup)   │            │
│  └─────────────────────────┘    └────────────┬─────────────┘            │
│                                               │                          │
│                  ┌────────────────────────────▼────────────────────┐     │
│                  │ Phase 3: collect-and-diagnose                   │     │
│            ┌────▶│   [ORCHESTRATOR — THE CRIME SCENE]             │     │
│            │     │                                                │     │
│            │     │ AI-First Execution Priority:                   │     │
│            │     │   1. Autonomous: tests, mocks, MCP, bash       │     │
│            │     │   2. Synthetic: construct reproduction          │     │
│            │     │   3. User: LAST RESORT (concrete steps only)   │     │
│            │     │                                                │     │
│            │     │ - Execute scenario (AI-first)                  │     │
│            │     │ - Collect ALL logs (not just first error)      │     │
│            │     │ - Build forensic timeline from guard output    │     │
│            │     │ - Identify root cause with evidence            │     │
│            │     │ - Propose solution(s)                          │     │
│            │     └────────────────────┬───────────────────────────┘     │
│            │                          │                                  │
│            │              ┌───────────▼────────────────┐                │
│            │              │  USER CHECKPOINT            │                │
│            │              │                             │                │
│            │              │  Shows: forensic report,    │                │
│            │              │  proposed changes, files    │                │
│            │              │  to touch, root cause       │                │
│            │              │                             │                │
│            │              │  User actions:              │                │
│            │              │  - Approve  -> Phase 4      │                │
│            │              │  - Question -> Answer, re-  │                │
│            │              │               present       │                │
│            │              │  - Contradict -> Phase 3    │                │
│            │              │    (with user's context)    │                │
│            │              └───────────┬────────────────┘                │
│            │                          │ APPROVED                        │
│            │     ┌────────────────────▼───────────────────────────┐     │
│            │     │ Phase 4: apply-fixes                           │     │
│            │     │   [SUB-AGENT]                                  │     │
│            │     │                                                │     │
│            │     │ - Implement approved fix (minimal change)      │     │
│            │     │ - Run FULL regression check (entire suite)     │     │
│            │     │ - Produce regression report (before/after)     │     │
│            │     └────────────────────┬───────────────────────────┘     │
│            │                          │                                  │
│            │     ┌────────────────────▼───────────────────────────┐     │
│  NOT FIXED │     │ Phase 5: finalize                              │     │
│  (+ new    │     │   [ORCHESTRATOR — THE VERDICT]                │     │
│   evidence)│     │                                                │     │
│            │     │ - Re-execute original scenario                 │     │
│            │     │ - Evaluate: FIXED or NOT FIXED?                │     │
│            │     │                                                │     │
│            │     │ If NOT FIXED:                                  │     │
│            └─────│   -> Loop to Phase 3 (with new log evidence)  │     │
│                  │   -> Increment cycle_count                     │     │
│                  │                                                │     │
│                  │ If FIXED:                                      │     │
│                  │   -> Clean ALL SDD-DBG-GXXX guards             │     │
│                  │   -> Verify guards_cleaned == registry count   │     │
│                  │   -> Deliver final report to user              │     │
│                  │   -> Suggest additional tests                  │     │
│                  │   -> Save lessons to Engram                    │     │
│                  └────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────┘

Phase Delegation Summary:
  Phase 1  analyze-area         -> sub-agent
  Phase 2  implant-logs         -> sub-agent
  Phase 3  collect-and-diagnose -> ORCHESTRATOR (strategic: crime scene)
  Phase 4  apply-fixes          -> sub-agent
  Phase 5  finalize             -> ORCHESTRATOR (strategic: verdict + loop)
```

---

## 3. How to Launch

### Manual Launch

Invoke sdd-debug directly from a conversation:

```
/sdd-debug <issue-description>
```

Or via the GSR CLI:

```bash
gsr sdd invoke sdd-debug/sdd-debug-mono --payload '{
  "issues": ["Test X fails with null reference"],
  "affected_files": ["src/auth/validator.js"],
  "error_messages": ["Cannot read property token of null"],
  "environment": "node 22, vitest"
}'
```

The router resolves the preset (e.g., `sdd-debug-mono`) and returns the routing table. The host (gentle-ai, OpenCode, etc.) reads the contracts and orchestrates execution.

### Automatic Launch (from verify)

When the `verify` phase finds issues (failing tests, spec gaps, regressions), it can automatically invoke `sdd-debug` via the `debug_invoke` block in the active preset:

```yaml
# In any standard preset (e.g., local-hybrid.router.yaml)
debug_invoke:
  preset: sdd-debug-mono       # Which sdd-debug preset to use
  trigger: on_issues            # When to invoke (see Trigger Modes)
  input_from: verify_output     # Source of input data
  required_fields:
    - issues                    # What verify found wrong
    - affected_files            # Files involved
    - last_change_files         # Files changed in the last apply
    - test_baseline             # Test counts before debug
```

The flow is: `verify detects issues` -> `reads debug_invoke from active preset` -> `invokes sdd-debug with verify output` -> `sdd-debug runs its 5 phases` -> `returns debug_result` -> `verify re-runs if requires_reverify: true`.

Maximum 2 full `debug + re-verify` cycles. After 2 cycles without resolution, verify escalates.

### Custom SDD Integration

If you're creating your own SDD catalog, you can wire `sdd-debug` into your verify phase:

1. Add the `debug_invoke` block to your preset YAML:

```yaml
# my-custom-preset.router.yaml
debug_invoke:
  preset: sdd-debug-mono    # or sdd-debug-multi
  trigger: on_issues         # see Trigger Modes below
  input_from: verify_output
  required_fields:
    - issues
    - affected_files
    - last_change_files
    - test_baseline
```

2. In your verify phase contract, reference the `debug_invoke` config from the active preset. The host reads the preset, resolves the sdd-debug routing, and launches the debug workflow.

3. Handle the `debug_result` output — check `requires_reverify` and `status` to decide next steps.

---

## 4. Configuration

### Preset Selection

| Preset | Agents per Phase | Use Case |
|--------|-----------------|----------|
| `sdd-debug-mono` | 1 per phase | Default. Fast, cost-effective. GPT-5.4 primary with fallbacks. |
| `sdd-debug-multi` | 1-2 per phase | Cross-provider verification. Primary + secondary/judge on critical phases. |

Both presets define 4 entries: `orchestrator` (covers Phase 3 + 5), `analyze-area`, `implant-logs`, `apply-fixes`.

### Model Override

Change the primary model by editing the preset YAML. For example, to use Claude Opus as primary in `sdd-debug-mono`:

```yaml
# router/profiles/sdd-debug-mono.router.yaml
phases:
  orchestrator:
    - target: anthropic/claude-opus-4-6    # Changed from openai/gpt-5.4
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: openai/gpt-5.4, google/gemini-2.5-pro
```

Each phase can have independent model assignments. The orchestrator entry is the most critical — it handles crime scene investigation and the loop verdict.

### Trigger Modes

Configure when `sdd-debug` is invoked via the `trigger` field in `debug_invoke`:

| Mode | Behavior |
|------|----------|
| `on_issues` | **Default.** Invoke only when verify finds failing tests or spec gaps. |
| `always` | Invoke after every verify, even on success (useful for paranoid mode). |
| `manual` | Only invoke when user explicitly runs `/sdd-debug`. |
| `never` | Disable debug entirely. Used in `safety` preset. |

---

## 5. Guard Position Registry

### What It Is

During Phase 2 (implant-logs), the sub-agent plants **log guards** at every execution point in the problem area. Each guard gets a unique marker in the format `SDD-DBG-GXXX` (e.g., `SDD-DBG-G001`, `SDD-DBG-G012`).

### Why It Exists

Guards are **temporary forensic instruments**. They produce the evidence trail that Phase 3 uses to diagnose the root cause. The registry tracks every guard so that **cleanup is deterministic** — no orphaned debug code left behind.

### Registry Schema

Each entry in the registry contains:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `file` | File path where the guard was placed |
| `line` | Line number |
| `type` | `entry` \| `exit` \| `state` \| `error` \| `timing` |
| `marker` | The `SDD-DBG-GXXX` marker string |
| `original_content` | Original line content (for restoration) |
| `purpose` | Why this guard was placed here |

### Cleanup

During Phase 5 (finalize), when the fix is verified:

1. The orchestrator searches the codebase for all `SDD-DBG-G` markers.
2. For **inserted** lines (new log statements), the entire line is removed.
3. For **modified** lines (added markers to existing code), `original_content` is restored.
4. `guards_cleaned` count is compared against the registry count. **They MUST match.** A mismatch triggers an error report.

---

## 6. AI-First Execution Protocol

In Phase 3 (collect-and-diagnose), the orchestrator follows a strict priority chain for reproducing the scenario:

### Priority 1: Autonomous Execution (AI does everything)

Use any available automated tool:
- Run existing tests that cover the failing scenario
- Create targeted mock tests
- Use MCP tools (browser, terminal, database access)
- Execute bash commands to reproduce the issue
- Use platform-specific debugging tools

### Priority 2: Synthetic Reproduction

If no existing automation covers the scenario:
- Construct a minimal reproduction script
- Create an isolated test that triggers the same code path
- Mock external dependencies to simulate the failure

### Priority 3: User Assistance (LAST RESORT)

Only when autonomous approaches have all been tried and failed:
- Provide the user with **minimal, concrete** reproduction steps (not vague requests)
- Explain **which autonomous approaches were attempted** and why they failed
- Ask for **specific** information (e.g., "run this command and paste the output")

### Re-evaluation Clause

If the user demonstrates that an autonomous approach *would* have worked, the orchestrator:
1. Acknowledges the oversight
2. Records it as a convention in Engram (to avoid repeating the mistake)
3. Attempts the autonomous approach retroactively

---

## 7. Output Contract Reference

Every sdd-debug execution produces a `debug_result` object with these key fields:

| Field | Description |
|-------|-------------|
| `status` | `resolved` \| `partial` \| `failed` \| `escalated` \| `cycling` |
| `cycle_count` | How many collect→apply→finalize loops ran |
| `root_cause` | The actual cause (evidence-backed) |
| `evidence` | Key log entries, forensic timeline, TDD results |
| `guards_cleaned` | Number of guards removed (must match registry) |
| `requires_reverify` | Whether verify should run again |
| `lessons_learned` | Actionable lessons from the debug session |
| `tests_suggested` | Specific tests to prevent recurrence |

For the complete schema, field definitions, hard constraints, and examples, see:
`router/catalogs/sdd-debug/contracts/output-contract.md`
