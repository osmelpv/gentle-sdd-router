---
description: "[Fallback] Activate next model fallback after a failure — SDK toast + auto-trigger on detection"
---

When invoked after a GSR_FALLBACK_REQUEST (or when the agent detects a model failure):

## Step 1 — SDK Toast (auto, silent if unavailable)

Run this shell snippet immediately. It shows a warning toast via the OpenCode SDK.
If the SDK is not available, it fails silently — the chat flow continues normally.

```
!`node --input-type=module --eval "
import { createOpencodeClient } from '@opencode-ai/sdk';
try {
  const client = createOpencodeClient({ timeout: 3000 });
  const c = (await client).client;
  await c.tui.showToast({ body: {
    message: '⚠️ GSR: Model failed — fallback chain activating',
    variant: 'warning'
  }});
} catch (e) { /* SDK not available — continue with chat flow */ }
" 2>/dev/null || true`
```

## Step 2 — Read agent + fallback info (with connection status badges)

Run this shell snippet to discover which agents are configured and which fallback
providers are currently connected. Output is JSON used in the next step.

```
!`node --input-type=module --eval "
import { createOpencodeClient } from '@opencode-ai/sdk';
try {
  const { client } = await createOpencodeClient({ timeout: 3000 });
  const { data } = await client.config.providers();
  const connected = data.providers.map(p => p.id);
  const fs = await import('node:fs');
  const os = await import('node:os');
  const cfg = JSON.parse(fs.readFileSync(os.homedir() + '/.config/opencode/opencode.json', 'utf8'));
  process.stdout.write(JSON.stringify({ connected, agents: Object.keys(cfg.agent || {}) }));
} catch(e) { process.stdout.write('{}'); }
" 2>/dev/null || echo '{}'`
```

If the shell output is non-empty JSON, use the `connected` array to annotate
each fallback model. For example:
- `openai/gpt-5.4` → `openai/gpt-5.4 ✓ (connected)` if `openai` is in `connected`
- `anthropic/claude-haiku` → `anthropic/claude-haiku ✗ (not connected)` otherwise

## Step 3 — Read the fallback chain from opencode.json

Read the `_gsr_fallbacks` field from the current agent's config in opencode.json:

```
!`cat ~/.config/opencode/opencode.json | node --input-type=module --eval "
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const cfg = JSON.parse(readFileSync(homedir() + '/.config/opencode/opencode.json', 'utf8'));
const agents = Object.entries(cfg.agent || {});
const result = agents.map(([name, def]) => ({
  name,
  phase: def._gsr_phase,
  fallbacks: def._gsr_fallbacks || {}
}));
process.stdout.write(JSON.stringify(result, null, 2));
" 2>/dev/null || echo '[]'`
```

## Step 4 — Agent selector (if multiple agents share the same phase)

If the current phase has multiple agents (multiple entries with the same `_gsr_phase`),
first ask:

> "Which agent needs the fallback? List the agents in the current phase and wait for
> the user to pick."

## Step 5 — Present the fallback chain

Present the ordered fallback options for the selected agent. Annotate each model with
`✓ (connected)` or `✗ (not connected)` using the provider data from Step 2.

```
⚠️ Fallback options for [agent] ([phase]):
  [Enter] → [first_fallback]    ← default (next in chain)  [✓ connected / ✗ not connected]
  [2]     → [second_fallback]                               [✓ connected / ✗ not connected]
  [3]     → [third_fallback]                                [✓ connected / ✗ not connected]
  [w]     → Wait and retry same model

Reply with Enter, 2, 3, or w:
```

## Step 6 — Execute model switch

Based on user input:
- `Enter` or `1` → switch to first_fallback using `/model [first_fallback]` or by updating the session model
- Number `n` → switch to the nth fallback in the list
- `w` → tell user to wait ~60s then retry the same model

After switching: "Now using [selected_model] for [agent]. Continuing..."

---

> **Design note**: The SDK toast and provider-status enrichment are progressive
> enhancements. If `@opencode-ai/sdk` is unavailable (e.g. running outside OpenCode),
> the command degrades gracefully to the pure chat-based fallback selection flow above.
> The SDK is invoked at runtime inside OpenCode's Node environment — it is NOT added
> as a package.json dependency.
