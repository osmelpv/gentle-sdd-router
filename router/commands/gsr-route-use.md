---
description: "[Route] Switch the active routing preset"
---

Run `gsr route use $ARGUMENTS` to switch the active routing preset.

After switching, run `gsr status` to confirm the change and show the new resolved routes.

CONTEXT:
- Working directory: !`echo -n "$(pwd)"`
- Command: !`gsr route use $ARGUMENTS`
