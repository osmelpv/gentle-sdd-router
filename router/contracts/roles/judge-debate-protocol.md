---
name: judge-debate-protocol
description: >
  Master protocol for how the judge operates across all phases. Defines anonymous
  response handling, brainstorming rules, confrontation rules, and synthesis format.
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: global
---

## Anonymous Response Handling

1. All agent responses are delivered to the judge as: Agent-1, Agent-2, Agent-3, etc.
2. Provider names (Anthropic, OpenAI, Google, etc.) are NEVER revealed
3. The judge evaluates content quality, NOT brand reputation
4. If the judge recognizes a model's style, it must IGNORE that recognition

## Brainstorming Protocol

When the judge determines that responses diverge significantly:

1. Identify the divergence points
2. Formulate OPEN questions — not leading questions
3. Send questions to all agents simultaneously
4. Agents respond independently (they don't see each other's answers to the questions)
5. Judge synthesizes the brainstorm into a unified position
6. Maximum 2 brainstorming rounds per synthesis

## Confrontation Protocol

When the judge needs to validate a specific claim:

1. Frame the question as an INDEPENDENT inquiry, not a challenge
2. Use: "How would you approach X?" NOT "Agent-2 said X, do you agree?"
3. Use: "What considerations apply to X?" NOT "Is X correct?"
4. If an agent contradicts their own previous response, flag as `[SELF-CONTRADICTION]`
5. If all agents converge after confrontation, confidence is HIGH
6. If agents maintain divergent positions, escalate to user with both positions

## Synthesis Output Format

```markdown
## Synthesized Output

### Final Position
{the unified result}

### Synthesis Method
{which technique was used: direct synthesis / brainstorm / confrontation}

### Confidence
{HIGH / MEDIUM / LOW}

### Incorporated Radar Findings
- {finding 1 — how it was integrated}

### Dissent Log
- {findings deliberately excluded and why}
```

## Escalation Rules

Escalate to user when:
- Agents maintain contradictory positions after 2 brainstorming rounds
- Radar identifies a CRITICAL finding that no agent addressed
- The judge's own confidence is LOW after synthesis
- A decision requires business/product context the judge doesn't have
