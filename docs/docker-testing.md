# Docker E2E Testing Guide

This guide lets you boot a clean container with `gsr` pre-installed and walk through the full workflow without touching your local machine.

## Prerequisites

- Docker and Docker Compose installed
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your environment (optional — most steps work without keys)

## Quick Start

```bash
# From the project root
docker compose build
docker compose up -d
docker compose exec gsr-test bash

# You land in /test-project — gsr install was already run at build time
```

---

## Test Steps

### Step 1: Verify installation

```bash
gsr --version          # Should show v0.1.0
gsr help               # Should list all available commands
```

### Step 2: Check initial state

```bash
gsr status             # Should show v4, multivendor active
gsr list               # Should show at least 1 preset
```

### Step 3: Switch presets

```bash
gsr use claude         # Switch to claude preset; v4 structure preserved
gsr status             # Should show claude active
gsr use multivendor    # Switch back to multivendor
gsr status             # Should show multivendor active again
```

### Step 4: Export presets

```bash
gsr export multivendor                               # Print YAML to stdout
gsr export multivendor --compact                     # Print gsr:// compact string
gsr export multivendor --out /tmp/my-preset.yaml     # Save to file
ls /tmp/my-preset.yaml                               # Should exist
cat /tmp/my-preset.yaml                              # Inspect the content
```

### Step 5: Apply opencode overlay

```bash
gsr apply opencode                  # Preview what would be written (dry run)
gsr apply opencode --apply          # Write to ~/.config/opencode/opencode.json
cat ~/.config/opencode/opencode.json | grep gsr     # Should show gsr-* entries
```

### Step 6: Migrations

```bash
gsr update             # Should say "up to date" or apply pending migrations
```

### Step 7: Persona and pricing

```bash
gsr status             # Should show pricing for each active route
cat router/router.yaml # Should have a persona field and routes configured
```

### Step 8: Run the full test suite

```bash
cd /app
node --test            # All tests should pass
```

---

## Iterating on Source Changes

Because `./src` is mounted into the container, you can edit source files on your host and the changes are immediately visible inside the container (no rebuild needed):

```bash
# On host — edit a file
vim src/cli.js

# Inside container — run it right away
gsr status
```

> **Note:** Changes to `package.json` or new dependencies DO require a rebuild:
> ```bash
> docker compose down && docker compose build && docker compose up -d
> ```

---

## Cleanup

```bash
exit                   # Leave the container shell
docker compose down    # Stop and remove the container
```

To also remove the built image:

```bash
docker compose down --rmi local
```
