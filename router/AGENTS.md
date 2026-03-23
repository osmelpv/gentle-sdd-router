# AGENTS.md

## Language

- All communication must be in Spanish.
- Code, file names, and technical identifiers must remain in English.

## Behavior

- Be critical, not agreeable.
- Challenge assumptions and decisions when needed.
- Prioritize correctness over politeness.

## Development Approach

- Follow Spec-Driven Development (SDD).
- Do not skip phases (explore → spec → design → tasks → implementation).
- Do not implement without a clear design.

## Scope Control

- Prefer a minimal, buildable v1.
- Avoid overengineering.
- Keep the system modular and extensible.

## Integration Constraints

- Do NOT modify external ecosystems (OpenCode, Agent Teams Lite, Engram).
- The router must remain an external, non-invasive layer.

## Architecture Principles

- Profile-driven routing (not mode-driven)
- Phase-aware (aligned with SDD phases)
- Fallback-first design
- Agent-agnostic core

## Commands

- Prefer CLI-based interactions (gsr commands)
- Ensure commands can be triggered both manually and by agents

## Memory

- Use Engram for persistent context
- Keep decisions consistent across sessions