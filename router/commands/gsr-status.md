---
description: Show current router state, active preset, resolved routes with pricing and context window
---

Run `gsr status` and display the output to the user.

This shows:
- Active catalog and preset name
- Activation state (who controls routing)
- All resolved phases with their assigned models
- Pricing per model ($input/$output per million tokens)
- Context window size per model

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr status`
