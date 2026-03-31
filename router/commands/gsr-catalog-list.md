---
description: "[Catalog] List all catalogs with enable/disable status"
---

Run `gsr catalog list` to show all catalogs.

Each catalog shows:
- Display name (e.g., SDD-Orchestrator for default)
- Enabled/disabled status (only enabled catalogs appear in TUI TAB cycling)
- Profile count

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr catalog list`
