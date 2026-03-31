# Host Adoption

## Purpose

Install the router skill into host-owned files only. The router stays external, and the install/uninstall flow keeps user edits outside the managed block intact.
This document covers adoption only; active `/gsr` slash-command sync is a separate host-owned contract.

## Install

1. Call `installHostAdoption(hostRoot)` from the host integration layer.
2. The installer copies `assets/host-skill/router-skill/**` into `.gsr/skills/router-skill/`.
3. It inserts one managed guardrail block into `.gsr/policy/rules.md`.

## Uninstall

1. Call `uninstallHostAdoption(hostRoot)` from the host integration layer.
2. The uninstaller removes only the managed block, the tracked skill files, and the manifest.
3. It fails closed if the manifest, markers, or tracked hashes no longer match.

## Safety notes

- The flow fails closed if markers are missing, duplicated, or the tracked hashes do not match.
- User-authored text outside the managed block is preserved.
- `/gsr` TUI/slash-command integration is host-owned, external, and handled by the live session sync contract.

## Token Budget Hint Contract

The session sync contract includes a `tokenBudgetHint` field that exposes per-phase token budget metadata. This enables TUI hosts to render context window bars and session cost estimators without gsr making any API calls.

### Contract Shape

```json
{
  "tokenBudgetHint": {
    "kind": "token-budget-hint",
    "contractVersion": "1",
    "catalogName": "default",
    "presetName": "multivendor",
    "phases": {
      "orchestrator": {
        "target": "anthropic/claude-opus",
        "contextWindow": 200000,
        "inputCostPerMillion": 15,
        "outputCostPerMillion": 75
      },
      "explore": {
        "target": "google/gemini-pro",
        "contextWindow": 2000000,
        "inputCostPerMillion": 1.25,
        "outputCostPerMillion": 5
      }
    },
    "policy": {
      "nonExecuting": true,
      "informationalOnly": true,
      "hostAccumulates": true
    }
  }
}
```

### How to Use (TUI Host)

1. Read `tokenBudgetHint.phases[currentPhase].contextWindow` for the denominator.
2. Accumulate `input_tokens + output_tokens` from each API response in a session-local counter.
3. Render the bar: `(accumulated tokens) / contextWindow`.
4. For cost: `(input tokens × inputCostPerMillion / 1_000_000) + (output tokens × outputCostPerMillion / 1_000_000)`.

### Policy

- `nonExecuting`: gsr never makes API calls. This is metadata only.
- `informationalOnly`: context window values are informational hints, not enforcement limits.
- `hostAccumulates`: the TUI host is responsible for tracking actual token consumption from API responses.

### CLI Surface

Use `gsr setup apply opencode [--apply]` to generate or preview the OpenCode TAB-switching overlay.

> **Note**: The old `gsr apply opencode` command still works as a backward-compat alias.

`gsr status` displays the context window alongside pricing for each phase:

```
- orchestrator: anthropic / claude-opus ($15/$75) [200K ctx]
- explore:      google / gemini-pro    ($1.25/$5) [2M ctx]
```

### Backward Compatibility

The `contextWindow` field on lanes and the `tokenBudgetHint` field on the session sync contract are both optional. Profiles without `contextWindow` continue to work as before, and the `tokenBudgetHint` will be `null` when no budget data is available.
