# Exploration: Open Source Token Usage Monitoring Tools

**Date:** 2026-03-29  
**Topic:** Research on token tracking tools, APIs, and integration patterns for CLI/TUI routers

---

## Current State

The project (`gsr`) is a **non-executing external router** — it does not make API calls, it only publishes metadata and routing config. Any token usage monitor for `gsr` must respect that boundary: gsr can expose **declarative metadata** (context windows, pricing rates) but the **actual counting must happen at the host TUI layer**, not inside gsr.

The codebase already has:
- `lookupLanePricing()` in `src/cli.js` — reads `inputPerMillion` / `outputPerMillion` from lanes
- `formatPricing()` in `src/cli.js` — formats pricing as `$IN/$OUT`
- Pricing display in `gsr status` — shows cost per phase already
- `router/router.yaml` lanes support `inputPerMillion`, `outputPerMillion`
- `src/adapters/opencode/` — session sync contract published to the host

---

## Affected Areas

- `router/router.yaml` — would need a new optional field `contextWindow` per lane
- `src/cli.js` — rendering functions for status/browse could include context window info
- `src/adapters/opencode/` — session sync contract could expose budget metadata
- `docs/` — any new documentation for the token budget contract

---

## Research Findings

### 1. How Existing Tools Track Token Usage

| Tool | Approach | Storage |
|------|----------|---------|
| **simonw/llm** (11.5k★) | `response.set_usage(input=N, output=M)` in plugin execute() → auto-logged | SQLite via `llm logs` |
| **simonw/ttok** (387★) | Local BPE tokenization via `tiktoken`. Count-only, no budget | None |
| **openai/tiktoken** | BPE tokenizer for GPT family (`cl100k_base`, `o200k_base`). Offline. | None |
| **LLM Cost Estimator** (VS Code) | Status bar count using tiktoken locally + provider API for non-OpenAI | In-memory |
| **Cursor** | Shows context token count per chat in the chat UI, % of window | In-memory |
| **Claude Token Counter** (VS Code) | `X / 200K tokens` bar in status bar using Anthropic count_tokens API | In-memory |

**Gap identified:** No open source tool integrates token budget bars into a **CLI router tool workflow** without requiring the user to leave the TUI. The "Antigravity" extension referenced by the user appears to be a closed-source/unreleased pattern.

---

### 2. APIs That Expose Token Counts

#### Anthropic (Claude)

```json
// In every /v1/messages response:
"usage": {
  "input_tokens": 1234,
  "output_tokens": 567,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0
}
```

**Pre-flight count API** (no cost, no model execution):
```bash
POST /v1/messages/count_tokens
# Returns: { "input_tokens": 1234 }
```

**Rate limit headers** (in HTTP response headers):
```
anthropic-ratelimit-requests-remaining: 450
anthropic-ratelimit-tokens-remaining: 45000
anthropic-ratelimit-tokens-reset: 2026-01-01T00:00:00Z
```

> ⚠️ **No public quota aggregation API.** Monthly account usage is only visible in the Anthropic Console web UI. The only machine-readable token data is per-response `usage` and rate-limit headers (which reflect the per-minute window, not monthly budget).

#### OpenAI

```json
// In every /v1/chat/completions response:
"usage": {
  "prompt_tokens": 456,
  "completion_tokens": 123,
  "total_tokens": 579
}
```

**Pre-flight count API**:
```bash
POST /v1/responses/input_tokens
# Returns: { "input_tokens": 456 }
```

**Org-level usage history API** (requires admin key):
```bash
GET /v1/organization/usage/completions?start_time=T&models=gpt-5
```

**Rate limit headers**:
```
x-ratelimit-remaining-requests: 400
x-ratelimit-remaining-tokens: 40000
x-ratelimit-reset-tokens: 1s
```

#### Google Gemini

```json
// In every generate response:
"usageMetadata": {
  "promptTokenCount": 789,
  "candidatesTokenCount": 234,
  "totalTokenCount": 1023
}
```

**Pre-flight count API**:
```bash
POST /v1beta/models/{model}:countTokens
# Returns: { "totalTokens": 789 }
```

> ⚠️ **No public quota API.** Free tier limits (1M tokens/min) are not queryable. Google AI Studio is the only place to see usage dashboards.

#### Ollama (local models)

```json
// In Ollama generate/chat response:
{
  "prompt_eval_count": 67,
  "eval_count": 234
}
```

No quota concept — all local.

---

### 3. Local Tokenizers Available

| Provider | Tokenizer | Status |
|----------|-----------|--------|
| OpenAI (GPT-4, GPT-3.5) | `tiktoken` (cl100k_base) | ✅ OSS, pip install |
| OpenAI (GPT-4o, o3) | `tiktoken` (o200k_base) | ✅ OSS, pip install |
| Anthropic (Claude) | Not public | ❌ Must use API |
| Google (Gemini) | Not public | ❌ Must use API |
| Ollama | Model-dependent | ⚠️ Varies |

**Implication for gsr:** The only reliable cross-provider approach is to accumulate token counts from API responses (not from local tokenizers), since Anthropic and Gemini don't expose their tokenizers.

---

### 4. Integration Patterns for CLI/TUI Tools

#### Pattern 1: Post-request accumulator (recommended for hosts)
```
API call → response.usage.* → local store → render bar
```
The TUI reads `input_tokens + output_tokens` from each response and accumulates in memory or SQLite. No separate API needed. Works for all providers uniformly.

#### Pattern 2: Pre-flight estimation
```
Before API call → count_tokens API → show "This will use X tokens"
```
Useful for large inputs. Requires an extra API call (free for Anthropic, free for OpenAI). Adds latency. Better for explicit user confirmation flows than always-on status bars.

#### Pattern 3: Rate-limit header monitoring
```
Every API response → x-ratelimit-remaining-tokens header → bar = remaining/limit
```
Shows the per-minute rate limit window, NOT the monthly budget. Resets every 60 seconds. Useful for "am I being throttled?" — not for "how much of my subscription remains?"

#### Pattern 4: Declarative metadata from router config
```
router.yaml lane → contextWindow field → TUI renders "X / 200K"
```
The router publishes the context window size. The TUI uses accumulated session tokens vs. the window to show "context fullness" — separate from account budget but very actionable.

---

### 5. Best Approaches for Displaying Token Budgets

| Display Type | What It Shows | Data Source | Reset Cadence |
|---|---|---|---|
| **Context window bar** | `used / max` per session/conversation | Accumulated from responses | Per conversation |
| **Rate limit bar** | `remaining requests/tokens in window` | HTTP rate-limit headers | Every ~60s |
| **Monthly budget bar** | `used / monthly quota` | Provider dashboard API (OpenAI only) | Monthly |
| **Cost accumulator** | `$X.XX spent this session` | Local: tokens × pricing per lane | Per session |

**Best for CLI workflow (practical):** A **context window bar** + **session cost accumulator**, both driven by accumulated response data. These work for ALL providers uniformly without special API access or polling.

---

## Approaches for gsr Integration

### Approach 1: Purely Declarative Metadata (Low effort, safe)
**gsr adds `contextWindow` to lane metadata in `router.yaml` and exposes it in the session sync contract.**

The TUI host accumulates tokens from its own API calls, computes `used / contextWindow`, and renders the bar using gsr's metadata as the denominator.

```yaml
# router.yaml lane extension (new optional field)
phases:
  orchestrator:
    - target: anthropic/claude-sonnet-4-6
      inputPerMillion: 3.00
      outputPerMillion: 15.00
      contextWindow: 200000    # max tokens for this model
```

gsr's session sync contract then includes:
```json
{
  "tokenBudgetHint": {
    "phases": {
      "orchestrator": {
        "contextWindow": 200000,
        "inputCostPerMillion": 3.00,
        "outputCostPerMillion": 15.00
      }
    }
  }
}
```

- Pros: Fits gsr's non-executing boundary perfectly, no API calls by gsr
- Cons: TUI must implement accumulation; contextWindow must stay in sync with models
- Effort: **Low**

---

### Approach 2: `gsr usage` Command (Medium effort, report-only)
**gsr adds a `usage` sub-command that reads a local token log file written by the TUI host.**

The TUI host writes accumulated tokens to `~/.config/gsr/usage-log.jsonl`. gsr's `usage` command reads it, aggregates by provider/model, and renders a table or progress bars.

```
$ gsr usage
Provider    Model                    Tokens Used    Context     Session Cost
anthropic   claude-sonnet-4-6       45,230 / 200K  22.6%       $0.14
openai      gpt-5                   12,450 / 128K   9.7%       $0.06
```

- Pros: Clean CLI display, TUI does collection, gsr does visualization
- Cons: Requires coordination protocol between gsr and TUI host for the log format
- Effort: **Medium**

---

### Approach 3: API-Polling Status Command (High effort, not recommended)
**gsr directly polls OpenAI's org usage API and rate-limit headers.**

This would require gsr to hold API keys (violates non-executing boundary) and would only work for OpenAI (not Anthropic, not Gemini).

- Pros: Could show real monthly usage
- Cons: Violates gsr's non-executing boundary, provider coverage gap, key storage concern
- Effort: **High**
- **Not recommended**

---

## Recommendation

**Implement Approach 1 first.** It fits gsr's architecture perfectly:

1. Add optional `contextWindow: N` field to lane schema in `router.yaml`
2. Expose it through `gsr status` and `gsr browse` alongside existing pricing fields
3. Publish it in the session sync contract's `tokenBudgetHint` sub-field
4. Document the contract so TUI hosts (OpenCode, etc.) can build the accumulation+display layer

This gives TUI hosts everything they need to render a progress bar without gsr touching API keys or making calls. The bar math is: `(accumulated input + output tokens this session) / contextWindow`.

For **session cost display**, the data is already there: `gsr` has `inputPerMillion`/`outputPerMillion` — the TUI just needs to multiply by accumulated tokens.

---

## Risks

- `contextWindow` values need maintenance as models evolve (mitigation: document as informational hint, not enforcement)
- Anthropic and Google don't expose monthly quota APIs — only per-request `usage` in responses (mitigation: scope to session/conversation context, not monthly budget)
- The TUI host must implement the accumulation layer — gsr can't force that (mitigation: document the contract clearly in host-skill assets)
- Some providers silently change context windows without versioning (mitigation: use semantic versioning comment in yaml)

---

## Ready for Proposal

**Yes** — the scope is clear and bounded. This is a metadata-extension + contract-surface change, fitting gsr's existing patterns exactly. The work is:

1. Schema: add `contextWindow` optional field to lane validation
2. CLI: surface it in `status`, `browse`, `render opencode`
3. Contract: add `tokenBudgetHint` to the session sync contract in the opencode adapter
4. Tests: validate field projection, contract shape
5. Docs: update host-adoption docs to explain how to use the hint

This does NOT require any API calls from gsr, any key storage, or any provider-specific logic.
