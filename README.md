gentle-sdd-router

SDD phase-aware AI routing layer with dynamic model selection, fallback chains, and hybrid local/online execution.

Overview

gentle-sdd-router is an optional routing layer designed to sit on top of modern AI agent ecosystems (such as those using SDD workflows).

Instead of binding each phase of the development process to a fixed model, this router enables:

Dynamic model selection per SDD phase
Fallback chains (1 → 2 → 3) for reliability
Hybrid execution (local models + online providers)
Decoupling agent logic from model infrastructure
Why

In multi-agent SDD workflows, each phase (explore, spec, design, apply, verify, etc.) has different requirements.

However, current setups typically:

Hardcode a single model per phase
Break when a provider fails or degrades
Require manual switching between environments

This project aims to solve that by introducing a routing layer that:

Understands SDD phases
Selects the best available model dynamically
Handles failure, latency, and provider issues transparently
Goals (v1)
Provide per-phase routing (SDD-aware)
Support fallback chains per phase
Enable hybrid mode (local + online)
Integrate cleanly with existing agent ecosystems
Remain fully optional and non-invasive
Status

🚧 Early stage — design and architecture in progress.
