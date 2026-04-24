"""Direct server-side Agent dispatch.

ALTERNATIVE to the sentinel-bounce path (`_dispatch_via_subagent`).
Instead of emitting a `[[HME_AGENT_TASK …]]` sentinel that the agent
must then actively dispatch via the Agent tool, we spawn a `claude -p`
subprocess directly from the MCP server and capture its stdout.

Tradeoffs vs sentinel-bounce:
  + Synchronous — HME gets the reasoning result without a round-trip
    through the agent's turn.
  + No visual noise in the agent's tool_result.
  + Budget accounting is clearer (the CLI invocation spawned from here
    shows up as its own subprocess).
  - Requires `claude` CLI on PATH + authentication + permission to
    spawn subprocesses from the worker. Some sandboxed deployments
    may block this.
  - Loses the "agent chose to dispatch" escape hatch — if the model
    judges the reasoning task trivial and wants to answer directly,
    it can't (we went around it).

MVP: function signature + implementation. Caller (synthesis_reasoning)
can opt into this path when env `OVERDRIVE_DIRECT_AGENT=1`. Falls back
to sentinel-bounce on any failure.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time

logger = logging.getLogger("HME")


def dispatch_direct(prompt: str, system: str, max_tokens: int,
                    subagent_type: str = "general-purpose",
                    timeout_sec: float = 90.0) -> str | None:
    """Spawn `claude -p` with the given prompt, capture stdout, return text.

    Returns the raw text output or None on any failure. Callers treat None
    as "fall back to sentinel-bounce path".
    """
    if os.environ.get("OVERDRIVE_DIRECT_AGENT") != "1":
        return None  # feature-flag gated
    # Assemble a minimal settings JSON that requests the subagent type
    # HME wants for this task. `alwaysThinkingEnabled` left off — HME
    # reasoning prompts typically don't need thinking blocks.
    settings = json.dumps({"subagent_type": subagent_type})
    # Claude CLI consumes `-p` with prompt as final positional arg.
    # stream-json isn't needed here — we want the blocking final result.
    try:
        t0 = time.monotonic()
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet",
             "--system-prompt", system[:6000],
             "--settings", settings,
             prompt[:32000]],
            capture_output=True, text=True, timeout=timeout_sec,
        )
        elapsed = time.monotonic() - t0
    except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError) as e:
        logger.warning(f"agent_direct: dispatch failed: {type(e).__name__}: {e}")
        return None
    if result.returncode != 0:
        logger.warning(f"agent_direct: claude exited {result.returncode}: "
                       f"{(result.stderr or '')[:200]}")
        return None
    out = (result.stdout or "").strip()
    if not out:
        return None
    logger.info(f"agent_direct: succeeded ({len(out)}c in {elapsed:.1f}s, "
                f"subagent_type={subagent_type})")
    return out
