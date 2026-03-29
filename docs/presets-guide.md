# Presets Guide

## What is a Preset?

A preset is a YAML file that defines which AI model handles each development phase. Each preset is a complete routing configuration — you can switch between them instantly.

## Built-in Presets

gsr ships with 7 presets optimized for different scenarios:

### multivendor (default)

The best model for each phase, across all providers. This is the recommended starting point.

| Phase | Model | Role | Fallback |
|-------|-------|------|----------|
| orchestrator | anthropic/claude-opus | primary | openai/gpt-5 |
| explore | google/gemini-pro | primary | anthropic/claude-sonnet |
| spec | anthropic/claude-opus | primary | openai/gpt-5 |
| design | anthropic/claude-opus | primary | openai/gpt-5 |
| tasks | anthropic/claude-sonnet | primary | openai/gpt |
| apply | anthropic/claude-sonnet | primary | openai/gpt-5 |
| verify | openai/gpt-5 | judge | anthropic/claude-opus |
| archive | google/gemini-flash | primary | anthropic/claude-haiku |

### claude

All Anthropic models. Best when you have a Claude API key and want consistent behavior.

### openai

All OpenAI models. Best for GPT-focused workflows with o3 for verification.

### multiagent

Two models per phase from different providers. Ensures diverse perspectives — the primary works, the judge/radar validates.

### ollama

All local models via Ollama (Qwen 3.5, QwQ, Devstral). Zero cloud costs, works offline. Great fallback when cloud tokens run out.

### cheap

Budget models with solid performance. Uses GPT-oss, Gemini Flash, and other cost-efficient options.

### heavyweight

Maximum depth: 5 lanes per phase (primary + secondary + local + judge + radar). Uses cloud heavyweights plus an Ollama model in every phase for redundancy.

## Switching Presets

```bash
gsr use multivendor    # best of each provider
gsr use ollama         # switch to local models
gsr use heavyweight    # maximum depth for critical work
```

## Creating Custom Presets

### Copy and modify

```bash
cp router/profiles/multivendor.router.yaml router/profiles/my-custom.router.yaml
```

Edit the file:

```yaml
name: my-custom
availability: stable
complexity: medium
phases:
  orchestrator:
    - target: anthropic/claude-opus
      kind: lane
      phase: orchestrator
      role: primary
      fallbacks: anthropic/claude-sonnet
  apply:
    - target: anthropic/claude-sonnet
      kind: lane
      phase: apply
      role: primary
      fallbacks: anthropic/claude-haiku
  verify:
    - target: openai/gpt-5
      kind: lane
      phase: verify
      role: judge
      fallbacks: openai/o3
```

Then activate it:

```bash
gsr use my-custom
```

### Multi-agent presets

Add multiple lanes per phase for cross-provider validation:

```yaml
phases:
  verify:
    - target: openai/gpt-5
      kind: lane
      phase: verify
      role: judge
      fallbacks: openai/o3
    - target: anthropic/claude-opus
      kind: lane
      phase: verify
      role: radar
      fallbacks: anthropic/claude-sonnet
```

## Sharing Presets

Presets are plain YAML files. Share them by:
1. Copying the file to another project's `router/profiles/` directory
2. Including them in version control
3. Sharing the YAML content directly

No credentials or secrets are included — only model routing declarations.

## The 8 Canonical Phases

| Phase | Purpose | Best model type |
|-------|---------|----------------|
| **orchestrator** | Coordinate work, make decisions | Strong reasoning (Opus, GPT-5) |
| **explore** | Investigate codebase, research | Large context (Gemini Pro) |
| **spec** | Write specifications | Strong writing + reasoning |
| **design** | Architecture decisions | Deep reasoning (Opus) |
| **tasks** | Break down into tasks | Fast, structured (Sonnet) |
| **apply** | Write code | Best coding model (Sonnet, GPT-5) |
| **verify** | Validate, find bugs | Different provider than apply (judge perspective) |
| **archive** | Document, close out | Fast, cheap (Flash, Haiku) |

## Rules of Thumb

- **Never use the same model for apply and verify** — cross-provider validation catches more issues
- **Gemini excels at exploration** (massive context) but avoid it for coding
- **GPT for verification** — strong at finding issues
- **Claude Sonnet for coding** — top SWE-Bench scores
- **Claude Opus for architecture** — deep reasoning
- **Cheap models for archive** — it's just documentation
