# Skill Registry — gentle-sdd-router

Generated: 2026-03-31

## User-Level Skills (`~/.config/opencode/skills/`)

| Skill | Trigger |
|-------|---------|
| branch-pr | When creating a pull request, opening a PR, or preparing changes for review |
| go-testing | When writing Go tests, using teatest, or adding test coverage |
| issue-creation | When creating a GitHub issue, reporting a bug, or requesting a feature |
| judgment-day | When user says "judgment day", "review adversarial", "dual review", "juzgar" |
| sdd-apply | When the orchestrator launches you to implement one or more tasks from a change |
| sdd-archive | When the orchestrator launches you to archive a change after implementation |
| sdd-design | When the orchestrator launches you to write or update the technical design |
| sdd-explore | When the orchestrator launches you to think through a feature or investigate |
| sdd-init | When user wants to initialize SDD in a project, or says "sdd init" |
| sdd-propose | When the orchestrator launches you to create or update a proposal |
| sdd-spec | When the orchestrator launches you to write or update specs |
| sdd-tasks | When the orchestrator launches you to create or update task breakdown |
| sdd-verify | When the orchestrator launches you to verify a completed change |
| skill-creator | When user asks to create a new skill or document patterns for AI |
| skill-registry | When user says "update skills", "skill registry", "update registry" |

## Project-Level Skills

None detected.

## Project Conventions (from AGENTS.md)

- **Canonical config**: `router/router.yaml` is the source of truth
- **Boundary**: Router is external, non-executing, report-only
- **Workflow**: Follow SDD phases defined globally; no implementation without prior design
- **Scope limits**: No provider/agent execution; no UI unless strictly necessary
- **Tests**: All changes must have minimum verifiable coverage
- **Pre-implementation**: Verify boundary non-executing before archiving
- **Global ecosystem**: `gentle-ai` is the canonical reference for persona, SDD, Engram, conventions

## Referenced Instruction Files

- `AGENTS.md` — Project-level agent rules (gitignored, generated per-machine)
- `router/AGENTS.md` — Sub-tree rules for `router/` (does not override root)
