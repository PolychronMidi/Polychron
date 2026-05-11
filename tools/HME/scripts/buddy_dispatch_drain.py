"""Buddy drain -- main queue-drain loop + guidance reader + fast-path-clean.

Extracted from buddy_dispatcher.py (was lines 425-689). The "many tasks
through queue" orchestrator, separated from the per-task lifecycle
(buddy_dispatch_lifecycle.py). buddy_dispatcher.py re-exports cmd_drain.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from buddy_dispatcher import (  # noqa: E402
    PROJECT_ROOT, QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_DONE, QUEUE_FAILED,
    FANOUT_ROOT, GUIDANCE_FILE, NO_WORK_SENTINEL,
    _BUDDY_SYSTEM_FLAG, _DISPATCH_MODE, _SYNTHESIS_TIERS,
    _atomic_write, _strip_ansi, _ensure_dirs, _log_error,
    _list_buddies, _effective_tier, _effective_effort, _pick_buddy_for_task,
)
from buddy_dispatch_lifecycle import (  # noqa: E402
    _write_manifest, _claim_task, _dispatch_to_buddy,
    _archive_task, _sweep_orphans, _write_verdict,
)


_GUIDANCE_MAX_BYTES = int(os.environ.get("HME_BUDDY_GUIDANCE_MAX_BYTES", "1024"))


def _read_guidance() -> str:
    """Phase 2.5: manager-guidance file. Cross-run directive channel --
    the operator can edit tmp/hme-operator-guidance.md to nudge buddy
    behavior on the next drain. Each task prompt is prefixed with the
    guidance content (if present and non-empty).

    Bounded shaping (skill-set sst-manager pattern): the guidance file
    is capped at HME_BUDDY_GUIDANCE_MAX_BYTES (default 1KB). Content
    over the cap is truncated from the START so the most-recent
    guidance survives -- the file is treated as a rolling-newest
    window rather than an unbounded accumulator. Without this cap,
    long-running operators paste new directives without trimming and
    the prompt prefix grows unbounded over time, taxing every buddy
    invocation."""
    if not GUIDANCE_FILE.exists():
        return ""
    try:
        content = GUIDANCE_FILE.read_text().strip()
    except OSError:
        return ""
    if not content:
        return ""
    # Bounded shaping: keep newest portion under the cap.
    if len(content.encode("utf-8")) > _GUIDANCE_MAX_BYTES:
        encoded = content.encode("utf-8")
        keep = encoded[-_GUIDANCE_MAX_BYTES:]
        # Snap to a UTF-8 codepoint boundary at the truncation start.
        for i in range(min(4, len(keep))):
            try:
                content = keep[i:].decode("utf-8")
                break
            except UnicodeDecodeError:
                continue
        else:
            content = keep.decode("utf-8", errors="ignore")
        # Annotate that the head was trimmed so operator knows.
        content = f"[guidance trimmed from start; cap={_GUIDANCE_MAX_BYTES}B]\n" + content
    return content


def _fast_path_clean(buddies: list[dict]) -> bool:
    """Phase 2.4: fast-path on clean. Four cheap signals must all hold:
       1. No prior run flagged escalation (no FANOUT_ROOT/*/verdict.md
          contains 'escalate').
       2. No orphan tasks in processing/.
       3. Pending queue is empty.
       4. Failed/ has no entries newer than 1h.
    When all hold, the deep walk (verdict generation, manifest snapshot
    spam, etc.) is skipped -- return True to indicate fast-path applies."""
    if list(QUEUE_PENDING.glob("*.json")):
        return False
    if QUEUE_PROCESSING.exists():
        for buddy_dir in QUEUE_PROCESSING.iterdir():
            if list(buddy_dir.glob("*.json")):
                return False
    now = time.time()
    if QUEUE_FAILED.exists():
        for f in QUEUE_FAILED.glob("*.json"):
            if (now - f.stat().st_mtime) < 3600:
                return False
    if FANOUT_ROOT.exists():
        for verdict in FANOUT_ROOT.glob("*/verdict.md"):
            try:
                if "escalate" in verdict.read_text().lower():
                    return False
            except OSError:
                continue
    return True


def cmd_drain(args: argparse.Namespace) -> int:
    """Drain pending/ once: spawn buddies for available tasks, await
    completions, archive results. Returns 0 on success, non-zero if no
    buddies available or queue dir missing."""
    _ensure_dirs()
    # Phase 2.1: sweep orphans BEFORE picking up new work, so a buddy
    # that died mid-task in the prior run gets its work re-queued first.
    sweep_run_id = f"sweep-{int(time.time())}"
    swept = _sweep_orphans(sweep_run_id)
    if swept:
        print(f"buddy_dispatcher: recovered {swept} orphan task(s) from prior run(s)")
    # Lazy-spawn (BUDDY_SYSTEM.md option D for Q1): under HANDOFF=1, if
    # primary.sid is empty (e.g. just retired mid-session), trigger
    # ensure_primary BEFORE discovery so drain has a buddy to route to.
    # Status-only callers (`i/dispatch status` at the other call site,
    # line ~1539) deliberately skip this -- they should reflect actual
    # state, not silently mutate it. The 10-30s spawn cost lands as
    # first-task latency, which would otherwise be paid through ephemeral
    # fall-through anyway -- same total cost, different code path.
    if os.environ.get("BUDDY_HANDOFF") == "1":
        primary_sid_file = PROJECT_ROOT / "tmp" / "hme-buddy-primary.sid"
        primary_alive = (primary_sid_file.exists()
                         and primary_sid_file.read_text().strip() != "")
        if not primary_alive:
            handoff_script = Path(__file__).parent / "buddy_handoff.py"
            if handoff_script.exists():
                try:
                    subprocess.run(
                        ["python3", str(handoff_script), "ensure_primary"],
                        capture_output=True, timeout=180,
                        env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)},
                    )
                except (OSError, subprocess.TimeoutExpired):
                    pass  # silent-ok: best-effort fs op
    buddies = _list_buddies()
    if not buddies:
        _log_error("drain: no buddies registered (no tmp/hme-buddy*.sid found)")
        return 2
    # Phase 2.4: fast-path on clean. If signals all green, write a
    # minimal verdict and return without deep walk.
    if _fast_path_clean(buddies) and not list(QUEUE_PENDING.glob("*.json")):
        run_id = f"fastpath-{int(time.time())}"
        manifest = {
            "run_id": run_id,
            "started_ts": time.time(),
            "finished_ts": time.time(),
            "buddies": [{"slot": b["slot"], "floor": b["floor"]} for b in buddies],
            "iterations": [],
            "loop": {"terminated_by": "fast_path_clean"},
            "drained_count": 0,
        }
        _write_manifest(run_id, manifest, in_progress=False)
        _write_verdict(run_id, manifest)
        print(f"buddy_dispatcher: fast-path clean -- no work needed (run {run_id})")
        return 0
    run_id = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"
    manifest = {
        "run_id": run_id,
        "started_ts": time.time(),
        "buddies": [{"slot": b["slot"], "sid": b["sid"], "floor": b["floor"]} for b in buddies],
        "iterations": [],
        "loop": {"terminated_by": "in_progress"},
    }
    _write_manifest(run_id, manifest, in_progress=True)
    busy: set[int] = set()
    drained = 0
    while True:
        pending = sorted(QUEUE_PENDING.glob("*.json"))
        if not pending:
            break
        # Mid-drain re-check (BUDDY_SYSTEM.md Q1 followup): re-list
        # buddies each iteration so a primary that went away between
        # iterations (manual retire, claude-cli crash) doesn't leave the
        # drain dispatching to a dead session. Cheap -- _list_buddies
        # reads a handful of files. If empty under HANDOFF=1, lazy-spawn
        # a fresh primary and re-list. If still empty, abort the drain
        # cleanly and let the next drain pick up the remaining tasks.
        buddies = _list_buddies()
        if not buddies and os.environ.get("BUDDY_HANDOFF") == "1":
            handoff_script = Path(__file__).parent / "buddy_handoff.py"
            if handoff_script.exists():
                try:
                    subprocess.run(
                        ["python3", str(handoff_script), "ensure_primary"],
                        capture_output=True, timeout=180,
                        env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)},
                    )
                except (OSError, subprocess.TimeoutExpired):
                    pass  # silent-ok: best-effort fs op
            buddies = _list_buddies()
        if not buddies:
            _log_error("drain: buddies list empty mid-drain after lazy "
                       "spawn attempt; aborting cleanly so the next drain "
                       "can retry")
            break
        progressed = False
        for task_path in pending:
            try:
                task = json.loads(task_path.read_text())
            except Exception as e:
                _log_error(f"drain: bad task {task_path.name}: {e}")
                # Move to failed/ so it's out of pending.
                target = QUEUE_FAILED / task_path.name
                try:
                    os.rename(str(task_path), str(target))
                except OSError:
                    pass  # silent-ok: best-effort fs op
                continue
            buddy = _pick_buddy_for_task(task, buddies, busy)
            if buddy is None:
                continue
            claimed = _claim_task(task_path, buddy)
            if claimed is None:
                continue
            busy.add(buddy["slot"])
            # Per-task render-error isolation: a malformed task payload,
            # claude-cli crash, or transient subprocess hang must NOT
            # crash the whole drain -- it should fail just THIS task and
            # let the loop continue to others. Lifted from skill-set
            # skill-chain.py:862 (per-event try/except). Without this,
            # one buddy choking on a poison task could wedge the
            # entire fanout.
            try:
                verdict = _dispatch_to_buddy(task, claimed, buddy, run_id)
            except Exception as e:
                _log_error(
                    f"drain: dispatch raised on task {task.get('id', '?')} "
                    f"buddy {buddy['slot']}: {type(e).__name__}: {e}"
                )
                verdict = {
                    "outcome": "render_error",
                    "rc": -1,
                    "elapsed_s": 0.0,
                    "stdout_tail": "",
                    "stderr_tail": f"_dispatch_to_buddy raised: {type(e).__name__}: {e}",
                    "sentinel_seen": False,
                    "effective_tier": task.get("tier", "medium"),
                    "buddy_slot": buddy["slot"],
                    "buddy_floor": buddy["floor"],
                }
            try:
                archived = _archive_task(claimed, verdict)
                archived_rel = str(archived.relative_to(PROJECT_ROOT))
            except Exception as e:
                _log_error(
                    f"drain: archive raised on task {task.get('id', '?')}: "
                    f"{type(e).__name__}: {e}"
                )
                archived_rel = "<archive-failed>"
            manifest["iterations"].append({
                "task_id": task.get("id"),
                "task_name": task.get("text", "")[:80],
                "tier": task.get("tier"),
                "buddy_slot": buddy["slot"],
                "outcome": verdict["outcome"],
                "elapsed_s": verdict["elapsed_s"],
                "sentinel_seen": verdict["sentinel_seen"],
                "archived_path": archived_rel,
            })
            _write_manifest(run_id, manifest, in_progress=True)
            busy.discard(buddy["slot"])
            drained += 1
            progressed = True
            # If the buddy emitted the sentinel, treat as natural-end
            # signal -- the queue should be empty too. Loop continues
            # until pending/ is actually empty.
            if verdict["sentinel_seen"] and not list(QUEUE_PENDING.glob("*.json")):
                manifest["loop"]["terminated_by"] = "no_work_bail"
                break
        if not args.loop:
            if not progressed:
                # No tasks could be claimed this pass (all buddies busy
                # or filesystem race). Break to avoid spinning.
                break
        if manifest["loop"]["terminated_by"] == "no_work_bail":
            break
        if args.loop:
            time.sleep(args.loop_delay)
    if manifest["loop"]["terminated_by"] == "in_progress":
        manifest["loop"]["terminated_by"] = "queue_empty" if drained else "no_tasks"
    manifest["drained_count"] = drained
    manifest["finished_ts"] = time.time()
    _write_manifest(run_id, manifest, in_progress=False)
    # Phase 2.2: write the per-run verdict file. Required exit-contract
    # artifact -- if missing, the next sweep flags it as a violation.
    verdict_path = _write_verdict(run_id, manifest)
    print(f"buddy_dispatcher: drained {drained} task(s) in run {run_id}")
    print(f"  manifest: {FANOUT_ROOT / run_id / 'manifest.json'}")
    print(f"  verdict:  {verdict_path}")
    return 0


