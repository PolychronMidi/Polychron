# mcp/server/tools_analysis/synthesis

Local synthesis backends for HME's agent layer. One backend per file: `synthesis_llamacpp.py`, `synthesis_gemini.py`, `synthesis_groq.py`, `synthesis_openrouter.py`, `synthesis_cerebras.py`, `synthesis_mistral.py`, `synthesis_nvidia.py`, plus `synthesis_config.py` (registry), `synthesis_session.py` (per-session state), `synthesis_warm.py` (warm-context priming), `synthesis_cascade.py` (cascade prediction), `synthesis_pipeline.py` (pipeline orchestration), `synthesis_inference.py` (inference entry), `synthesis_reasoning.py` (reasoning wrappers).

Backends self-register at import; `synthesis_config.ACTIVE_BACKEND` selects the runtime default. Timeouts must be generous — advanced local reasoning legitimately takes minutes. Any timeout-on-failure pattern MUST write to `log/hme-errors.log` so LIFESAVER surfaces silent backend issues at the next turn (R32 lesson).

<!-- HME-DIR-INTENT
rules:
  - Synthesis timeouts must be generous (minutes); any timeout-failure must append to log/hme-errors.log so LIFESAVER surfaces (R32)
  - New backends self-register on import; never add to a dispatch table — synthesis_config.ACTIVE_BACKEND is the single selector
-->
