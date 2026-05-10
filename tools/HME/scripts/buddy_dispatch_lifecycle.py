"""Buddy task lifecycle -- claim, dispatch, rate-limit, archive, sweep, verdict.

Extracted from buddy_dispatcher.py (was lines 424-856). The "what happens
to one task from claim to verdict" cluster, separated from the drain
loop that orchestrates many tasks. buddy_dispatcher.py re-exports the
public symbols.
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Ensure script dir on path so cross-module import resolves under both
# `python3 buddy_dispatch_lifecycle.py` (unlikely; this file isn't a CLI)
# and parent's __main__ load.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from buddy_dispatch_ratelimit import _detect_rate_limit  # noqa: E402

# buddy_dispatch_chain and buddy_dispatch_drain participate in the same
# import cycle as us (buddy_dispatcher -> drain -> lifecycle -> chain -> dispatcher).
# Lazy shims keep bare-name resolution working inside our function bodies
# without triggering the cycle at import time.
def _compute_pause_seconds(*a, **kw):
    import buddy_dispatch_chain as _bdc
    return _bdc._compute_pause_seconds(*a, **kw)
def _read_guidance(*a, **kw):
    import buddy_dispatch_drain as _bdd
    return _bdd._read_guidance(*a, **kw)

from buddy_dispatcher import (  # noqa: E402
    PROJECT_ROOT, QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_DONE, QUEUE_FAILED,
    FANOUT_ROOT, ERROR_LOG,
    TIER_ORDER, TIER_NAMES, EFFORT_ORDER, EFFORT_NAMES, TIER_TO_EFFORT,
    NO_WORK_SENTINEL,
    RATE_LIMIT_TEXT_RE, RATE_LIMIT_RESET_RE,
    _RATE_LIMIT_RESET_FIELDS, _RATE_LIMIT_RETRY_FIELDS,
    RATE_LIMIT_JITTER_RANGE, RATE_LIMIT_FALLBACK_BACKOFF_SECONDS,
    _RATE_LIMIT_MODE, _MAX_RATE_LIMIT_PAUSE_SECONDS, _MAX_PAUSES_PER_TASK,
    _atomic_write, _strip_ansi, _is_pid_alive, _log_error, _ensure_dirs,
    _effective_tier, _effective_effort,
)


def _write_manifest(run_id: str, manifest: dict, in_progress: bool = True) -> None:
    """Snapshot-write per-task. The `in_progress: true` flag tells any
    mid-run reader (a verifier, a sibling buddy) that the canonical
    record isn't complete -- preventing false-positive "this task is
    missing!" findings while the run is still draining.
    Uses atomic write so a sibling reader never sees a half-written
    JSON file (would make the in_progress flag itself unreliable)."""
    manifest["in_progress"] = in_progress
    manifest["updated_ts"] = time.time()
    manifest_path = FANOUT_ROOT / run_id / "manifest.json"
    _atomic_write(manifest_path, json.dumps(manifest, indent=2))


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
    from buddy_dispatcher import _translate_legacy_tier
    item_tier = _translate_legacy_tier(task.get("tier") or "E3")
    effective = _effective_tier(item_tier, buddy["floor"])
    effective_effort = _effective_effort(item_tier, buddy.get("effort_floor", "medium"))
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
        f"[picked-difficulty: {effective}] [picked-effort: {effective_effort}]\n"
        f"Task ID: {task.get('id', '?')}\n"
        f"Source: {task.get('source', '?')}\n"
        f"Model tier (item={item_tier}, floor={buddy['floor']}, effective={effective})\n"
        f"Effort tier (item={item_tier}, floor={buddy.get('effort_floor', 'medium')}, effective={effective_effort})\n\n"
        f"{task.get('text', '')}\n\n"
        f"Citation rule: every proposed change MUST cite the motivating line "
        f"(file:line). Unmotivated suggestions are scope creep -- drop them.\n"
        f"When complete AND the queue is drained, emit `{NO_WORK_SENTINEL} <reason>` on stdout."
    )
    from buddy_dispatcher import TIER_TO_TIMEOUT_S
    timeout_s = TIER_TO_TIMEOUT_S.get(effective, 300)
    pause_count = 0
    # Synthesis-routed dispatch: when buddy["sid"] is the "synthesis"
    # sentinel, route through synthesis_reasoning.call() instead of
    # claude --resume. No Anthropic-API rate-limit pause loop needed --
    # synthesis_reasoning has its own provider cascade + circuit
    # breakers that handle quota internally. Returns the response text
    # as stdout-equivalent for the verdict; no stderr (synthesis has no
    # subprocess channel). Failures (None return = full cascade
    # exhausted) become a "failed" verdict the caller can retry-archive
    # like any other failure.
    if buddy.get("sid") == "synthesis":
        persona_system = _load_persona(_infer_persona(task))
        try:
            sys.path.insert(0, str(PROJECT_ROOT / "tools" / "HME" / "service"))
            from server.tools_analysis.synthesis import synthesis_reasoning  # noqa: E402
        except ImportError as e:
            elapsed = time.time() - started
            return {
                "outcome": "failed",
                "rc": -1,
                "elapsed_s": round(elapsed, 2),
                "stdout_tail": "",
                "stderr_tail": f"synthesis_reasoning import failed: {e}",
                "sentinel_seen": False,
                "effective_tier": effective,
                "buddy_slot": buddy["slot"],
                "buddy_floor": buddy["floor"],
                "dispatch_mode": "synthesis",
            }
        try:
            # tier=effective lets synthesis_reasoning pick chain: E4-E5->Opus, E3->Sonnet, E1-E2->cascade.
            _generic_system = "You are a Polychron co-buddy. Read the task above; respond concisely with grounded reasoning. Cite file:line for every claim. When complete AND queue is drained, end your response with the [no-work] sentinel."
            response = synthesis_reasoning.call(
                prompt=prompt,
                system=persona_system or _generic_system,
                max_tokens=2048,
                temperature=0.3,
                profile="reasoning",
                tier=effective,
            )
            elapsed = time.time() - started
            if response is None:
                return {
                    "outcome": "failed",
                    "rc": -1, "elapsed_s": round(elapsed, 2),
                    "stdout_tail": "",
                    "stderr_tail": "synthesis_reasoning.call returned None (cascade exhausted)",
                    "sentinel_seen": False,
                    "effective_tier": effective,
                    "buddy_slot": buddy["slot"],
                    "buddy_floor": buddy["floor"],
                    "dispatch_mode": "synthesis",
                }
            sentinel_seen = NO_WORK_SENTINEL in response
            last_src = synthesis_reasoning.last_source() or "synthesis"
            return {
                "outcome": "done",
                "rc": 0, "elapsed_s": round(elapsed, 2),
                "stdout_tail": _strip_ansi(response)[-2000:],
                "stderr_tail": "",
                "sentinel_seen": sentinel_seen,
                "effective_tier": effective,
                "buddy_slot": buddy["slot"],
                "buddy_floor": buddy["floor"],
                "dispatch_mode": "synthesis",
                "synthesis_source": last_src,
            }
        except Exception as e:
            elapsed = time.time() - started
            return {
                "outcome": "failed",
                "rc": -1, "elapsed_s": round(elapsed, 2),
                "stdout_tail": "",
                "stderr_tail": f"synthesis_reasoning.call raised: {type(e).__name__}: {e}",
                "sentinel_seen": False,
                "effective_tier": effective,
                "buddy_slot": buddy["slot"],
                "buddy_floor": buddy["floor"],
                "dispatch_mode": "synthesis",
            }
    # claude-resume path (original buddy fanout -- requires BUDDY_SYSTEM=1).
    try:
        while True:
            proc = subprocess.run(
                ["claude", "--resume", buddy["sid"], "-p", prompt],
                capture_output=True, text=True, timeout=timeout_s,
                env={**os.environ, "HME_THREAD_CHILD": "1"},
            )
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            rc = proc.returncode
            # Rate-limit detection: when buddy hits Anthropic quota,
            # don't burn the task as failed -- pause until reset, then
            # retry. Honors HME_BUDDY_ON_RATE_LIMIT and per-task pause
            # cap (skill-set Phase 13 semantics).
            if rc != 0 and _RATE_LIMIT_MODE != "fail":
                rl = _detect_rate_limit(stderr, stdout)
                if rl and rl["detected"]:
                    pause_count += 1
                    if pause_count > _MAX_PAUSES_PER_TASK:
                        elapsed = time.time() - started
                        return {
                            "outcome": "rate_limit_max_pauses",
                            "rc": rc, "elapsed_s": round(elapsed, 2),
                            "stdout_tail": stdout[-2000:], "stderr_tail": stderr[-1000:],
                            "sentinel_seen": False, "effective_tier": effective,
                            "buddy_slot": buddy["slot"], "buddy_floor": buddy["floor"],
                            "pause_count": pause_count,
                        }
                    sleep_s = _compute_pause_seconds(rl, _RATE_LIMIT_MODE)
                    if sleep_s is None:
                        elapsed = time.time() - started
                        return {
                            "outcome": "rate_limit_pause_capped",
                            "rc": rc, "elapsed_s": round(elapsed, 2),
                            "stdout_tail": stdout[-2000:], "stderr_tail": stderr[-1000:],
                            "sentinel_seen": False, "effective_tier": effective,
                            "buddy_slot": buddy["slot"], "buddy_floor": buddy["floor"],
                            "pause_count": pause_count,
                        }
                    _log_error(
                        f"buddy {buddy['slot']} task {task.get('id', '?')} hit rate limit; "
                        f"sleeping {sleep_s:.0f}s ({rl.get('matched_text', '')})"
                    )
                    time.sleep(sleep_s)
                    continue  # retry same task
            elapsed = time.time() - started
            outcome = "done" if rc == 0 else "failed"
            sentinel_seen = NO_WORK_SENTINEL in stdout
            return {
                "outcome": outcome,
                "rc": rc,
                "elapsed_s": round(elapsed, 2),
                "stdout_tail": _strip_ansi(stdout)[-2000:],
                "stderr_tail": _strip_ansi(stderr)[-1000:],
                "sentinel_seen": sentinel_seen,
                "effective_tier": effective,
                "buddy_slot": buddy["slot"],
                "buddy_floor": buddy["floor"],
                "pause_count": pause_count,
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
    """Move the claimed task file to done/ or failed/ based on verdict.

    Retry-archive (skill-set Phase 13 pattern): if the destination
    already exists from a prior attempt on the same task id, the prior
    archive is renamed to `<basename>.retry-N.json` instead of being
    overwritten. Each retry attempt's full audit (task + verdict +
    archived_ts) is preserved, so debugging a chronically-failing task
    has the full history available.
    """
    target_dir = QUEUE_DONE if verdict["outcome"] == "done" else QUEUE_FAILED
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / claimed_path.name
    # Retry-archive: if a same-name file already exists, rotate it to
    # <basename>.retry-N.json (find the next available N).
    if target.exists():
        n = 1
        while True:
            rotated = target_dir / f"{target.stem}.retry-{n}.json"
            if not rotated.exists():
                try:
                    target.rename(rotated)
                except OSError:
                    pass
                break
            n += 1
            if n > 100:  # safety bound -- something's wrong if we hit this
                break
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
    """Phase 2.2: per-run verdict file. Required exit-contract artifact --
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
        f"# Buddy fanout verdict -- {run_id}",
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
            lines.append(f"- {d['buddy']}/{d['task']} -- claimed but not completed; next sweep will recover")
        lines.append("")
    if failed or timeouts:
        lines.append("## Failed / timed-out tasks")
        lines.append("")
        for i in failed + timeouts:
            lines.append(f"- {i.get('task_id', '?')} ({i.get('outcome')}, {i.get('elapsed_s')}s, buddy {i.get('buddy_slot')})")
    verdict_path.write_text("\n".join(lines) + "\n")
    return verdict_path

