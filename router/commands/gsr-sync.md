---
description: "[System] Generate a sync manifest for agent contracts and phase compositions"
---

Run `gsr sync` to generate a `.sync-manifest.json` inside `router/contracts/`. This manifest lists all role contracts and phase compositions with checksums so the host TUI can discover and consume them.

This is idempotent — running it multiple times produces the same result. Use it:
- After modifying contracts during development
- As a repair command if the manifest is lost or stale

Shows count of role contracts and phase compositions included in the manifest.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr sync`
