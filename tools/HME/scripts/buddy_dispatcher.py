#!/usr/bin/env python3
"""Co-buddy fanout dispatcher — drains tmp/hme-buddy-queue/pending/ and
routes each task to the appropriate co-buddy based on the
`effective = max(item_tier, buddy_floor)` rule.

Architecture (from doc/SPEC.md Phase 1):
- Queue dir: tmp/hme-buddy-queue/{pending,processing,done,failed}/
- Each task is a JSON file dropped into pending/ by a producer
  (i/todo ingest_from_spec, NEXUS auto-review, OVERDRIVE cascade, etc.)
- Atomic claim semantics: dispatcher renames pending/<task> ->
  processing/<buddy-N>/<task>; first-mv-wins. Crashes leave a half-
  claimed file in processing/ that the next iter's drafts sweep
  consumes (Phase 2.1).
- Sentinel: buddy emits `[no-work] <reason>` on stdout when its task
  completes AND the queue is drained. Dispatcher reads stdout until
  sentinel as positive idle declaration (closes the "response read
  prematurely" failure mode the user flagged).
- Per-run manifest: tmp/hme-buddy-fanout/<run-id>/manifest.json with
  `iterations`, `loop.terminated_by`, per-buddy `pid/sid/task_count/
  tier_distribution`. Snapshot-write per task with `in_progress: true`
  so a watcher can read partial state without false-positive findings.

Task file shape (JSON):
  {
    "id": str,                 # unique task id (caller-assigned)
    "tier": "easy"|"medium"|"hard",
    "text": str,               # task description
    "source": str,             # who queued it (e.g. "i/todo", "auto_review")
    "ts": float,               # epoch seconds when queued
    "context": {...}           # opaque per-source payload
  }

Usage:
  buddy_dispatcher.py drain      # drain queue once, exit when empty
  buddy_dispatcher.py drain --loop  # keep running, sleep between drains
  buddy_dispatcher.py enqueue --tier=medium --text="..." --source=manual

The dispatcher is invoked from posttooluse hooks / NEXUS / overdrive when
they need work farmed out. Single-process; multiple producers can drop
files concurrently (filesystem-IPC philosophy).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Project paths — derived from PROJECT_ROOT or relative to this script.
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
QUEUE_ROOT = PROJECT_ROOT / "tmp" / "hme-buddy-queue"
QUEUE_PENDING = QUEUE_ROOT / "pending"
QUEUE_PROCESSING = QUEUE_ROOT / "processing"
QUEUE_DONE = QUEUE_ROOT / "done"
QUEUE_FAILED = QUEUE_ROOT / "failed"
FANOUT_ROOT = PROJECT_ROOT / "tmp" / "hme-buddy-fanout"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"

# Floor-based escalation: these strings map to ordinal levels for the
# `effective = max(item_tier, buddy_floor)` rule. Higher ordinal = more
# capable model + more effort. Compared per axis (model and effort
# resolved independently — see doc/SPEC.md "Difficulty labels").
TIER_ORDER = {"easy": 0, "medium": 1, "hard": 2}
TIER_NAMES = ("easy", "medium", "hard")

# Sentinel emitted by buddies when idle. The dispatcher reads stdout
# until this line appears OR a hard timeout fires.
NO_WORK_SENTINEL = "[no-work]"

# Phase 2 paths.
GUIDANCE_FILE = PROJECT_ROOT / "tmp" / "hme-operator-guidance.md"


def _ensure_dirs() -> None:
    for p in (QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_DONE, QUEUE_FAILED, FANOUT_ROOT):
        p.mkdir(parents=True, exist_ok=True)


def _log_error(msg: str) -> None:
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] [buddy_dispatcher] {msg}\n")


def _list_buddies() -> list[dict]:
    """Discover available co-buddies by scanning tmp/hme-buddy*.sid.
    Returns list of {slot, sid, floor, sid_file, processing_dir}."""
    buddies = []
    tmp = PROJECT_ROOT / "tmp"
    # Single-buddy back-compat path
    legacy_sid = tmp / "hme-buddy.sid"
    if legacy_sid.exists() and legacy_sid.read_text().strip():
        floor_file = tmp / "hme-buddy.floor"
        floor = floor_file.read_text().strip() if floor_file.exists() else "medium"
        buddies.append({
            "slot": 1,
            "sid": legacy_sid.read_text().strip(),
            "floor": floor if floor in TIER_NAMES else "medium",
            "sid_file": legacy_sid,
            "processing_dir": QUEUE_PROCESSING / "buddy-1",
        })
        return buddies
    # Multi-buddy fanout path
    for sid_file in sorted(tmp.glob("hme-buddy-[0-9]*.sid")):
        sid = sid_file.read_text().strip() if sid_file.exists() else ""
        if not sid:
            continue
        # Slot from filename: hme-buddy-N.sid -> N
        try:
            slot = int(sid_file.stem.rsplit("-", 1)[1])
        except (ValueError, IndexError):
            continue
        floor_file = sid_file.with_suffix(".floor")
        floor = floor_file.read_text().strip() if floor_file.exists() else "medium"
        buddies.append({
            "slot": slot,
            "sid": sid,
            "floor": floor if floor in TIER_NAMES else "medium",
            "sid_file": sid_file,
            "processing_dir": QUEUE_PROCESSING / f"buddy-{slot}",
        })
    return buddies


def _effective_tier(item_tier: str, buddy_floor: str) -> str:
    """Apply `effective = max(item_tier, buddy_floor)` rule. Higher
    ordinal wins (more capable model)."""
    item_n = TIER_ORDER.get(item_tier, 1)
    floor_n = TIER_ORDER.get(buddy_floor, 1)
    return TIER_NAMES[max(item_n, floor_n)]


def _pick_buddy_for_task(task: dict, buddies: list[dict], busy: set[int]) -> dict | None:
    """Select a non-busy buddy whose effective tier (after floor
    escalation) best matches the task tier. Strategy: prefer the buddy
    whose floor exactly matches the task tier (no escalation needed);
    fall back to lowest-floor buddy that's free (cheapest option that
    doesn't downgrade)."""
    item_tier = task.get("tier", "medium")
    if item_tier not in TIER_NAMES:
        item_tier = "medium"
    item_n = TIER_ORDER[item_tier]
    free = [b for b in buddies if b["slot"] not in busy]
    if not free:
        return None
    # Score: prefer floor == item_tier (cost 0), else prefer floor < item_tier
    # (escalation upward; cost = item_n - floor_n), else floor > item_tier
    # (waste; cost = floor_n - item_n + 10 to deprioritize).
    def _cost(b):
        f = TIER_ORDER.get(b["floor"], 1)
        if f == item_n:
            return 0
        if f < item_n:
            return item_n - f
        return (f - item_n) + 10
    free.sort(key=_cost)
    return free[0]


def _write_manifest(run_id: str, manifest: dict, in_progress: bool = True) -> None:
    """Snapshot-write per-task. The `in_progress: true` flag tells any
    mid-run reader (a verifier, a sibling buddy) that the canonical
    record isn't complete — preventing false-positive "this task is
    missing!" findings while the run is still draining."""
    manifest["in_progress"] = in_progress
    manifest["updated_ts"] = time.time()
    manifest_path = FANOUT_ROOT / run_id / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


def _claim_task(task_path: Path, buddy: dict) -> Path | None:
    """Atomic claim: rename pending/<task> -> processing/<buddy-N>/<task>.
    First-mv-wins (rename is atomic on POSIX same-filesystem). Returns
    the new path on success, None if another dispatcher beat us to it."""
    target_dir = buddy["processing_dir"]
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / task_path.name
    try:
        os.rename(str(task_path), str(target))
        return target
    except FileNotFoundError:
        return None  # someone else claimed it
    except OSError as e:
        _log_error(f"claim failed for {task_path.name}: {e}")
        return None


def _dispatch_to_buddy(task: dict, claimed_path: Path, buddy: dict, run_id: str) -> dict:
    """Hand the task to the buddy via `claude --resume <sid> <prompt>`.
    Reads stdout until the [no-work] sentinel OR a hard timeout. Returns
    a verdict dict with `outcome` (done/failed/timeout), `stdout_tail`,
    `elapsed_s`."""
    started = time.time()
    item_tier = task.get("tier", "medium")
    effective = _effective_tier(item_tier, buddy["floor"])
    # Phase 2.5: prepend operator guidance (if any) so cross-run nudges
    # land in the buddy's prompt context.
    guidance = _read_guidance()
    guidance_block = ""
    if guidance:
        guidance_block = f"--- operator guidance ---\n{guidance}\n--- end guidance ---\n\n"
    # Phase 2.3 contract reminder: every actionable proposal cites the
    # motivating line. Drop unmotivated changes (skill-set's anti-scope-
    # creep gate). The buddy is responsible for self-policing this.
    prompt = (
        f"{guidance_block}"
        f"[picked-difficulty: {effective}]\n"
        f"Task ID: {task.get('id', '?')}\n"
        f"Source: {task.get('source', '?')}\n"
        f"Tier (item={item_tier}, your-floor={buddy['floor']}, effective={effective}):\n\n"
        f"{task.get('text', '')}\n\n"
        f"Citation rule: every proposed change MUST cite the motivating line "
        f"(file:line). Unmotivated suggestions are scope creep — drop them.\n"
        f"When complete AND the queue is drained, emit `{NO_WORK_SENTINEL} <reason>` on stdout."
    )
    timeout_s = {"easy": 60, "medium": 300, "hard": 900}.get(effective, 300)
    try:
        proc = subprocess.run(
            ["claude", "--resume", buddy["sid"], "-p", prompt],
            capture_output=True, text=True, timeout=timeout_s,
            env={**os.environ, "HME_THREAD_CHILD": "1"},
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        rc = proc.returncode
        elapsed = time.time() - started
        outcome = "done"
        sentinel_seen = NO_WORK_SENTINEL in stdout
        if rc != 0:
            outcome = "failed"
        return {
            "outcome": outcome,
            "rc": rc,
            "elapsed_s": round(elapsed, 2),
            "stdout_tail": stdout[-2000:],
            "stderr_tail": stderr[-1000:],
            "sentinel_seen": sentinel_seen,
            "effective_tier": effective,
            "buddy_slot": buddy["slot"],
            "buddy_floor": buddy["floor"],
        }
    except subprocess.TimeoutExpired as e:
        elapsed = time.time() - started
        return {
            "outcome": "timeout",
            "rc": -1,
            "elapsed_s": round(elapsed, 2),
            "stdout_tail": (e.stdout.decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or ""))[-2000:],
            "stderr_tail": (e.stderr.decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or ""))[-1000:],
            "sentinel_seen": False,
            "effective_tier": effective,
            "buddy_slot": buddy["slot"],
            "buddy_floor": buddy["floor"],
        }


def _archive_task(claimed_path: Path, verdict: dict) -> Path:
    """Move the claimed task file to done/ or failed/ based on verdict."""
    target_dir = QUEUE_DONE if verdict["outcome"] == "done" else QUEUE_FAILED
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / claimed_path.name
    # Embed verdict alongside the original task payload for audit trail.
    try:
        original = json.loads(claimed_path.read_text())
    except Exception:
        original = {"_unreadable": True}
    archived = {"task": original, "verdict": verdict, "archived_ts": time.time()}
    target.write_text(json.dumps(archived, indent=2))
    try:
        os.unlink(claimed_path)
    except OSError:
        pass
    return target


def _sweep_orphans(run_id: str) -> int:
    """Phase 2.1: iter-boundary drafts sweep. Scan processing/<buddy-N>/
    directories for orphans (task files left mid-flight when a previous
    drain crashed / timed out / was SIGKILLed). Treat each orphan as a
    fresh injected task and move it back to pending/ so the next claim
    cycle picks it up. The motivating citation is the prior-run manifest
    entry (the orphan's task id should appear with outcome != "done").

    Self-heals partial completion across runs without manual intervention.
    """
    swept = 0
    if not QUEUE_PROCESSING.exists():
        return 0
    for buddy_dir in QUEUE_PROCESSING.iterdir():
        if not buddy_dir.is_dir():
            continue
        for orphan in list(buddy_dir.glob("*.json")):
            target = QUEUE_PENDING / orphan.name
            try:
                # Avoid clobber: if a same-name file exists in pending/
                # (e.g. caller re-enqueued), append a suffix.
                if target.exists():
                    target = QUEUE_PENDING / f"{orphan.stem}.recovered.json"
                os.rename(str(orphan), str(target))
                swept += 1
                _log_error(
                    f"sweep: recovered orphan {orphan.name} from {buddy_dir.name} "
                    f"(re-queued as {target.name})"
                )
            except OSError as e:
                _log_error(f"sweep: failed to recover {orphan.name}: {e}")
    return swept


def _write_verdict(run_id: str, manifest: dict) -> Path:
    """Phase 2.2: per-run verdict file. Required exit-contract artifact —
    if the dispatcher returns without writing one, the next run's sweep
    flags it as a contract violation. Lists every task dispatched with
    outcome, plus any deferred items (claimed-but-unfinished)."""
    verdict_path = FANOUT_ROOT / run_id / "verdict.md"
    verdict_path.parent.mkdir(parents=True, exist_ok=True)
    iters = manifest.get("iterations", [])
    done = [i for i in iters if i.get("outcome") == "done"]
    failed = [i for i in iters if i.get("outcome") == "failed"]
    timeouts = [i for i in iters if i.get("outcome") == "timeout"]
    deferred = []
    for buddy_dir in QUEUE_PROCESSING.iterdir() if QUEUE_PROCESSING.exists() else []:
        for f in buddy_dir.glob("*.json"):
            deferred.append({"buddy": buddy_dir.name, "task": f.name})
    lines = [
        f"# Buddy fanout verdict — {run_id}",
        "",
        f"**Started:** {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(manifest.get('started_ts', 0)))}",
        f"**Finished:** {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(manifest.get('finished_ts', 0)))}",
        f"**Buddies:** {len(manifest.get('buddies', []))}",
        f"**Drained:** {manifest.get('drained_count', 0)}",
        f"**Terminated by:** {manifest.get('loop', {}).get('terminated_by', '?')}",
        "",
        "## Outcomes",
        "",
        f"- done: {len(done)}",
        f"- failed: {len(failed)}",
        f"- timeout: {len(timeouts)}",
        f"- deferred (still in processing/): {len(deferred)}",
        "",
    ]
    if deferred:
        lines.append("## [deferred]")
        lines.append("")
        for d in deferred:
            lines.append(f"- {d['buddy']}/{d['task']} — claimed but not completed; next sweep will recover")
        lines.append("")
    if failed or timeouts:
        lines.append("## Failed / timed-out tasks")
        lines.append("")
        for i in failed + timeouts:
            lines.append(f"- {i.get('task_id', '?')} ({i.get('outcome')}, {i.get('elapsed_s')}s, buddy {i.get('buddy_slot')})")
    verdict_path.write_text("\n".join(lines) + "\n")
    return verdict_path


def _read_guidance() -> str:
    """Phase 2.5: manager-guidance file. Cross-run directive channel —
    the operator can edit tmp/hme-operator-guidance.md to nudge buddy
    behavior on the next drain. Each task prompt is prefixed with the
    guidance content (if present and non-empty)."""
    if not GUIDANCE_FILE.exists():
        return ""
    try:
        content = GUIDANCE_FILE.read_text().strip()
    except OSError:
        return ""
    if not content:
        return ""
    return content


def _fast_path_clean(buddies: list[dict]) -> bool:
    """Phase 2.4: fast-path on clean. Four cheap signals must all hold:
       1. No prior run flagged escalation (no FANOUT_ROOT/*/verdict.md
          contains 'escalate').
       2. No orphan tasks in processing/.
       3. Pending queue is empty.
       4. Failed/ has no entries newer than 1h.
    When all hold, the deep walk (verdict generation, manifest snapshot
    spam, etc.) is skipped — return True to indicate fast-path applies."""
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
        print(f"buddy_dispatcher: fast-path clean — no work needed (run {run_id})")
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
                    pass
                continue
            buddy = _pick_buddy_for_task(task, buddies, busy)
            if buddy is None:
                continue
            claimed = _claim_task(task_path, buddy)
            if claimed is None:
                continue
            busy.add(buddy["slot"])
            verdict = _dispatch_to_buddy(task, claimed, buddy, run_id)
            archived = _archive_task(claimed, verdict)
            manifest["iterations"].append({
                "task_id": task.get("id"),
                "task_name": task.get("text", "")[:80],
                "tier": task.get("tier"),
                "buddy_slot": buddy["slot"],
                "outcome": verdict["outcome"],
                "elapsed_s": verdict["elapsed_s"],
                "sentinel_seen": verdict["sentinel_seen"],
                "archived_path": str(archived.relative_to(PROJECT_ROOT)),
            })
            _write_manifest(run_id, manifest, in_progress=True)
            busy.discard(buddy["slot"])
            drained += 1
            progressed = True
            # If the buddy emitted the sentinel, treat as natural-end
            # signal — the queue should be empty too. Loop continues
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
    # artifact — if missing, the next sweep flags it as a violation.
    verdict_path = _write_verdict(run_id, manifest)
    print(f"buddy_dispatcher: drained {drained} task(s) in run {run_id}")
    print(f"  manifest: {FANOUT_ROOT / run_id / 'manifest.json'}")
    print(f"  verdict:  {verdict_path}")
    return 0


def cmd_enqueue(args: argparse.Namespace) -> int:
    """Drop a task file into pending/. Caller assigns id; if missing,
    we generate one. Used by producers (NEXUS auto-review, OVERDRIVE,
    i/todo ingest_from_spec, etc.) to queue work for the fanout."""
    _ensure_dirs()
    task = {
        "id": args.id or uuid.uuid4().hex[:12],
        "tier": args.tier if args.tier in TIER_NAMES else "medium",
        "text": args.text,
        "source": args.source,
        "ts": time.time(),
        "context": json.loads(args.context) if args.context else {},
    }
    target = QUEUE_PENDING / f"{task['id']}.json"
    target.write_text(json.dumps(task, indent=2))
    print(f"enqueued {target.relative_to(PROJECT_ROOT)} (tier={task['tier']}, source={task['source']})")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Print current queue state + active buddies."""
    _ensure_dirs()
    pending = list(QUEUE_PENDING.glob("*.json"))
    processing = list(QUEUE_PROCESSING.rglob("*.json"))
    done = list(QUEUE_DONE.glob("*.json"))
    failed = list(QUEUE_FAILED.glob("*.json"))
    buddies = _list_buddies()
    print(f"queue: pending={len(pending)} processing={len(processing)} done={len(done)} failed={len(failed)}")
    if buddies:
        print(f"buddies: {len(buddies)} active")
        for b in buddies:
            print(f"  slot={b['slot']} floor={b['floor']} sid={b['sid'][:16]}...")
    else:
        print("buddies: none registered (sid files missing)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Co-buddy fanout dispatcher")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_drain = sub.add_parser("drain", help="drain pending/ once")
    p_drain.add_argument("--loop", action="store_true", help="keep draining; sleep between passes")
    p_drain.add_argument("--loop-delay", type=float, default=5.0, help="seconds between loop passes")
    p_drain.set_defaults(func=cmd_drain)
    p_enq = sub.add_parser("enqueue", help="drop a task into pending/")
    p_enq.add_argument("--tier", default="medium", choices=TIER_NAMES)
    p_enq.add_argument("--text", required=True)
    p_enq.add_argument("--source", default="manual")
    p_enq.add_argument("--id", default="")
    p_enq.add_argument("--context", default="", help="JSON-encoded payload")
    p_enq.set_defaults(func=cmd_enqueue)
    p_stat = sub.add_parser("status", help="show queue + buddy state")
    p_stat.set_defaults(func=cmd_status)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
