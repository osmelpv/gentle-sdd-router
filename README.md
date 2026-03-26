# gentle-sdd-router

`gsr` is a non-executing CLI router for SDD adoption, YAML control, and OpenCode boundary reports.

## Boundary

- external router boundary, non-executing.
- `router/router.yaml` is the source of truth.
- Schema `v1` keeps classic profile routing.
- Schema `v3` adds multimodel browse/compare metadata.
- Host adoption is a separate host-local concern; the router core stays external and agnostic.

## What it does

- reads and writes `router/router.yaml`
- selects profiles and toggles activation
- resolves phase routes and fallback chains
- browses and compares shareable multimodel metadata from schema v3
- reports OpenCode compatibility without running providers or models

## What it does not do

- does not execute models, providers, or agent orchestration.
- does not own runtime behavior; `gentle-ai` and `agent-teams-lite` do
- does not require reinstalling when control changes
- exposes `/gsr` session-sync metadata for the active host TUI, but slash-command registration stays host-owned and non-executing.

## Host Adoption

- `docs/host-adoption.en.md` and `docs/host-adoption.es.md` describe host-local install/uninstall.
- host adoption installs only the packaged `router-skill` payload and a managed guardrail block.
- uninstall is manifest-backed and fails closed on ambiguity or hash mismatch.
- user edits outside the managed block remain untouched.

## Quickstart

### Minimal v1 setup

Save this as `router/router.yaml`:

```yaml
version: 1
active_profile: default
profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
      explore:
        - openai/gpt-4o-mini
```

Then run:

```bash
gsr status
gsr list
gsr render opencode
```

Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing.

### Multimodel v3 example

```yaml
version: 3
active_catalog: default
active_preset: balanced
active_profile: balanced
activation_state: active
catalogs:
  default:
    availability: stable
    presets:
      balanced:
        aliases: latest
        complexity: high
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet
              fallbacks: openai/gpt
      focused:
        availability: beta
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: openai/gpt
              fallbacks: anthropic/claude-sonnet
```

Then run:

```bash
gsr browse default/balanced
gsr compare default/balanced default/focused
```

## Multimodel browse/compare

Multimodel browse/compare expose shareable schema v3 metadata only.

- `gsr browse [selector]` inspects shareable schema v3 metadata with explicit visibility flags for availability, pricing, labels, and guidance.
- `gsr compare <left> <right>` compares two shareable projections without recommendation, execution, or orchestration behavior.
- The public view is metadata-only: policy flags stay read-only and the browse surface redacts hidden fields instead of inferring choices.

## Commands

- `gsr use <profile>` — Select the active profile in router/router.yaml without changing who is in control.
- `gsr reload` — Reload the current config and print resolved routes.
- `gsr status` — Show who is in control, how to toggle it, the active profile, and resolved routes.
- `gsr list` — List available profiles and mark the active one.
- `gsr browse [selector]` — Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.
- `gsr compare <left> <right>` — Compare two shareable multimodel projections without recommending or executing anything.
- `gsr install [--intent ...]` — Inspect or apply a YAML-first install intent to router/router.yaml.
- `gsr bootstrap [--intent ...]` — Show or apply a step-by-step bootstrap path for adoption.
- `gsr activate` — Take control of routing without changing the active profile.
- `gsr deactivate` — Hand control back to Alan/gentle-ai without changing the active profile.
- `gsr render opencode` — Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.
- `gsr help [command]` — Show help for all commands or one command.

## Examples

```bash
gsr status
gsr list
gsr render opencode
```

## Boundary Notes

- install/bootstrap validate, propose, or apply YAML updates; they do not run models
- control changes do not require reinstalling
- Compatibility: router.yaml version 1 and 3 are supported; v3 powers multimodel browse/compare.
- compatibility is explicit: schema v1 and v3 are supported, and v3 powers multimodel browse/compare
- compatibility states are reported honestly as supported, limited, or unsupported
- fallback behavior is surfaced as route resolution, not execution
- browse/compare visibility flags are explicit for availability, pricing, labels, and guidance; hidden metadata stays redacted
- render opencode also surfaces a multimodel orchestration manager plan that only labels split/dispatch/merge/judge/radar steps

## Host Adoption

- host-local adoption lives outside the router CLI; it installs the router skill into `.gsr/skills/router-skill/` and manages one guarded block in `.gsr/policy/rules.md`
- install/uninstall use a manifest plus `<!-- gsr:managed:start -->` / `<!-- gsr:managed:end -->` markers so user edits outside the block stay untouched
- safe uninstall fails closed on missing or duplicate markers, hash mismatches, or ambiguous ownership
- bilingual guides live in `docs/host-adoption.en.md` and `docs/host-adoption.es.md`
- `/gsr` TUI/slash-command integration is host-owned and live-synced separately from host adoption; the router only publishes the declarative contract
- Host sync: /gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing.

## Adoption Contract

- stable: config discovery, profile selection, status/list, browse/compare, and report-only boundary views
- stable: configuration-backed OpenCode reporting on Linux/WSL
- out of scope: provider execution, agent orchestration, and publish/release automation

## Configuration Limits

The bundled YAML parser is intentionally small. It supports the subset used by `router/router.yaml`: mappings, sequences, nested objects, strings, numbers, booleans, and null-like values.

It does not aim to be a full YAML implementation, so advanced YAML features such as anchors, tags, multiline scalars, and complex flow syntax are out of scope for v1.

## Release Notes

This package stays docs-and-metadata focused: it is release-polished for adoption, but it still delegates all runtime and orchestration work to the consumer boundary.
