# Docker E2E Testing Guide

This guide is the staging ground for a **full-ecosystem** container: `gsr + gentle-ai + OpenCode`, ready for manual validation without touching your local machine.

> Current status: the documented workflow is valid, but the final visual OpenCode validation still requires a human in the loop.

## Prerequisites

- Docker and Docker Compose installed
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your environment (optional — most steps work without keys)

## Target container shape

The final container should include:

- `gsr` globally available
- `gentle-ai` installed and ready
- `opencode` installed and ready
- one precreated `/test-project`
- `gsr setup install` already executed
- `gsr setup apply opencode --apply` already executed

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
gsr route use claude   # Switch to claude preset; v4 structure preserved
gsr status             # Should show claude active
gsr route use multivendor  # Switch back to multivendor
gsr status             # Should show multivendor active again
```

### Step 4: Export presets

```bash
gsr profile export multivendor                               # Print YAML to stdout
gsr profile export multivendor --compact                     # Print gsr:// compact string
gsr profile export multivendor --out /tmp/my-preset.yaml     # Save to file
ls /tmp/my-preset.yaml                               # Should exist
cat /tmp/my-preset.yaml                              # Inspect the content
```

### Step 5: Apply opencode overlay

```bash
gsr setup apply opencode            # Preview what would be written (dry run)
gsr setup apply opencode --apply    # Write to ./opencode.json in the project root
cat opencode.json | grep gsr        # Should show gsr-* entries
```

### Step 5b: OpenCode visual validation (manual)

When the full ecosystem image is ready:

```bash
opencode
```

Inside OpenCode, validate manually:

1. TAB switching shows the `gsr-*` modes
2. `gsr-multivendor` appears and is active by default
3. `gsr-safety` appears with restricted permissions
4. Switching between modes changes the routing profile as expected
5. The overlay coexists with any `gentle-ai` agents already present

### Step 6: Migrations

```bash
gsr setup update       # Should say "up to date" or list pending migrations
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

## Scenario matrix to validate

1. **Standalone only** — gsr without gentle-ai
2. **gentle-ai present** — controller/persona integration
3. **OpenCode overlay applied** — `gsr setup apply opencode --apply`
4. **Preset switching** — `gsr route use multivendor`, `claude`, `ollama`, `safety`
5. **Import/export** — `gsr profile import`/`gsr profile export`, local file, compact string, URL
6. **Migration path** — seed v3 project, run `gsr setup update --apply`
