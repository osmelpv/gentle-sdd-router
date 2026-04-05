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

## Preset

Manage routing presets.

- `gsr preset list` — List all routing presets with SDD/scope/visibility info (**CLI-only**)
- `gsr preset create <name>` — Create a new empty routing preset (**CLI-only**)
- `gsr preset show [name]` — Show routes for a preset (**CLI-only**)
- `gsr preset delete <name>` — Delete a preset (**CLI-only**)
- `gsr preset rename <old> <new>` — Rename a preset (**CLI-only**)
- `gsr preset copy <src> <dest>` — Clone a preset (**CLI-only**)
- `gsr preset export <name> [--compact]` — Export a preset for sharing (**CLI-only**)
- `gsr preset import <source>` — Import a preset from file/URL/gsr:// (**CLI-only**)

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

## Fallback

Model failure recovery commands.

- `/gsr-fallback` — Activate next model fallback after a GSR_FALLBACK_REQUEST.
  Auto-triggered when the agent detects a model failure: fires an SDK toast notification,
  reads connected providers from `config.providers()` to annotate each fallback with
  connection status badges, then presents the ordered fallback chain for selection.
  SDK usage is a progressive enhancement — degrades gracefully if unavailable.

- `/gsr-watchdog` — Check the watchdog status of active delegated tasks.
  Reads heartbeat data from Engram (if available) or `.gsr/watchdog/` (filesystem fallback).
  Shows: last heartbeat timestamp, elapsed time, alive/timeout status, last completed task,
  and the next fallback model if a timeout is detected. Use this when a sub-agent appears
  stuck and you want to diagnose whether it is still running or needs manual recovery.
