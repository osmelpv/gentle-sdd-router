---
name: radar-context-protocol
description: >
  Protocol for how radar's findings are structured and fed to the judge.
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: global
---

## Radar Judge Communication Format

```markdown
## Radar Report

### Critical Findings (address immediately)
- **[CRITICAL-1]**: {finding} | Location: {file/area} | Impact: {what breaks}

### High Priority (integrate into synthesis)
- **[HIGH-1]**: {finding} | Location: {file/area} | Impact: {what's at risk}

### Medium Priority (consider during synthesis)
- **[MED-1]**: {finding} | Location: {file/area} | Note: {why it matters}

### Low Priority (note for future)
- **[LOW-1]**: {finding} | Location: {file/area}

### Unrelated Observations
- **[UNRELATED-1]**: {finding} | Note: {spotted while scanning, not in scope}
```

## Integration Rules

1. Judge MUST address all CRITICAL findings in the final synthesis
2. Judge SHOULD integrate HIGH findings unless explicitly justified
3. Judge MAY skip MEDIUM and LOW findings with a note in the Dissent Log
4. Unrelated observations go into Engram as separate observations (not into the synthesis)

## Timing

- Radar runs IN PARALLEL with agents (not after them)
- Radar report is delivered to judge BEFORE synthesis starts
- Judge uses radar findings to formulate better brainstorm/confrontation questions
