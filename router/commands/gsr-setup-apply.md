---
description: Generate and apply TUI overlay for OpenCode
---

Run `gsr setup apply opencode --apply` to generate and write the OpenCode overlay.

This creates gsr-* agent entries in ~/.config/opencode/opencode.json based on enabled catalogs and their presets.

Without --apply, shows a preview of what would be generated.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr setup apply opencode $ARGUMENTS`
