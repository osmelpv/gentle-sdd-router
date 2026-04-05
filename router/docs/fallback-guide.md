# GSR Fallback Guide

This document explains how fallback chains work in `gsr`, how to configure them,
and how the automatic fallback protocol activates at runtime.

---

## What Are Fallbacks?

A **fallback chain** is an ordered list of backup models for a specific agent/lane.
When the primary model of that agent encounters a failure condition, the chain is
consulted left-to-right: the first available model in the chain is used.

Fallbacks are defined **per agent** (per phase/lane). Each lane in a preset can
have its own independent chain. This is intentional — an orchestrator fallback is
not the same as a spec-writer fallback.

```
Primary model: anthropic/claude-sonnet-4-6
                       ↓ (fails)
Fallback 1:    mistral/mistral-large-3
                       ↓ (fails)
Fallback 2:    opencode/qwen3.6-plus-free
                       ↓ (fails)
Fallback 3:    opencode-go/glm-5
```

---

## The 6 Failure Conditions

A fallback is triggered when the primary model reports any of:

| Condition           | Description                                           |
|---------------------|-------------------------------------------------------|
| `quota_exceeded`    | HTTP 429 — model quota or rate limit reached          |
| `rate_limited`      | Provider-level rate limit (separate from quota)       |
| `timeout`           | Response took longer than 30 seconds                  |
| `connection_error`  | Network failure, DNS error, or host unreachable       |
| `context_exceeded`  | Request is too large for the model's context window   |
| `model_unavailable` | Model is offline, deprecated, or removed by provider  |

---

## How to Configure Fallbacks

There are **4 methods** to configure fallback chains:

### 1. Direct YAML (most explicit)

Edit the preset's `.router.yaml` file directly. Fallbacks can be a CSV string
(readable) or a structured array (for per-condition control):

```yaml
# router/profiles/premium.router.yaml
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
      # Simple CSV format — triggers on any failure
      fallbacks: mistral/mistral-large-3, opencode/qwen3.6-plus-free, opencode-go/glm-5

  apply:
    - target: mistral/codestral-latest
      kind: lane
      phase: apply
      role: primary
      # Structured format — trigger only on specific conditions
      fallbacks:
        - model: mistral/devstral-2-latest
          on: [quota_exceeded, rate_limited]
        - model: openai/gpt-5.3-instant
          on: [any]
```

Both formats are backward-compatible. The CSV format is equivalent to `on: [any]`
for every entry.

### 2. TUI Phase Composer

Inside the interactive TUI (`gsr` with no args), navigate to a phase and press
**[F]** while a slot is focused to open the **Fallback Manager**:

```
Fallbacks: orchestrator [primary] lane 0
────────────────────────────────────
  1. mistral/mistral-large-3        [D] delete  [u↑]
  2. opencode/qwen3.6-plus-free     [D] delete  [u↑] [n↓]
  3. opencode-go/glm-5              [D] delete  [n↓]

  [A] Add fallback    [Esc] Back
```

- **↑/↓** — move cursor between entries
- **D** — delete the focused entry
- **u** — move entry up in the chain
- **n** — move entry down in the chain
- **A** — open ModelPicker to append a new entry
- **Esc** — return to the phase detail view

### 3. CLI `gsr fallback` Commands

The `gsr fallback` command provides a full CLI interface for managing chains:

```bash
# List all fallback chains for a preset
gsr fallback list premium

# List fallbacks for a specific phase
gsr fallback list premium orchestrator

# Append a model to the end of a chain
gsr fallback add premium orchestrator openai/gpt-5.4

# Remove by 1-based index
gsr fallback remove premium orchestrator 2

# Move an entry (1-based from → to)
gsr fallback move premium orchestrator 3 1

# Replace the entire chain
gsr fallback set premium orchestrator "mistral/mistral-large-3,openai/gpt-5.3-instant"

# Multi-lane preset: target lane 1
gsr fallback add premium apply openai/gpt-5.4 --lane 1
```

All CLI commands validate model ID format (`provider/model`) and trigger a
`gsr sync` after writing changes.

### 4. `/gsr-fallback` Slash Command (runtime)

When an agent reports a failure during an active session, use the `/gsr-fallback`
slash command to switch to the next model in the chain. See the section below.

---

## Example YAML — Both Formats

```yaml
name: my-preset
sdd: agent-orchestrator
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      kind: lane
      phase: orchestrator
      role: primary
      # CSV: triggers on any failure
      fallbacks: mistral/mistral-large-3, opencode/qwen3.6-plus-free

  spec:
    - target: openai/gpt-5.3-instant
      kind: lane
      phase: spec
      role: primary
      # Structured: fine-grained control
      fallbacks:
        - model: mistral/devstral-medium
          on: [quota_exceeded, rate_limited]
        - model: opencode-go/glm-5
          on: [any]
```

---

## How `/gsr-fallback` Works

The `/gsr-fallback` slash command is the **runtime activation mechanism** for
fallbacks. It is available to all agents that have a non-empty fallback chain.

### When to use it

Use `/gsr-fallback` when an agent reports:

```
⚠️ GSR_FALLBACK_REQUEST
agent: gsr-orchestrator
phase: orchestrator
failed_model: anthropic/claude-sonnet-4-6
reason: quota_exceeded
next_fallback: mistral/mistral-large-3
```

### The menu interaction

```
⚠️ orchestrator failed — quota_exceeded

Fallbacks available:
  [Enter] → mistral/mistral-large-3    ← next in chain
  [2]     → opencode/qwen3.6-plus-free
  [3]     → opencode-go/glm-5
  [w]     → Wait and retry with same model
```

The user selects the desired fallback. The command guides switching the model for
the current session without requiring a full restart.

If the phase has multiple agents, the command first presents an agent selector:

```
Which agent needs the fallback?
  [1] gsr-orchestrator (failed)
  [2] gsr-judge
  [3] gsr-radar
```

---

## How the Auto-Trigger Works

The fallback protocol is **injected into every agent's system prompt** at sync
time (`gsr apply opencode --apply`). This means agents always know:

1. What their fallback chain looks like
2. The exact format to use when reporting a failure
3. How to signal the user that `/gsr-fallback` is needed

The injection is **conditional**: it only runs when the preset has at least one
lane with a non-empty fallback chain (design decision D2 — no protocol noise for
presets without fallbacks).

The injected text looks like:

```
[GSR Fallback Protocol]
If you encounter quota_exceeded, rate_limited, timeout, connection_error,
context_exceeded, or model_unavailable, report it as:

⚠️ GSR_FALLBACK_REQUEST
agent: [your agent name]
phase: [current phase]
failed_model: [model that failed]
reason: [failure condition]
next_fallback: [first model in _gsr_fallbacks]

Then STOP and wait for the user to invoke /gsr-fallback.
```

The `_gsr_fallbacks` field is available in the agent's opencode.json entry as a
map keyed by phase name:

```json
{
  "model": "anthropic/claude-sonnet-4-6",
  "_gsr_fallbacks": {
    "orchestrator": ["mistral/mistral-large-3", "opencode/qwen3.6-plus-free"],
    "explore": ["opencode-go/glm-5"]
  },
  "_gsr_orchestrator_fallbacks": ["mistral/mistral-large-3", "opencode/qwen3.6-plus-free"]
}
```

`_gsr_orchestrator_fallbacks` is a convenience alias for the orchestrator phase,
since that is by far the most common single-agent case.

---

## Real Model ID Examples

```yaml
# Anthropic
anthropic/claude-sonnet-4-6
anthropic/claude-haiku-3

# OpenAI
openai/gpt-5.4
openai/gpt-5.3-instant
openai/gpt-5.4-thinking

# Mistral
mistral/mistral-large-3
mistral/codestral-latest
mistral/devstral-2-latest
mistral/devstral-medium
mistral/mixtral-8x22b

# OpenCode
opencode/qwen3.6-plus-free
opencode/opencode-zen

# OpenCode-Go
opencode-go/glm-5
opencode-go/kimi-k2.5
opencode-go/minimax-m2.5
opencode-go/mimo-v2-pro
opencode-go/mimo-v2-omni

# Google
google/gemini-3.1-pro
google/gemini-3-flash

# Local (Ollama)
ollama/phi4
ollama/qwen2.5-coder
```

Model IDs must always be in `provider/model` format. The CLI will warn (but not
block) if a model's provider is not in the connected providers list.
