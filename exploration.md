## Exploration: sdd-4 tribunal-logic

### Current State
Currently, `gentle-sdd-router` operates as a declarative router, but it is deeply bound to a single-agent or orchestrator-only overlay mechanism in OpenCode.
- **Skill Installation**: No `router/skills/` directory exists. The closest mechanism is `host-adoption` which copies `assets/host-skill/router-skill` to `.gsr/skills/router-skill`. There is no global skill installation into `~/.config/opencode/skills/`.
- **Tribunal Channel**: Cross-phase communication is currently done via Engram (`sdd-debug` contracts use `record_observation`/`search`). Cross-SDD invocation uses file-based IO via `.gsr/invocations/{id}.json`.
- **Schema & Phases**: `ALLOWED_LANE_ROLES` includes `judge` and `radar`, but `minister` is missing. The canonical phases support `judge` and `radar` as optional roles. Custom phase creation via the TUI editor currently hardcodes `agents: 1, judge: false, radar: false`.
- **Overlay Generation**: `src/adapters/opencode/overlay-generator.js` only generates **one** agent entry per profile (the orchestrator) in `opencode.json`. Sub-agents defined in a phase's `lanes` or `roles` are not materialized, making it impossible for the orchestrator to delegate to them via the OpenCode `task`/`delegate` tools.

### Affected Areas
- `router/skills/` (NEW) — needs to be created to house `tribunal-judge`, `tribunal-minister`, `tribunal-radar` skills.
- `src/core/unified-sync.js` — why: must deploy new Tribunal skills to `~/.config/opencode/skills/` during the `sync` pipeline.
- `src/core/router-schema-v3.js` — why: `ALLOWED_LANE_ROLES` must be expanded to include `minister`.
- `src/core/phases.js` — why: `minister` role should be added to `optionalRoles` where relevant (or replace `agent` in `fixedRoles`).
- `src/ux/tui/screens/sdd-phase-editor.js` — why: hardcoded single-agent defaults when creating custom phases need to support multi-agent configurations.
- `src/adapters/opencode/overlay-generator.js` — why: must be modified to iterate through a profile's phases and materialize `gsr-{profile}-judge`, `gsr-{profile}-minister-{N}`, etc. as distinct agents in `opencode.json` alongside the orchestrator.
- `src/core/sdd-invocation-io.js` (or new file) — why: might need to be extended into `tribunal-io.js` to support the file-based message debate channel.

### Approaches

1. **Native OpenCode Delegation with Materialized Agents (Recommended)** — Modify `overlay-generator.js` to extract all unique roles (`judge`, `radar`, `minister`) across all phases of a profile, and generate distinct agent entries for each in `opencode.json`. Inject the Tribunal skills into these agents. The orchestrator delegates using native OpenCode tools.
   - Pros: Leverages native OpenCode UI/UX for sub-agents; clear boundaries.
   - Cons: Expands `opencode.json` surface area significantly per profile.
   - Effort: Medium

2. **Engram-backed Debate Channel (Headless Sub-agents)** — Orchestrator spawns sub-agents as pure CLI background processes that communicate via Engram or `.gsr/tribunal/` files, bypassing `opencode.json`.
   - Pros: Keeps `opencode.json` clean; no UI clutter.
   - Cons: Sub-agents are invisible to the user; breaks the standard OpenCode agent paradigm; much harder to implement within a non-executing CLI router.
   - Effort: High

### Recommendation
**Approach 1** is highly recommended. It honors the "declarative, non-executing" boundary of the router by simply declaring the sub-agents in `opencode.json` and letting the host (OpenCode) handle the execution and delegation. `unified-sync.js` should deploy the Tribunal SKILL.md files to the host, and `overlay-generator.js` should generate the agent entries pointing to those skills.

### Risks
- **opencode.json Bloat**: Materializing `judge`, `radar`, and multiple `minister` agents for every profile could clutter the OpenCode sidebar. (Mitigation: use `hidden: true` for sub-agents so they don't clutter the UI but can still be delegated to).
- **Skill Collision**: Deploying skills to `~/.config/opencode/skills/` could overwrite user skills if not scoped properly (e.g., use a `gsr-` prefix for skills).
- **TUI Editor Limitations**: The `PhaseComposer` and `sdd-phase-editor.js` logic for `multi-agent` will need non-trivial updates to dynamically handle `minister-1`, `minister-2` instead of just `agent, agent`.

### Ready for Proposal
Yes. The current architectural gaps (overlay materialization, schema restrictions, and skill deployment) are clear. The orchestrator can proceed to the Propose phase using the recommended approach.