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


# Per-process call counter + cap for the thread dispatch path. Every
# dispatched call spawns a `claude --resume` subprocess that bills the
# user's account silently; unlike the sentinel path (naturally throttled
# by agent turn cadence) there's no organic budget choke. The cap is
# advisory — env-configurable, defaults generous — but returning None
# past the ceiling forces callers through the fallback/sentinel path
# so a runaway loop doesn't quietly burn a subscription.
_DISPATCH_THREAD_CALL_COUNT = 0
_DISPATCH_THREAD_CALL_CAP = int(os.environ.get("HME_THREAD_CALL_CAP", "50"))


def dispatch_thread(prompt: str, timeout_sec: float = 120.0) -> str | None:
    """Synchronously route a reasoning prompt through the persistent
    subagent session whose sid is recorded in tmp/hme-thread.sid.

    Used by synthesis_reasoning when a user has run `i/thread init` —
    every reasoning call (review reflection, OVERDRIVE cascade, etc.)
    flows into the same long-lived claude session so context
    accumulates across calls. The persistent session is observable
    via VSCode's Claude Code extension by resuming its sid.

    Returns the assistant's text reply (possibly empty) on success, or
    None if the thread path is unavailable / failed. Empty replies are
    a valid result — we return the empty string, NOT None — so callers
    don't re-bill by falling through to the ephemeral dispatch when the
    thread legitimately returned nothing. HME_THREAD_CHILD=1 prevents
    the spawned subprocess from re-entering our own stop hooks.
    alwaysThinkingEnabled=false keeps the response in a single
    transcript event so VSCode renders it correctly (with thinking on,
    response writes as two events sharing one msg_id and VSCode
    dedupes the second).
    """
    global _DISPATCH_THREAD_CALL_COUNT
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
        # Empty sid file is a silent-fall-through footgun — the user
        # ran `i/thread init` (or tried to) but the file is empty, so
        # every reasoning call looks like "no thread configured" with
        # no diagnostic. Warn once per occurrence.
        logger.warning(f"dispatch_thread: sid file {sid_file} exists but is empty "
                       "— run `i/thread init` to recreate, or `i/thread stop` to clear")
        return None

    # Budget cap — returning None past the ceiling forces fallback.
    if _DISPATCH_THREAD_CALL_COUNT >= _DISPATCH_THREAD_CALL_CAP:
        logger.warning(f"dispatch_thread: per-process cap reached "
                       f"({_DISPATCH_THREAD_CALL_COUNT}/{_DISPATCH_THREAD_CALL_CAP}) "
                       f"— falling through. Raise HME_THREAD_CALL_CAP to extend.")
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
        _DISPATCH_THREAD_CALL_COUNT += 1
    except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError) as e:
        logger.warning(f"dispatch_thread: failed: {type(e).__name__}: {e}")
        return None
    if result.returncode != 0:
        logger.warning(f"dispatch_thread: claude exited {result.returncode}: "
                       f"{(result.stderr or '')[:200]}")
        return None
    # Empty stdout on returncode=0 is a valid (if odd) result — e.g.
    # post-filter drop or the session replying with nothing. Preserve
    # it as-is so callers don't fall through and re-bill. Prior
    # behavior returned None on empty, which caused double-dispatch.
    out = (result.stdout or "").rstrip()
    logger.info(f"dispatch_thread: succeeded ({len(out)}c in {elapsed:.1f}s, "
                f"sid={sid[:8]}, call {_DISPATCH_THREAD_CALL_COUNT}/{_DISPATCH_THREAD_CALL_CAP})")
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
