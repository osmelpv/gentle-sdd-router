---
description: Remove gsr from this project (overlay + router/ with backup)
---

Run `gsr setup uninstall` to see what would be removed.

Run `gsr setup uninstall --confirm` to execute:
1. Removes gsr-* agent entries from opencode.json
2. Creates a backup of router/ at .router-backup-<timestamp>
3. Deletes the router/ directory

This does NOT remove global contracts from Engram.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr setup uninstall $ARGUMENTS`
