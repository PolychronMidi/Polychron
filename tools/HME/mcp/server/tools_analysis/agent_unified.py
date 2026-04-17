"""HME agent tool — dispatches local agentic research via agent_local.run_agent().

Thin wrapper that exposes `mcp__HME__agent` to Claude. Internally uses
agent_local.py which now routes through synthesis_reasoning.call() (the
22-slot free-API cascade) with local llama-server as the final fallback.

Modes: 'explore' (code research), 'plan' (architecture planning). Matches
the existing pretooluse_agent.sh interception contract so the same modes
are reachable whether Claude invokes the native Agent tool (intercepted by
the shell hook) or calls mcp__HME__agent directly.
"""
import logging

from server import context as ctx
from . import _track, _budget_gate, BUDGET_COMPOUND

logger = logging.getLogger("HME")


@ctx.mcp.tool(meta={"hidden": True})
def agent(prompt: str, mode: str = "explore") -> str:
    """Run a local research subagent with best-available model routing.

    mode='explore' (default) — code research, grep/glob/read/kb tools, read-only.
    mode='plan'              — architecture planner, multi-file analysis synthesis.

    Model selection walks the 22-slot quality cascade (cerebras, groq, gemini,
    openrouter, mistral, nvidia) with circuit breakers, falling through to
    local qwen3-coder / reasoner only when every free-tier slot is exhausted.

    Returns the agent's final answer with a model label prefix so the caller
    can see which tier served the request.
    """
    _track("agent")
    if not prompt or len(prompt.strip()) < 4:
        return "Error: prompt must be at least 4 characters."
    if mode not in ("explore", "plan"):
        return f"Error: unknown mode '{mode}'. Use 'explore' or 'plan'."

    ctx.ensure_ready_sync()

    # agent_local lives at tools/HME/mcp/agent_local.py — one level above server/.
    import sys, os
    _mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if _mcp_root not in sys.path:
        sys.path.insert(0, _mcp_root)
    from agent_local import run_agent

    result = run_agent(prompt, project_root=ctx.PROJECT_ROOT, mode=mode)
    if not isinstance(result, dict):
        return f"Error: agent_local returned non-dict: {type(result).__name__}"

    answer = result.get("answer") or "(empty answer)"
    elapsed = result.get("elapsed_s", "?")
    iterations = result.get("iterations", "?")
    tools_used = result.get("tools_used", []) or []
    model = result.get("model", "?")

    header = (
        f"[HME Agent — mode={mode} model={model} iters={iterations} "
        f"tools={len(tools_used)} elapsed={elapsed}s]\n\n"
    )
    return _budget_gate(header + str(answer), budget=BUDGET_COMPOUND)
