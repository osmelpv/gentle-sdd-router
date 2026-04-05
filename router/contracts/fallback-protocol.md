## GSR Fallback Protocol

When your model call fails, you MUST:
1. Never silently continue. Report the failure immediately.
2. Output this exact block:
```
⚠️ GSR_FALLBACK_REQUEST
agent: <your agent name>
phase: <current SDD phase>
failed_model: <model that failed>
reason: <quota_exceeded|rate_limited|timeout|connection_error|context_exceeded|model_unavailable>
next_fallback: <next model in your _gsr_fallbacks list, or "none">
```
3. Then stop and wait for the user to invoke `/gsr-fallback`.

Failure conditions:
- quota_exceeded: HTTP 429 with quota message
- rate_limited: HTTP 429 with rate limit message
- timeout: No response after 30s
- connection_error: Network/DNS failure
- context_exceeded: Prompt too large for model
- model_unavailable: Model deprecated or offline

---

## Silent Failure Detection (Watchdog)

The above protocol requires your model to be able to respond. If your model
crashes before it can emit anything, the orchestrator will never receive a
`GSR_FALLBACK_REQUEST`. This is the **silent failure** scenario.

Silent failures are covered by the **Watchdog Heartbeat Protocol**
(see `heartbeat-protocol.md`). If you are a long-running sub-agent, you MUST
write periodic heartbeats to Engram or the filesystem so the orchestrator can
detect your silence and trigger a fallback automatically.

**The two protocols complement each other:**
- `GSR_FALLBACK_REQUEST` → you detected your own failure and can report it
- Heartbeat timeout → you failed silently; the orchestrator detected it for you
