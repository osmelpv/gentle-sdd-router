---
description: "[System] Show router state, active preset, and resolved routes"
---

Run `gsr status` and display the output to the user.

This shows:
- Active SDD and preset name
- Activation state (who controls routing)
- All resolved phases with their assigned models
- Pricing per model ($input/$output per million tokens)
- Context window size per model

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr status`
