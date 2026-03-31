---
description: Enable a catalog so its presets appear in TUI TAB cycling
---

Run `gsr catalog enable $ARGUMENTS` to make a catalog's presets visible when cycling with TAB in the TUI host.

After enabling, run `gsr setup apply opencode --apply` to regenerate the overlay with the new agents.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr catalog enable $ARGUMENTS`
