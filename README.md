# gentle-sdd-router

SDD phase-aware AI routing layer with profile-driven model selection, fallback chains, and hybrid local/online execution.

---

## Overview

`gentle-sdd-router` is an optional routing layer designed to sit on top of modern AI agent ecosystems.

It introduces a **profile-driven approach** to model selection, allowing each phase of an SDD workflow to dynamically resolve the best available model at runtime.

Instead of binding phases to fixed models, this router enables flexible, resilient, and adaptive execution across providers and environments.

---

## Core Concepts

### Profiles

Profiles define how routing behaves.

A profile may represent:
- hybrid (local + online)
- offline
- cheap / budget
- premium / high-quality
- custom user strategies

Profiles are fully user-defined and can be switched dynamically.

---

### Phase-Aware Routing

The router understands SDD phases such as:

- orchestrator
- explore
- spec
- design
- apply
- verify

Each phase resolves models independently using a priority chain.

---

### Fallback Chains

Each phase can define multiple models:

sdd-apply:
1: ollama/qwen
2: anthropic/sonnet
3: openai/gpt


If a model fails, degrades, or becomes unavailable, the router automatically moves to the next option.

---

### Hybrid Execution

Profiles can mix:
- local models (Ollama)
- online providers (OpenAI, Anthropic, Google, etc.)

This enables cost optimization and resilience.

---

### Decoupling

Agents do not need to know which model is being used.

They interact with stable aliases like:

router/sdd-apply
router/sdd-verify


The router resolves the actual model behind the scenes.

---

## Command Interface

The router exposes a CLI that can be used:

- directly by the user
- indirectly by an agent (via natural language → command mapping)

Example commands:

gsr use <profile>
gsr reload
gsr status
gsr list


This allows seamless integration with agent-driven workflows.

---

## Design Principles

- Profile-driven, not mode-driven
- Agent-agnostic
- SDD-aware
- Non-invasive
- Fallback-first
- Hybrid-ready
- CLI-first design

---

## Goals (v1)

- Profile-based routing system
- Per-phase model resolution
- Fallback chains per phase
- Hybrid (local + online) support
- CLI for profile switching and control
- Compatibility with existing agent ecosystems

---

## Status

🚧 Early stage — architecture and design in progress.
