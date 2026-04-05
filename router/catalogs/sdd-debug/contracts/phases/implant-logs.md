---
name: implant-logs
phase_order: 2
description: Plants log guards at EVERY step of the execution path. Creates TDD tests where testable. Produces complete Guard Position Registry with unique SDD-DBG-GXXX markers for deterministic cleanup.
---

## Composition
| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| log-implanter | Fixed | 1 | Plants logs at every execution point, creates TDD tests, builds guard registry |

## Execution Mode
Default: `sequential` — Single agent implants all guards systematically.

## Delegation
`sub-agent` — This phase is delegated to a sub-agent. The orchestrator does NOT handle this directly.

## Dependencies
- `analyze-area` — Requires the Area Analysis Report, Logging Selection, and TDD Assessment.

## Dynamic Skill Loading
The agent MUST load the ecosystem skill + logging tool skill:

```
Load skills:
1. Ecosystem skill (from area-analysis) → code patterns, file structure
2. Logging tool skill (from logging-selection) → API usage, configuration

Logging tool skills:
├── winston → Transports, formats, levels, child loggers
├── pino → Performance, serializers, pretty-print
├── debug → Namespaces, colors, environment variables
├── console → Native console.log/warn/error with SDD-DBG markers
├── loguru → Sinks, levels, formatting, rotation
├── zap → Fields, levels, sampling, encoding
├── Serilog → Sinks, enrichment, destructuring
├── tracing → Spans, events, layers, subscribers
└── Standard → Generic logging patterns (fallback)
```

## Phase Input
- Area Analysis Report from Engram: `engram_memory(action: "search", query: "sdd-debug/{issue}/area-analysis")`
- Logging System Selection (chosen tool, configuration, format)
- TDD vs Guards Assessment (which areas get tests, which get guards)

## Guard Position Registry

The Guard Position Registry is the CORE artifact of this phase. It enables deterministic cleanup in the finalize phase.

### Registry Schema

```yaml
guard_registry:
  issue: "{issue}"
  created_at: "ISO-8601 timestamp"
  logging_tool: "<selected tool>"
  total_guards: N
  total_tdd_tests: N
  entries:
    - id: "G001"
      file: "src/auth/token-validator.js"
      line: 42
      type: entry          # enum: entry | exit | state | error | timing
      marker: "SDD-DBG-G001"
      action: inserted     # enum: inserted | modified
      original_content: "" # empty for inserted lines, original code for modified
      purpose: "Log entry to validateToken with user ID and token prefix"
    - id: "G002"
      file: "src/auth/token-validator.js"
      line: 58
      type: exit
      marker: "SDD-DBG-G002"
      action: inserted
      original_content: ""
      purpose: "Log exit from validateToken with validation result"
```

### Guard Types

| Type | When to Use | Log Content |
|------|------------|-------------|
| `entry` | Function entry point | Function name, arguments (sanitized), caller |
| `exit` | Function exit point | Return value, execution time |
| `state` | Critical decision point | Variable values, branch taken |
| `error` | Error/exception handler | Error message, stack trace, context |
| `timing` | Performance-sensitive code | Timestamp, duration between points |

### Hard Constraints

1. **Every guard MUST have a unique SDD-DBG-GXXX marker** — sequential numbering (G001, G002, G003, ...). No duplicates allowed.
2. **Every guard MUST appear in the registry** — no untracked log statements.
3. **Marker format is strict**: `SDD-DBG-G` followed by exactly 3 digits (zero-padded). Examples: `SDD-DBG-G001`, `SDD-DBG-G042`, `SDD-DBG-G999`.
4. **For `action: modified` guards**: `original_content` MUST contain the exact original line for restoration during cleanup.
5. **For `action: inserted` guards**: `original_content` MUST be empty string — the line will be deleted during cleanup.
6. Guards MUST NOT alter timing-sensitive behavior — use async logging for timing-critical code.
7. Guards MUST NOT introduce new dependencies unless the logging tool requires it (and it was approved in analyze-area).

### Guard Implantation Rules

```
For each area in the TDD vs Guards Assessment:
├── IF classification == "tdd":
│   ├── Create unit test in test/ directory
│   ├── Test MUST fail (RED) before any fix
│   └── Do NOT implant guards in testable code (tests ARE the evidence)
├── IF classification == "guard":
│   ├── Implant entry guard at function start
│   ├── Implant exit guard at function end (including early returns)
│   ├── Implant state guard at each decision point (if/switch/ternary)
│   ├── Implant error guard at each catch/error handler
│   └── Implant timing guard if area is timing-sensitive
└── ALWAYS: register every guard in the Guard Position Registry
```

## TDD Test Creation

For areas classified as `tdd`, the agent creates tests following the project's existing test patterns:

```
Test creation rules:
1. Match existing test file naming convention (*.test.js, *.spec.ts, etc.)
2. Match existing test framework (jest, vitest, mocha, pytest, etc.)
3. Each test MUST target a specific function/behavior
4. Tests MUST be runnable with the project's test command
5. Tests SHOULD fail (RED) before the fix is applied
```

## Phase Output
- **Implanted log guards** written to affected source files
- **TDD tests** created for testable areas
- **Guard Position Registry** — complete, validated, persisted to Engram
- Return to orchestrator:
  ```yaml
  status: success | partial | blocked
  executive_summary: "1-2 sentence summary"
  artifacts:
    - "sdd-debug/{issue}/guard-registry"
  next_recommended: collect-and-diagnose
  guard_count: N
  tdd_test_count: N
  files_modified: N
  ```

## Engram Persistence
- **Topic Key**: `sdd-debug/{issue}/guard-registry`
- **Type**: `architecture`
- **Content**: Full Guard Position Registry (JSON-serialized)
- **Persist call**: `engram_memory(action: "record_observation", content: "<registry>", category: "finding", tags: ["sdd-debug/{issue}/guard-registry"])`
