---
description: Set the active catalog and preset
---

Run `gsr catalog use $ARGUMENTS` to switch the active catalog.

If a preset name is provided as a second argument, it also sets the active preset within that catalog.

After switching, run `gsr status` to confirm the change.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr catalog use $ARGUMENTS`
