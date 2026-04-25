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


def dispatch_thread(prompt: str, timeout_sec: float = 120.0) -> str | None:
    """Synchronously route a reasoning prompt through the persistent
    subagent session whose sid is recorded in tmp/hme-thread.sid.

    Used by synthesis_reasoning when a user has run `i/thread init` —
    every reasoning call (review reflection, OVERDRIVE cascade, etc.)
    flows into the same long-lived claude session so context
    accumulates across calls. The persistent session is observable
    via VSCode's Claude Code extension by resuming its sid.

    Returns the assistant's text reply, or None on any failure
    (caller falls back to sentinel-bounce or direct ephemeral
    dispatch). HME_THREAD_CHILD=1 prevents the spawned subprocess
    from re-entering our own stop hooks. alwaysThinkingEnabled=false
    keeps the response in a single transcript event so VSCode
    renders it correctly (with thinking on, response writes as two
    events sharing one msg_id and VSCode dedupes the second).
    """
    project_root = os.environ.get("PROJECT_ROOT", "")
    if not project_root:
        return None
    sid_file = os.path.join(project_root, "tmp", "hme-thread.sid")
    if not os.path.isfile(sid_file):
        return None
    try:
        with open(sid_file, "r") as f:
            sid = f.read().strip()
    except OSError as e:
        logger.warning(f"dispatch_thread: read sid failed: {e}")
        return None
    if not sid:
        return None

    env = dict(os.environ)
    env["HME_THREAD_CHILD"] = "1"
    try:
        t0 = time.monotonic()
        result = subprocess.run(
            ["claude", "--resume", sid,
             "--settings", '{"alwaysThinkingEnabled":false}',
             "-p", prompt[:32000]],
            capture_output=True, text=True, timeout=timeout_sec, env=env,
        )
        elapsed = time.monotonic() - t0
    except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError) as e:
        logger.warning(f"dispatch_thread: failed: {type(e).__name__}: {e}")
        return None
    if result.returncode != 0:
        logger.warning(f"dispatch_thread: claude exited {result.returncode}: "
                       f"{(result.stderr or '')[:200]}")
        return None
    out = (result.stdout or "").strip()
    if not out:
        return None
    logger.info(f"dispatch_thread: succeeded ({len(out)}c in {elapsed:.1f}s, sid={sid[:8]})")
    return out


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
