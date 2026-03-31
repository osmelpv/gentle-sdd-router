# Exploration: usage-quota-tui

> **Change**: `usage-quota-tui`
> **Phase**: Explore
> **Date**: 2026-03-31
> **Engram**: `sdd/usage-quota-tui/explore` (observation #247)

---

## Current State

### What exists today

`gsr status` already outputs declarative token metadata:

```
- orchestrator: anthropic / claude-opus ($15/$75) [200K ctx]
- explore: google / gemini-pro ($1.25/$5) [2M ctx]
```

The `contextWindow` field was added (Token Usage Monitor v1, Decision #138) and flows through `tokenBudgetHint` in the OpenCode session sync contract. This gives us **denominators** for progress bars.

What is **missing**: the **numerator** — how many tokens have been consumed in the current session, per provider.

### What OpenCode exposes

**`@opencode-ai/plugin` v1.3.8** provides two plugin types:

#### Server Plugin (`Plugin` type, `{ server: Plugin }` module)
```ts
type Plugin = (input: PluginInput, options?) => Promise<Hooks>
// input has: client (OpencodeClient), project, directory, worktree, serverUrl, $
```
Hooks include:
- `event({ event })` — listen to ANY OpenCode event
- `auth` — provide OAuth/API-key methods per provider
- `chat.params`, `chat.headers` — modify outgoing LLM calls
- `tool`, `command.execute.before`, `tool.execute.after`

#### TUI Plugin (`TuiPlugin` type, `{ tui: TuiPlugin }` module)
```ts
type TuiPlugin = (api: TuiPluginApi, options?, meta?) => Promise<void>
```
`TuiPluginApi` provides:
- `api.slots.register()` — inject SolidJS components into named slots
- `api.event.on()` — subscribe to events in the TUI context
- `api.client` — OpencodeClient
- `api.state.provider` — `ReadonlyArray<Provider>` (auth status per provider)
- `api.state.session.messages(sessionID)` — `ReadonlyArray<Message>` (with token data)
- `api.kv` — persistent key-value store (survives compaction)
- `api.theme.current` — full RGBA color palette

#### Available sidebar slots (`TuiSlotMap`)
```ts
sidebar_content: { session_id: string }
sidebar_footer:  { session_id: string }   // ← best for usage bars
home_logo: {}
home_bottom: {}
home_footer: {}
```

### `Provider` type — NO usage fields

```ts
Provider = {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "api";
  env: Array<string>;
  key?: string;     // API key if set
  options: Record<string, unknown>;
  models: { [key: string]: Model };
}
```

**No quota, no usage, no rate-limit fields.** Provider knows auth state and available models only.

### Token data IS available — via `StepFinishPart`

Every assistant response cycle emits `message.part.updated` with a `StepFinishPart`:

```ts
StepFinishPart = {
  type: "step-finish";
  cost: number;           // USD — OpenCode computes this from pricing tables
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number; }
  }
}
```

`AssistantMessage` also has the same `tokens` + `cost` + `providerID` + `modelID` fields. This is the data source for session-level accumulation.

---

## Affected Areas

- `src/adapters/opencode/index.js` — existing tokenBudgetHint; new server plugin entry point
- `src/adapters/opencode/gsr-server-plugin.js` — **NEW**: event listener, token accumulator
- `src/adapters/opencode/gsr-tui-plugin.js` — **NEW (Phase 2)**: SolidJS sidebar component
- `router/commands/gsr-status.md` — update to optionally show consumed tokens
- `src/cli.js` — `gsr status` may read token-usage.json if present
- `~/.local/share/gsr/token-usage.json` — runtime file (not tracked in git)

---

## Provider Usage API Availability

| Provider | Per-Response Tokens | Account Quota API | Rate-Limit Headers |
|---|---|---|---|
| Anthropic | ✅ `usage.input_tokens` in response | ❌ Console only, no API | ✅ `anthropic-ratelimit-tokens-remaining` |
| OpenAI | ✅ `usage.prompt_tokens` | ✅ `GET /v1/organization/usage/completions` | ✅ `x-ratelimit-remaining-tokens` |
| Google Gemini | ✅ `usageMetadata.promptTokenCount` | ❌ AI Studio only | ❌ Not in headers |
| Ollama | ✅ `prompt_eval_count` | N/A (local) | N/A |

**Key insight**: Rate-limit headers and org-level APIs require HTTP interception, which the plugin API doesn't directly support (the `chat.headers` hook is outgoing-only). However, **OpenCode already computes token usage per step** and stores it in `StepFinishPart.tokens` + `AssistantMessage.tokens`. We can accumulate this data event-driven without needing provider-specific APIs.

---

## Approaches

### 1. Server Plugin — Event Accumulator (file persistence)
A `server` plugin hook listens to `message.part.updated` events, detects `step-finish` parts, aggregates tokens per `providerID`, and writes to `~/.local/share/gsr/token-usage.json`. The `/gsr-status` command reads this file.

- **Pros**: No SolidJS, no @opentui/solid dependency, pure Node.js, surfaces in CLI + TUI commands, simple
- **Cons**: No real-time visual bar in sidebar (only via `/gsr-status` command), JSON file is per-machine
- **Effort**: Low (1–2 days)

### 2. TUI Plugin — SolidJS Sidebar Bar
A `tui` plugin registers a `sidebar_footer` slot, reads session messages + events, and renders real-time progress bars using `@opentui/solid` SolidJS components with `api.theme.current` colors.

- **Pros**: Persistent visual in sidebar, real-time updates, full theme integration
- **Cons**: Requires `@opentui/solid` + `babel-preset-solid` dependencies (~76KB), SolidJS knowledge, harder to debug
- **Effort**: High (3–4 days)

### 3. Hybrid — Server accumulates, TUI renders (recommended long-term)
Phase 1 is Approach 1 (server plugin). Phase 2 adds the TUI plugin that reads the same JSON file for initial load, then subscribes to events for live updates.

- **Pros**: Clean separation of concerns, fallback works (CLI sees usage even without TUI plugin active)
- **Cons**: Two-phase delivery, JSON file as shared state between server and TUI plugin
- **Effort**: Medium (Phase 1: Low, Phase 2: High)

### 4. MCP Tool (alternative, avoids TUI entirely)
gsr registers an MCP server. OpenCode calls it via MCP to retrieve usage data. OpenCode renders the data in its own UI.

- **Pros**: No plugin API knowledge needed, language-agnostic
- **Cons**: No visual control, depends on OpenCode MCP rendering support, higher latency, more setup for users
- **Effort**: Medium
- **Verdict**: Rejected — less visual control, no sidebar integration

---

## Recommendation

**Implement Approach 1 first (server plugin event accumulator), then Phase 2 (TUI sidebar).**

### Phase 1 — Server Plugin (MVP)

**New file**: `src/adapters/opencode/gsr-server-plugin.js`

```js
// Server plugin module — accumulates token usage per session
export default async function gsrServerPlugin({ client }) {
  const usageFile = path.join(os.homedir(), '.local/share/gsr/token-usage.json');
  const sessionMap = new Map(); // sessionID → { providers: { [providerID]: { tokens, cost } } }

  return {
    event: async ({ event }) => {
      if (event.type !== 'message.part.updated') return;
      const part = event.properties.part;
      if (part.type !== 'step-finish') return;
      // get providerID from parent message (AssistantMessage.providerID)
      // accumulate part.tokens + part.cost into sessionMap
      // persist sessionMap to usageFile
    }
  };
}
```

**Registration** in `opencode.json` (via `gsr setup apply`):
```json
{
  "plugin": [
    "opencode-gemini-auth@latest",
    "opencode-anthropic-login-via-cli@latest",
    "gentle-sdd-router/opencode-server-plugin"
  ]
}
```

**gsr status with usage** (enhanced output when `~/.local/share/gsr/token-usage.json` exists):
```
- orchestrator: anthropic / claude-opus ($15/$75) [200K ctx]
    session: 45,123 / 200K tokens (22%) | $0.67 spent
- explore: google / gemini-pro ($1.25/$5) [2M ctx]
    session: 360,000 / 2M tokens (18%) | $0.12 spent
```

### Phase 2 — TUI Sidebar (SolidJS)

**New file**: `src/adapters/opencode/gsr-tui-plugin.js`

Registers `sidebar_footer` slot with a SolidJS component that:
1. On mount: reads token-usage.json for current session baseline
2. Listens to `api.event.on('message.part.updated', ...)` for live updates
3. Renders bars using `api.theme.current` colors

**Sidebar mockup**:
```
┌─ gsr Usage ─────────────────────┐
│ anthropic  ████████░░░ 67% $0.67│
│   claude-opus  45K / 200K       │
│                                 │
│ google     ███░░░░░░░░ 18% $0.12│
│   gemini-pro  360K / 2M         │
│                                 │
│ Session total: $0.79            │
└─────────────────────────────────┘
```

Bar fill color thresholds (using `api.theme.current`):
- `< 50%` → `success` (green)
- `50–80%` → `warning` (yellow)
- `> 80%` → `error` (red)

---

## Design Decisions

### Non-executing boundary preserved
The server plugin ONLY reads events that OpenCode emits. It does NOT call provider APIs, does NOT initiate HTTP requests, and does NOT store API keys. This preserves gsr's non-executing, report-only contract.

### providerID mapping
`StepFinishPart` does not include `providerID` — it only has `messageID`. The plugin must:
1. Wait for `message.updated` or `message.part.updated` events
2. When `step-finish` is seen, call `client.session.messages({ sessionID })` to get `AssistantMessage.providerID`
   — OR — cache the most recent `AssistantMessage` per `messageID` from prior events

Alternative: listen to `message.updated` events (which include full `AssistantMessage` with `providerID` + `tokens`) to maintain a message cache.

### Persistence strategy
`~/.local/share/gsr/token-usage.json` structure:
```json
{
  "version": 1,
  "sessions": {
    "{sessionID}": {
      "startedAt": "2026-03-31T...",
      "providers": {
        "anthropic": { "inputTokens": 45123, "outputTokens": 3210, "cost": 0.67 },
        "google":    { "inputTokens": 360000, "outputTokens": 12000, "cost": 0.12 }
      }
    }
  }
}
```

Pruning: keep last 10 sessions max (ring buffer). Auto-prune on each write.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `StepFinishPart` providerID not directly available | High | Listen to `message.updated` event for message cache + providerID |
| OpenCode breaks plugin API on update | Medium | Lock plugin package version in opencode.json |
| @opentui/solid adds ~76KB to package size | High | TUI plugin in separate optional package or peer dep |
| Race condition between server and TUI reading JSON | Low | Use atomic writes (write to temp, rename) |
| gsr is private (`"private": true` in package.json) | High for Phase 1 | Use relative file path in plugin field, not npm name |
| Users with no sessions show empty bars | Low | Handle gracefully with "No data yet" placeholder |

---

## Minimum Viable Scope

**For next iteration (Phase 1 only)**:
1. `src/adapters/opencode/gsr-server-plugin.js` — event listener, `message.updated` → accumulate per `providerID`
2. `~/.local/share/gsr/token-usage.json` — session accumulation file, 10-session ring buffer
3. `src/cli.js` — `gsr status` reads token-usage.json, adds consumed/% to output when available
4. `router/commands/gsr-status.md` — updated to note real-time session token display
5. `gsr setup apply` — includes server plugin registration in opencode.json
6. Tests: token accumulation, JSON persistence, session pruning

**Deferred to Phase 2**:
- TUI sidebar SolidJS component
- `@opentui/solid` dependency
- Real-time bar rendering
- Cost warning thresholds/alerts
- Provider-specific quota APIs (OpenAI org-level — optional enhancement later)

---

## Ready for Proposal
**Yes** — Phase 1 (server plugin + gsr status enhancement) is well-scoped and ready to propose.
Phase 2 (TUI sidebar) needs a separate change after Phase 1 lands and user validates the data quality.
