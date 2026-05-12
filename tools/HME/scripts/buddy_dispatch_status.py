"""Buddy dispatch -- status command + transcript inspection helpers.

Extracted from buddy_dispatcher.py (was lines 1441-1668). buddy_handoff.py
imports `_transcript_path_for_sid` and `_buddy_context_used` from here
(via the re-export shim in buddy_dispatcher.py).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# Project-relative bootstrap (mirrors buddy_dispatcher.py).
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from buddy_dispatcher import (  # noqa: E402
    TIER_TO_EFFORT,
    QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_DONE, QUEUE_FAILED,
    _list_buddies, _ensure_dirs,
    _BUDDY_SYSTEM_FLAG, _DISPATCH_MODE, _SYNTHESIS_TIERS,
)


def _transcript_path_for_sid(sid: str) -> Path | None:
    """Locate the Claude Code transcript JSONL for a given session id.

    Claude Code writes transcripts at
    ~/.claude/projects/<cwd-slug>/<sid>.jsonl
    where <cwd-slug> is the cwd path with '/' replaced by '-'. Buddies
    are spawned from PROJECT_ROOT, so we look there first.
    """
    if not sid:
        return None
    home = Path(os.environ.get("HOME", "/home/jah"))
    cwd_slug = "-" + str(PROJECT_ROOT).strip("/").replace("/", "-")
    candidate = home / ".claude" / "projects" / cwd_slug / f"{sid}.jsonl"
    if candidate.exists():
        return candidate
    # Fallback: scan all project dirs (covers rare cwd variations).
    proj_root = home / ".claude" / "projects"
    if proj_root.exists():
        for p in proj_root.glob(f"*/{sid}.jsonl"):
            return p
    return None


def _buddy_context_used(sid: str) -> dict | None:
    """Walk a buddy's transcript JSONL and report current context use.

    Returns {"tokens": int, "ctx_window": int, "used_pct": float,
    "transcript": str, "lines": int} or None if no transcript / no usage
    data. The "tokens" field sums input + cache_creation + cache_read
    from the most recent assistant event with a non-empty usage block --
    that is the authoritative count of context the model just saw.

    Context window defaults to 1_000_000 (Opus 4.7 1M context). Override
    via env HME_BUDDY_CTX_WINDOW for sessions running smaller models.
    """
    path = _transcript_path_for_sid(sid)
    if path is None:
        return None
    try:
        ctx_window = int(os.environ.get("HME_BUDDY_CTX_WINDOW", "1000000"))
    except (TypeError, ValueError):
        ctx_window = 1_000_000
    last_usage = None
    line_count = 0
    try:
        with path.open() as f:
            for line in f:
                line_count += 1
                if '"type":"assistant"' not in line and '"type": "assistant"' not in line:
                    continue
                try:
                    ev = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if ev.get("type") != "assistant":
                    continue
                # Boundary read of external transcript JSON: explicit
                # isinstance checks so malformed entries (string instead
                # of dict, etc.) skip the line rather than silently
                # being coerced to {} via `or {}`.
                msg = ev.get("message")
                if not isinstance(msg, dict):
                    continue
                u = msg.get("usage")
                if not isinstance(u, dict):
                    continue
                if (u.get("input_tokens") is not None
                        or u.get("cache_creation_input_tokens") is not None
                        or u.get("cache_read_input_tokens") is not None):
                    last_usage = u
    except (OSError, IOError):
        return None
    if last_usage is None:
        return {"tokens": 0, "ctx_window": ctx_window, "used_pct": 0.0,
                "transcript": str(path), "lines": line_count}

    def _int_or_zero(val):
        # None / missing -> 0; numeric strings parse normally; other
        # non-numeric values raise (fail-fast on malformed transcript).
        if val is None:
            return 0
        return int(val)

    tokens = (_int_or_zero(last_usage.get("input_tokens"))
              + _int_or_zero(last_usage.get("cache_creation_input_tokens"))
              + _int_or_zero(last_usage.get("cache_read_input_tokens")))
    pct = (tokens / ctx_window * 100.0) if ctx_window > 0 else 0.0
    return {"tokens": tokens, "ctx_window": ctx_window, "used_pct": pct,
            "transcript": str(path), "lines": line_count}


def _discover_buddy_sessions() -> list[dict]:
    """List ALL spawned buddy sessions from tmp/hme-buddy*.sid files,
    independent of HME_DISPATCH_MODE. The dispatcher's task-routing view
    (`_list_buddies`) substitutes a synthesis pseudo-worker when
    HME_DISPATCH_MODE=synthesis, but the actual buddy sessions spawned
    by buddy_init.sh are still running and consuming context regardless
    of how tasks route. Status display always wants the real sessions
    so the user can monitor compactions.
    """
    from buddy_dispatcher import _translate_legacy_tier
    sessions = []
    tmp = PROJECT_ROOT / "tmp"
    # Missing-floor fallback is E2 (dynamic). Mirrors _read_floor_pair.
    legacy = tmp / "hme-buddy.sid"
    if legacy.exists() and legacy.read_text().strip():
        floor_file = legacy.with_suffix(".floor")
        effort_file = legacy.with_suffix(".effort_floor")
        raw_floor = floor_file.read_text().strip() if floor_file.exists() else "E2"
        m_floor = _translate_legacy_tier(raw_floor)
        e_floor = effort_file.read_text().strip() if effort_file.exists() else TIER_TO_EFFORT.get(m_floor, "low")
        sessions.append({"slot": 1, "sid": legacy.read_text().strip(),
                         "floor": m_floor, "effort_floor": e_floor,
                         "sid_file": str(legacy)})
        return sessions
    for sid_file in sorted(tmp.glob("hme-buddy-[0-9]*.sid")):
        sid = sid_file.read_text().strip() if sid_file.exists() else ""
        if not sid:
            continue
        try:
            slot = int(sid_file.stem.rsplit("-", 1)[1])
        except (ValueError, IndexError):
            continue
        floor_file = sid_file.with_suffix(".floor")
        effort_file = sid_file.with_suffix(".effort_floor")
        raw_floor = floor_file.read_text().strip() if floor_file.exists() else "E2"
        m_floor = _translate_legacy_tier(raw_floor)
        e_floor = effort_file.read_text().strip() if effort_file.exists() else TIER_TO_EFFORT.get(m_floor, "low")
        sessions.append({"slot": slot, "sid": sid,
                         "floor": m_floor, "effort_floor": e_floor,
                         "sid_file": str(sid_file)})
    return sessions


def cmd_status(args: argparse.Namespace) -> int:
    """Print current queue state + active buddies + dispatch mode.

    With --json, write a structured snapshot to tmp/hme-buddy-session-log.json
    (and stdout) that includes per-buddy sid + used context %. The log
    file is overwritten each call -- caller can poll it to monitor every
    buddy's context usage and prepare for compactions.
    """
    _ensure_dirs()
    pending = list(QUEUE_PENDING.glob("*.json"))
    processing = list(QUEUE_PROCESSING.rglob("*.json"))
    done = list(QUEUE_DONE.glob("*.json"))
    failed = list(QUEUE_FAILED.glob("*.json"))
    workers = _list_buddies()
    sessions = _discover_buddy_sessions()
    snapshot = {
        "ts": time.time(),
        "dispatch_mode": _DISPATCH_MODE,
        "buddy_system": _BUDDY_SYSTEM_FLAG,
        "queue": {"pending": len(pending), "processing": len(processing),
                  "done": len(done), "failed": len(failed)},
        "buddies": [],
    }
    print(f"dispatch_mode: {_DISPATCH_MODE} (BUDDY_SYSTEM={_BUDDY_SYSTEM_FLAG})")
    print(f"queue: pending={len(pending)} processing={len(processing)} done={len(done)} failed={len(failed)}")
    if _DISPATCH_MODE == "synthesis":
        print("workers: 1 synthesis-reasoning pseudo-buddy (no SID; routes through HME synthesis cascade)")
    elif _DISPATCH_MODE == "disabled":
        print("dispatcher disabled -- set BUDDY_SYSTEM=1 OR HME_DISPATCH_MODE=synthesis in .env to activate")
    elif workers:
        real = [w for w in workers if w.get("sid") != "synthesis"]
        synth_present = any(w.get("sid") == "synthesis" for w in workers)
        if synth_present and _SYNTHESIS_TIERS:
            tiers = ",".join(sorted(_SYNTHESIS_TIERS))
            print(f"workers: {len(real)} claude-resume + 1 synthesis pseudo "
                  f"(per-tier routing: synthesis={tiers}, others=claude-resume)")
        else:
            print(f"workers: {len(real)} active claude-resume slot(s)")
    if sessions:
        print(f"buddy sessions: {len(sessions)} spawned (sid files present)")
        for b in sessions:
            sid_preview = b["sid"][:16] if b["sid"] else "<unset>"
            ctx = _buddy_context_used(b["sid"]) if b["sid"] else None
            if ctx is None:
                ctx_str = "ctx=?  (no transcript)"
            else:
                bar_width = 10
                filled = int(round(ctx["used_pct"] / 100.0 * bar_width))
                bar = "#" * filled + "." * (bar_width - filled)
                ctx_str = (f"ctx={ctx['tokens']:>7,}/{ctx['ctx_window']:,} "
                           f"[{bar}] {ctx['used_pct']:5.1f}%")
            print(f"  slot={b['slot']} floor={b['floor']:<6} effort_floor={b['effort_floor']:<6} "
                  f"sid={sid_preview}... {ctx_str}")
            snapshot["buddies"].append({
                "slot": b["slot"], "floor": b["floor"],
                "effort_floor": b["effort_floor"],
                "sid": b["sid"], "context": ctx,
            })
    elif _BUDDY_SYSTEM_FLAG == "1":
        print("buddy sessions: none yet (sid files not written; init may still be in progress)")

    # OVERDRIVE_MODE display: surface the per-tier upstream routing decisions.
    _od_mode = os.environ.get("OVERDRIVE_MODE", "0")
    _od_descriptions = {
        "0": "cascade-only (no overdrive)",
        "1": "Opus chain for all tiers",
        "2": "E4-E5=Opus / E3=Sonnet / E1-E2=cascade",
        "3": "E5=Opus / E4=deepseek-pro / E3=deepseek-flash / E1-E2=cascade",
        "4": "main+E4=deepseek-pro / E5=glm-5.1 / E3=deepseek-flash / E1-E2=cascade",
        "5": "registry-driven per-tier (config/models.json)",
    }
    print(f"overdrive_mode: {_od_mode} ({_od_descriptions.get(_od_mode, 'unknown')})")
    snapshot["overdrive_mode"] = _od_mode

    # Hand-off paradigm: if BUDDY_HANDOFF=1, surface the senior pool so
    # the user has a single place to see retired buddies + their ctx_at_retire.
    # Detailed metadata (reason, retired_at, threshold) lives in
    # `i/handoff status`; this is a brief breadcrumb.
    if os.environ.get("BUDDY_HANDOFF", "0") == "1":
        seniors_dir = PROJECT_ROOT / "tmp" / "hme-buddy-seniors"
        if seniors_dir.exists():
            senior_files = sorted(p for p in seniors_dir.glob("*.json")
                                  if not p.name.startswith("_"))
            if senior_files:
                print(f"seniors (hand-off): {len(senior_files)} retired "
                      f"(see `i/handoff status` for metadata)")
                for f in senior_files:
                    try:
                        rec = json.loads(f.read_text())
                        c = rec.get("context_at_retire") or {}
                        tk = c.get("tokens", 0) if isinstance(c, dict) else 0
                        ts = rec.get("retired_at_iso", "?")
                        sid_short = (rec.get("sid", "") or "")[:16]
                        print(f"  senior sid={sid_short}... retired={ts} "
                              f"ctx_at_retire={tk:,}")
                    except (OSError, ValueError):
                        continue
    # `--json` (bare) -> True; `--json=false` / `--json=0` -> falsy.
    json_flag = getattr(args, "json", False)
    if isinstance(json_flag, str):
        json_flag = json_flag.strip().lower() not in ("", "0", "false", "no", "off")
    if json_flag:
        log_path = PROJECT_ROOT / "tmp" / "hme-buddy-session-log.json"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"session log written: {log_path.relative_to(PROJECT_ROOT)}")
    return 0

