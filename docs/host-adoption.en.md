# Host Adoption

## Purpose

Install the router skill into host-owned files only. The router stays external, and the install/uninstall flow keeps user edits outside the managed block intact.
This document covers adoption only; active `/gsr` slash-command sync is a separate host-owned contract.

## Install

1. Call `installHostAdoption(hostRoot)` from the host integration layer.
2. The installer copies `assets/host-skill/router-skill/**` into `.gsr/skills/router-skill/`.
3. It inserts one managed guardrail block into `.gsr/policy/rules.md`.

## Uninstall

1. Call `uninstallHostAdoption(hostRoot)` from the host integration layer.
2. The uninstaller removes only the managed block, the tracked skill files, and the manifest.
3. It fails closed if the manifest, markers, or tracked hashes no longer match.

## Safety notes

- The flow fails closed if markers are missing, duplicated, or the tracked hashes do not match.
- User-authored text outside the managed block is preserved.
- `/gsr` TUI/slash-command integration is host-owned, external, and handled by the live session sync contract.
