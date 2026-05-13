"""Direct server-side Agent dispatch.

ALTERNATIVE to the sentinel-bounce path (`_dispatch_via_subagent`).
Instead of emitting a `[[HME_AGENT_TASK ...]]` sentinel that the agent
must then actively dispatch via the Agent tool, we spawn a `claude -p`
subprocess directly from the MCP server and capture its stdout.

Tradeoffs vs sentinel-bounce:
  + Synchronous -- HME gets the reasoning result without a round-trip
    through the agent's turn.
  + No visual noise in the agent's tool_result.
  + Budget accounting is clearer (the CLI invocation spawned from here
    shows up as its own subprocess).
  - Requires `claude` CLI on PATH + authentication + permission to
    spawn subprocesses from the worker. Some sandboxed deployments
    may block this.
  - Loses the "agent chose to dispatch" escape hatch -- if the model
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

_CLAUDE_MODEL_BY_TIER = {
    "E1": "haiku",
    "E2": "haiku",
    "E3": "sonnet",
    "E4": "opus",
    "E5": "opus",
}
_LEGACY_TIER = {"easy": "E2", "medium": "E3", "hard": "E4"}


def _normalize_tier(tier: str) -> str:
    raw = (tier or "E3").strip()
    up = raw.upper()
    if up in _CLAUDE_MODEL_BY_TIER:
        return up
    return _LEGACY_TIER.get(raw.lower(), "E3")


def _claude_model_for_tier(tier: str) -> str:
    return _CLAUDE_MODEL_BY_TIER[_normalize_tier(tier)]


# Per-process cap for `claude --resume`; persisted count prevents restart-bypass.
_DISPATCH_THREAD_CALL_COUNT = 0
_DISPATCH_THREAD_CALL_CAP = int(os.environ.get("HME_THREAD_CALL_CAP", "50"))
_DISPATCH_THREAD_COUNT_TTL_SEC = 24 * 3600


def _count_file() -> str | None:
    root = os.environ.get("PROJECT_ROOT", "")
    return os.path.join(root, "tmp", "hme-buddy-call-count") if root else None


def _hydrate_call_count() -> None:
    """Read persisted counter on module load so restarts don't reset budget.
    Ignores stale files past TTL (assume runaway session ended)."""
    global _DISPATCH_THREAD_CALL_COUNT
    path = _count_file()
    if not path or not os.path.isfile(path):
        return
    try:
        with open(path, "r") as f:
            raw = f.read().strip()
        parts = raw.split(":")
        if len(parts) == 2:
            saved_ts = float(parts[0])
            saved_n = int(parts[1])
            if (time.time() - saved_ts) < _DISPATCH_THREAD_COUNT_TTL_SEC:
                _DISPATCH_THREAD_CALL_COUNT = saved_n
                logger.info(
                    f"dispatch_thread: hydrated call count from {path} "
                    f"(n={saved_n})"
                )
    except (OSError, ValueError) as e:
        logger.warning(f"dispatch_thread: count hydrate failed: "
                       f"{type(e).__name__}: {e}")


def _persist_call_count() -> None:
    """Atomic-rewrite the persisted counter. Called after each increment.
    Best-effort -- write failure is logged but does not block dispatch."""
    path = _count_file()
    if not path:
        return
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(f"{time.time()}:{_DISPATCH_THREAD_CALL_COUNT}")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError as e:
        logger.warning(f"dispatch_thread: count persist failed: "
                       f"{type(e).__name__}: {e}")


_hydrate_call_count()


def dispatch_thread(prompt: str, timeout_sec: float = 120.0,
                    tier: str = "E3") -> str | None:
    """Synchronously route a reasoning prompt through the buddy session
    whose sid is recorded in runtime/hme/buddy.sid (legacy: runtime/hme/thread.sid,
    one-time fallback during the rename window -- see code below).

    Used by synthesis_reasoning when the buddy system is active
    (.env BUDDY_SYSTEM=1, default). Sessionstart auto-inits the buddy
    via tools/HME/hooks/helpers/buddy_init.sh; every reasoning call
    (review reflection, OVERDRIVE cascade, suggest_evolution) flows
    into the same long-lived claude session so context accumulates
    across calls. The session is observable via VSCode's Claude Code
    extension by resuming its sid. See doc/BUDDY_SYSTEM.md.

    Returns the assistant's text reply (possibly empty) on success, or
    None if the thread path is unavailable / failed. Empty replies are
    a valid result -- we return the empty string, NOT None -- so callers
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
    # BUDDY_SYSTEM gate (default on). When .env sets BUDDY_SYSTEM=0 the
    # buddy is intentionally disabled even if a stale sid file exists.
    if os.environ.get("BUDDY_SYSTEM", "1") == "0":
        return None
    sid_file = os.path.join(project_root, "tmp", "hme-buddy.sid")
    # Back-compat: read the legacy hme-thread.sid path if present and
    # the new path isn't (one-time fallback during the rename window).
    if not os.path.isfile(sid_file):
        legacy = os.path.join(project_root, "tmp", "hme-thread.sid")
        if os.path.isfile(legacy):
            sid_file = legacy
        else:
            return None
    try:
        with open(sid_file, "r") as f:
            sid = f.read().strip()
    except OSError as e:
        logger.warning(f"dispatch_thread: read sid failed: {e}")
        return None
    if not sid:
        # Empty sid file = silent-fall-through footgun (mid-write fail or
        # manual clear). Recovery: rm the file (next sessionstart re-inits)
        # or set .env BUDDY_SYSTEM=0 to disable the buddy.
        logger.warning(f"dispatch_thread: sid file {sid_file} exists but is empty "
                       "-- rm the file (next sessionstart re-inits) or set "
                       ".env BUDDY_SYSTEM=0 to disable the buddy")
        return None

    # Budget cap -- returning None past the ceiling forces fallback.
    if _DISPATCH_THREAD_CALL_COUNT >= _DISPATCH_THREAD_CALL_CAP:
        logger.warning(f"dispatch_thread: per-process cap reached "
                       f"({_DISPATCH_THREAD_CALL_COUNT}/{_DISPATCH_THREAD_CALL_CAP}) "
                       f"-- falling through. Raise HME_THREAD_CALL_CAP to extend.")
        return None

    env = dict(os.environ)
    env["HME_THREAD_CHILD"] = "1"
    # Count BEFORE spawn so TimeoutExpired (most expensive failure mode)
    # still increments. The cap bounds subprocess spawns, not successes.
    _DISPATCH_THREAD_CALL_COUNT += 1
    _persist_call_count()
    try:
        t0 = time.monotonic()
        result = subprocess.run(
            ["claude", "--resume", sid,
             "--model", _claude_model_for_tier(tier),
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
    # Preserve empty successful replies so callers don't re-dispatch and double-bill.
    out = (result.stdout or "").rstrip()
    logger.info(f"dispatch_thread: succeeded ({len(out)}c in {elapsed:.1f}s, "
                f"sid={sid[:8]}, call {_DISPATCH_THREAD_CALL_COUNT}/{_DISPATCH_THREAD_CALL_CAP})")
    return out


def dispatch_direct(prompt: str, system: str, max_tokens: int,
                    subagent_type: str = "general-purpose",
                    timeout_sec: float = 90.0,
                    tier: str = "E3") -> str | None:
    """Spawn `claude -p` with the given prompt, capture stdout, return text.

    Returns the raw text output or None on any failure. Callers treat None
    as "fall back to sentinel-bounce path".
    """
    if os.environ.get("OVERDRIVE_DIRECT_AGENT") != "1":
        return None  # feature-flag gated
    # Assemble a minimal settings JSON that requests the subagent type
    # HME wants for this task. `alwaysThinkingEnabled` left off -- HME
    # reasoning prompts typically don't need thinking blocks.
    settings = json.dumps({"subagent_type": subagent_type})
    # Claude CLI consumes `-p` with prompt as final positional arg.
    # stream-json isn't needed here -- we want the blocking final result.
    try:
        t0 = time.monotonic()
        result = subprocess.run(
            ["claude", "-p", "--model", _claude_model_for_tier(tier),
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
