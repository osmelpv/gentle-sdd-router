---
name: analyze-area
phase_order: 1
description: Maps the problem area — language, ecosystem, infrastructure, dependencies, call chains, and testability. Selects optimal logging system. Classifies areas as TDD-testable vs guard-required. Produces a structured Area Analysis Report consumed by all downstream phases.
---

## Composition
| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| debug-analyst | Fixed | 1 | Maps dependencies, selects logging tool, assesses testability |

## Execution Mode
Default: `sequential` — Single agent maps the entire area. No parallel work needed.

## Delegation
`sub-agent` — This phase is delegated to a sub-agent. The orchestrator does NOT handle this directly.

## Dynamic Skill Loading
The agent MUST detect the target ecosystem and load the appropriate skill:

```
Detect ecosystem from affected files:
├── *.ts, *.js, package.json → Load skill: ecosystem-nodejs
├── *.py, pyproject.toml → Load skill: ecosystem-python
├── *.go, go.mod → Load skill: ecosystem-go
├── *.cs, *.csproj → Load skill: ecosystem-dotnet
├── *.java, pom.xml → Load skill: ecosystem-java
├── *.rs, Cargo.toml → Load skill: ecosystem-rust
└── Unknown → Standard analysis mode

Each ecosystem skill provides:
- Common dependency patterns for that ecosystem
- Typical logging tools and their tradeoffs
- Known gotchas and debugging approaches
- Test framework detection rules
```

## Phase Input
- Debug request with issue description, error messages, stack traces
- Affected files list
- Environment info (OS, runtime version, framework versions)
- Any existing test results or previous debug attempts

## Phase Output
- **Area Analysis Report** containing:
  - Language/runtime identification
  - Ecosystem map (frameworks, libraries, build tools)
  - Dependency graph (call chains, imports, module boundaries)
  - Execution context (how the affected code is invoked)
  - Risk zones (timing-sensitive code, race conditions, side-effect-heavy paths)
- **Logging System Selection** containing:
  - Chosen logging tool with justification
  - Installation steps (if needed)
  - Configuration template
  - Fallback options if primary tool is unsuitable
- **TDD vs Guards Assessment** — for each area in the dependency graph:
  - Testable areas (TDD): can be isolated and tested with mocks/stubs
  - Non-testable areas (Guards): require log guards (I/O boundaries, third-party integrations, timing-dependent code)

## Logging Tool Selection Criteria

The agent MUST evaluate logging tools against these criteria (weighted):

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Zero-config | HIGH | Can be used without modifying project configuration (no new dependencies preferred) |
| Structured output | HIGH | Produces machine-parseable output (JSON, key-value pairs) for forensic analysis |
| Performance | MEDIUM | Minimal overhead — logging MUST NOT alter the behavior being observed |
| Maturity | MEDIUM | Well-maintained, documented, community-supported |
| Simplicity | HIGH | Easy to add and remove — guards must be deterministically cleanable |

If the project already has a logging tool installed, prefer using it over adding a new dependency.

## TDD vs Guards Assessment

For each area identified in the dependency graph, classify:

```
Classification rules:
├── Pure function with no I/O → TDD (unit test)
├── Function with injectable dependencies → TDD (mock/stub)
├── Function with file/network I/O → Guard (log entry/exit + values)
├── Third-party API integration → Guard (log request/response)
├── Timing-dependent code → Guard (log timestamps, avoid altering timing)
├── Event-driven/callback code → Guard (log event flow + state)
├── Database queries → TDD if ORM with test DB, Guard if raw queries
└── UI/rendering code → Guard unless component testing framework exists
```

Output format per area:
```yaml
areas:
  - path: "src/auth/token-validator.js"
    functions: ["validateToken", "refreshSession"]
    classification: tdd
    reason: "Pure validation logic with injectable Redis client"
    test_approach: "Mock Redis client, test validation logic directly"
  - path: "src/auth/oauth-callback.js"
    functions: ["handleCallback"]
    classification: guard
    reason: "External OAuth provider communication, timing-dependent redirect"
    guard_approach: "Log request/response at OAuth boundary, log state before/after redirect"
```

## Engram Persistence
- **Topic Key**: `sdd-debug/{issue}/area-analysis`
- **Type**: `architecture`
- **Content**: Full Area Analysis Report + Logging Selection + TDD Assessment
- **Persist call**: `engram_memory(action: "record_observation", content: "<report>", category: "finding", tags: ["sdd-debug/{issue}/area-analysis"])`

## Return to Orchestrator
```yaml
status: success | partial | blocked
executive_summary: "1-2 sentence summary of findings"
artifacts:
  - "sdd-debug/{issue}/area-analysis"
next_recommended: implant-logs
ecosystem: "<detected ecosystem>"
logging_tool: "<selected tool>"
tdd_areas: N
guard_areas: N
risk_zones: N
```
