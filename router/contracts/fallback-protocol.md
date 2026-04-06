## GSR Fallback Protocol

On model failure: output this block, then stop and wait for `/gsr-fallback`:
```
⚠️ GSR_FALLBACK_REQUEST
agent: <name> | phase: <phase> | failed_model: <model>
reason: quota_exceeded|rate_limited|timeout|connection_error|context_exceeded|model_unavailable
next_fallback: <next model in _gsr_fallbacks, or "none">
```
