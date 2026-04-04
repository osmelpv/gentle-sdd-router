---
description: "[Preset] List all routing presets with SDD/scope/visibility info"
---

Run `gsr preset list` and display all available presets to the user.

Shows each preset with:
- Active marker (*)
- Phase count
- SDD ownership
- Scope
- Visibility
- Tags (local, budget, etc.)

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr preset list`
