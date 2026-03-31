---
description: List all routing profiles with catalog info
---

Run `gsr profile list` and display all available profiles to the user.

Shows each profile with:
- Active marker (*)
- Phase count
- Catalog membership
- Tags (local, budget, etc.)

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr profile list`
