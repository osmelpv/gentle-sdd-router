---
description: Check and apply config migrations
---

Run `gsr setup update` to check for pending config migrations.

With --apply, applies pending migrations with automatic backup.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr setup update $ARGUMENTS`
