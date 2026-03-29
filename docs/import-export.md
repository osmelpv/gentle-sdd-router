# Import / Export Guide

## Overview

The v4 multi-file layout makes presets portable by default. Every preset is already a standalone YAML file, so `gsr` can export and import them directly.

## Export

### Export a preset to stdout

```bash
gsr export multivendor
```

### Export to a file

```bash
gsr export multivendor --out /tmp/multivendor.router.yaml
```

### Export as compact string

```bash
gsr export multivendor --compact
```

This returns a `gsr://` string using `base64(gzip(yaml))`. It is useful for chat, issues, README snippets, and quick sharing.

### Export all presets

```bash
gsr export --all
```

## Import

### Import from a local file

```bash
gsr import ./shared.router.yaml
```

### Import into a specific catalog

```bash
gsr import ./shared.router.yaml --catalog local
```

This writes to:

```text
router/profiles/local/<preset>.router.yaml
```

### Import from a compact string

```bash
gsr import --compact 'gsr://H4sIA...'
```

### Import from HTTPS URL

```bash
gsr import https://example.com/preset.router.yaml
```

Only HTTPS URLs are supported in v1. Public files only — no auth headers.

## Conflicts

If a preset with the same name already exists, import fails by default:

```bash
gsr import ./shared.router.yaml
# Error: Preset already exists
```

Overwrite explicitly with:

```bash
gsr import ./shared.router.yaml --force
```

## Validation and Safety

Every import goes through the same validation used by profile loading:

- invalid YAML is rejected
- missing `name` or invalid `phases` shape is rejected
- execution hints are rejected

This preserves the router's non-executing boundary.

## Suggested sharing workflow

1. Create or refine a preset locally
2. Export it with `--compact` for quick sharing or `--out` for a real file
3. Teammates import it into their preferred catalog with `gsr import`
4. Activate it with `gsr use <preset>`
