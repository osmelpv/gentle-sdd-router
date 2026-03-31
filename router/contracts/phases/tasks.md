---
name: tasks
phase_order: 6
description: Breaks design into ordered task checklist, then writes TDD tests that fail.
alwaysMono: true
---

## Composition

| Role | Fixed/Optional | Count | Notes |
|------|---------------|-------|-------|
| agent | Fixed | 1 | ALWAYS mono. Sequential task writing + TDD test authoring. |

## Execution Mode
Default: `sequential` — ONE agent. No parallelism. No judge. No exceptions.

## Judge Decision Contract
N/A — This phase is always mono.

## TDD Protocol

This phase has TWO sequential steps performed by the SAME agent:

### Step 1: Task Breakdown
- Read design decisions and spec requirements
- Break implementation into ordered, atomic tasks
- Each task must be independently verifiable
- Mark tasks with `- [ ]` checkboxes in tasks.md

### Step 2: TDD Test Writing
- For each task, write one or more tests that define "done"
- Tests MUST FAIL at write time (no implementation exists yet)
- Tests become the acceptance criteria for the apply phase

## Phase Input
- Design phase output (architecture, interfaces, decisions)
- Spec requirements and scenarios (acceptance criteria source)

## Phase Output
- Ordered task checklist in tasks.md (all unchecked)
- Test files with failing tests, one per task minimum
- Manifest: test file to task to spec requirement mapping
