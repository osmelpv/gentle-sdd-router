---
description: gsr command dispatcher — pick a category to explore available commands
---

Use `/gsr` to orient yourself. Pick the category that matches what you want to do, then invoke the specific `/gsr-{category}-{action}` command.

> Commands marked **CLI-only** have no slash-command file yet and must be run in a terminal.

## Route

Manage routing preset selection and activation state.

- `/gsr-route-use` — Switch the active routing preset
- `/gsr-route-show` — Show resolved routes for the current preset
- `/gsr-route-activate` — Activate gsr routing control
- `/gsr-route-deactivate` — Hand routing control back to the host

## Catalog

Enable, disable, and switch between model catalogs.

- `/gsr-catalog-list` — List all catalogs with enable/disable status
- `/gsr-catalog-use` — Set the active catalog and preset
- `/gsr-catalog-enable` — Enable a catalog for TUI TAB cycling
- `/gsr-catalog-disable` — Disable a catalog from TUI TAB cycling
- `gsr catalog move <profile> <catalog>` — Move a profile to a different catalog (**CLI-only**)

## Profile

Manage routing profiles within a catalog.

- `/gsr-profile-list` — List all routing profiles with catalog info
- `/gsr-profile-create` — Create a new empty routing profile
- `gsr profile show [name]` — Show routes for a profile (**CLI-only**)
- `gsr profile delete <name>` — Delete a profile (**CLI-only**)
- `gsr profile rename <old> <new>` — Rename a profile (**CLI-only**)
- `gsr profile copy <src> <dest>` — Clone a profile (**CLI-only**)
- `gsr profile export <name> [--compact]` — Export a profile for sharing (**CLI-only**)
- `gsr profile import <source>` — Import a profile from file/URL/gsr:// (**CLI-only**)

## Inspect

Read-only metadata inspection across presets.

- `/gsr-inspect-browse` — Browse multimodel metadata for a preset
- `/gsr-inspect-compare` — Compare two presets side by side
- `gsr inspect render <target>` — Preview host boundary report (**CLI-only**)

## Setup

Installation, migration, and teardown commands.

- `/gsr-setup-apply` — Generate and apply TUI overlay for OpenCode
- `/gsr-setup-update` — Check and apply config migrations
- `/gsr-setup-uninstall` — Remove gsr from this project (overlay + router/ with backup)
- `gsr setup install` — Inspect or apply a YAML-first install intent (**CLI-only**)
- `gsr setup bootstrap` — Guided first-time setup (**CLI-only**)

## Identity

Resolve and display agent identity context.

- `gsr identity show [--preset <name>]` — Show resolved AGENTS.md context for a preset or all enabled presets (**CLI-only**)

## SDD (Custom Workflows)

Manage custom SDD workflow definitions stored in `router/catalogs/`.

- `gsr sdd create <name> [--description <desc>]` — Create a new custom SDD (**CLI-only**)
- `gsr sdd list` — List all custom SDDs (**CLI-only**)
- `gsr sdd show <name>` — Show SDD phases, triggers, and metadata (**CLI-only**)
- `gsr sdd delete <name> [--yes]` — Delete a custom SDD (**CLI-only**)

## Role & Phase Contracts

Manage catalog-scoped contracts within a custom SDD.

- `gsr role create <name> --sdd <sdd>` — Create a role contract `.md` file (**CLI-only**)
- `gsr phase create <name> --sdd <sdd>` — Create a phase contract `.md` file (**CLI-only**)

## System

Global operational state and data sync.

- `/gsr-status` — Show router state, active preset, and resolved routes
- `/gsr-sync` — Full sync: contracts + overlay + slash commands + validate (idempotent)
