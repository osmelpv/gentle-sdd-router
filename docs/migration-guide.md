# Migration Guide

## Overview

When gsr's schema evolves, the migration system upgrades your project config safely. Migrations are:

- **Backup-first** — full backup before each migration
- **Rollback-safe** — automatic restore on failure
- **Idempotent** — running twice has no effect
- **Non-destructive** — preserves user data and unknown YAML keys

## Checking for Migrations

```bash
gsr setup update
```

This shows pending migrations without applying them (dry-run by default):

```
Pending migrations:
  001 — v3-to-v4-multifile: Convert monolith to multi-file profile structure

Run `gsr setup update --apply` to apply these migrations.
```

## Applying Migrations

```bash
gsr setup update --apply
```

For each migration:
1. A full backup is created in `router/backups/pre-{id}-{timestamp}/`
2. The migration transforms your config
3. The result is validated
4. The registry is updated in `router/.migrations.yaml`

If anything fails, the backup is restored automatically.

## Supported Migrations

### 001: v3 to v4 Multi-file

Converts a monolithic `router/router.yaml` (schema v3 or v1) into the v4 multi-file structure:

**Before:**
```
router/
  router.yaml          # everything in one file (v3)
```

**After:**
```
router/
  router.yaml          # core config only (v4)
  profiles/
    multivendor.router.yaml
    safety.router.yaml
```

This migration:
- Extracts each preset into its own file under `router/profiles/`
- Keeps the core config (version, active preset, metadata) in `router.yaml`
- Preserves all user data and metadata

## Migration Registry

Applied migrations are tracked in `router/.migrations.yaml`:

```yaml
schema_version: 1
applied:
  "001":
    name: v3-to-v4-multifile
    applied_at: "2026-03-28T12:00:00.000Z"
    backup_path: backups/pre-001-1711612800000
```

## Backups

Backups are stored in `router/backups/`. Each backup is a complete copy of your `router/` directory at the time of migration.

To manually restore from a backup:

```bash
# List backups
ls router/backups/

# Restore a specific backup (replace with actual path)
cp -r router/backups/pre-001-1711612800000/* router/
```

## Backward Compatibility

gsr supports all schema versions for reading:

| Version | Status |
|---------|--------|
| v1 | Supported (auto-normalized to v3 view) |
| v3 | Supported (native) |
| v4 | Current (default for new installs) |

You don't need to migrate immediately — older configs continue to work. But migrating to v4 gives you multi-file profiles and easier preset management.

## Outdated Config Detection

When running any gsr command on a project with an older schema version, you'll see a one-line hint:

```
Note: Your router config (version 3) can be upgraded to version 4. Run `gsr setup update` for details.
```

This appears once per command and doesn't block your work.
