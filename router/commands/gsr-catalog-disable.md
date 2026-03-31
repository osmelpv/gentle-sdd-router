---
description: "[Catalog] Disable a catalog from TUI TAB cycling"
---

Run `gsr catalog disable $ARGUMENTS` to hide a catalog's presets from TAB cycling in the TUI host.

After disabling, run `gsr setup apply opencode --apply` to regenerate the overlay.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr catalog disable $ARGUMENTS`
