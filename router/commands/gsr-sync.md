---
description: Push global agent contracts to Engram
---

Run `gsr sync` to push all role contracts and phase compositions to Engram.

This is idempotent — running it multiple times produces the same state. Use it:
- After modifying contracts during development
- As a repair command if Engram data is lost
- It runs automatically on npm install -g

Shows count of synced role contracts and phase compositions.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr sync`
