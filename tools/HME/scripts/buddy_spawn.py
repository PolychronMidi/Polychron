#!/usr/bin/env python3
"""Buddy spawn -- single source of truth for invoking `claude -p` and
recording the resulting session as a buddy. Used by both:

  - `tools/HME/hooks/helpers/buddy_init.sh` (backgrounded at SessionStart
    for fire-and-forget bootstrap)
  - `buddy_handoff.py:cmd_ensure_primary` (synchronous from the
    dispatcher's pre-task lazy spawn)

Previously `_spawn_buddy` lived only in buddy_init.sh; ensure_primary
wrapped buddy_init.sh as a subprocess + polled. The wrapper duplicated a
process and forced async semantics on the synchronous caller. This
module is the buddy's prescribed extraction (BUDDY_SYSTEM.md Q1, Wisdom
section): one implementation, two invocation patterns at the call site.

Library entry point: `spawn_buddy()` returns the new sid string or None.
CLI entry point: arguments mirror the function signature; exit 0 on
success with the sid printed to stdout, exit 1 on failure.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Canonical model-floor -> effort-floor mapping. Mirrors TIER_TO_EFFORT
# in buddy_dispatcher.py; duplicated here to keep this module
# free of dispatcher imports (which pulls hme_env validation chain).
_FLOOR_TO_EFFORT = {"easy": "low", "medium": "medium", "hard": "high"}


def _read_spec_prime(project_root: Path | None = None) -> str:
    """Pre-warm payload: read SPEC.md preamble (Goal + Architecture sections).
    Bounded to first ~3KB to keep spawn prompts manageable. Returns empty string
    if SPEC.md missing -- spawn proceeds with generic prompt only."""
    root = project_root or Path(os.environ.get("PROJECT_ROOT") or
                                Path(__file__).resolve().parents[3])
    spec = root / "doc" / "templates" / "SPEC.md"
    if not spec.is_file():
        return ""
    try:
        text = spec.read_text(encoding="utf-8")
    except OSError:
        return ""
    cut = text.find("\n## Phases")
    if cut == -1:
        cut = min(len(text), 3000)
    return text[:cut].strip()[:3000]


def _build_role_prompt(slot: int, floor: str, buddy_count: int) -> str:
    """Per-buddy role prompt with SPEC.md preamble pre-warm so the first consult
    has Goal + Architecture context instead of starting cold."""
    spec_prime = _read_spec_prime()
    spec_block = (f"\n\n--- current SPEC.md preamble (pre-warm) ---\n{spec_prime}\n"
                  f"--- end pre-warm ---\n"
                  if spec_prime else "")
    return (
        f"You are co-buddy {slot}/{buddy_count} (model floor: {floor}) -- "
        "a persistent peer subagent for the Polychron codebase across "
        "this entire HME session. Reasoning tasks (review reflection, "
        "OVERDRIVE cascades, suggest_evolution, what_did_i_forget) "
        "arrive here as user messages; you reply with grounded "
        "reasoning. Accumulate context across tasks: a later task can "
        "build on what an earlier task surfaced. You MAY run read-only "
        "commands (Bash with `git diff`, `git show`, `git log`, `cat`, "
        "`grep`, the Read tool) to inspect the codebase when a prompt "
        "omits diff content. Do NOT edit files, run tests, or invoke "
        "long-running commands. Keep responses tight: max 4 concrete "
        "items per task. Cite file:line for every quoted finding. "
        "When your task is complete AND the queue is drained, emit a "
        "single line on stdout: [no-work] <one-line reason>. The "
        "dispatcher reads this as your idle declaration."
        f"{spec_block}"
    )


def _parse_session_id(claude_json_output: str) -> str | None:
    """Extract session_id from `claude -p --output-format json` output.
    Output may be a list of events (init, message, ...) or a single
    dict; tolerate both shapes. Returns None on any parse failure or
    missing field -- callers are expected to treat None as 'spawn
    failed, do not record sid'."""
    try:
        data = json.loads(claude_json_output)
    except (TypeError, ValueError):
        return None
    if isinstance(data, list):
        for ev in data:
            if not isinstance(ev, dict):
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                sid = ev.get("session_id")
                if sid:
                    return str(sid)
        for ev in data:
            if isinstance(ev, dict):
                sid = ev.get("session_id")
                if sid:
                    return str(sid)
    elif isinstance(data, dict):
        sid = data.get("session_id")
        if sid:
            return str(sid)
    return None


def spawn_buddy(slot: int, floor: str, buddy_count: int,
                sid_file: Path, project_root: Path,
                mark_inaugural_primary: bool = False) -> str | None:
    """Synchronously spawn a `claude -p` buddy and write the sid to disk.

    Returns the new sid on success, None on failure (claude crash,
    JSON parse failure, no session_id in output). Caller decides
    whether to retry, fall through, or surface the failure.

    File writes (atomic-ish -- single open+write per file):
      - sid_file (e.g. runtime/hme/buddy.sid)
      - sid_file.with_suffix('.floor') with the model floor
      - When mark_inaugural_primary=True (HANDOFF=1, slot=1):
        - runtime/hme/buddy-primary.sid (sid)
        - runtime/hme/buddy-primary.floor (floor)
        - runtime/hme/buddy-primary.effort_floor (canonical effort for floor)

    The writer-symmetry invariant from BUDDY_SYSTEM.md is enforced
    here: inaugural-primary writers MUST write the full trio (sid +
    floor + effort_floor)."""
    prompt = _build_role_prompt(slot, floor, buddy_count)
    spawn_env = {**os.environ, "HME_THREAD_CHILD": "1"}
    try:
        result = subprocess.run(
            ["claude", "-p", "--output-format", "json", prompt],
            capture_output=True, text=True, env=spawn_env, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    sid = _parse_session_id(result.stdout)
    if not sid:
        return None
    # Write the per-slot sid file + floor companion.
    sid_file.parent.mkdir(parents=True, exist_ok=True)
    sid_file.write_text(sid + "\n")
    sid_file.with_suffix(".floor").write_text(floor + "\n")
    # Inaugural-primary path: write the full primary pointer trio.
    if mark_inaugural_primary:
        runtime = project_root / "runtime" / "hme"
        runtime.mkdir(parents=True, exist_ok=True)
        (runtime / "buddy-primary.sid").write_text(sid + "\n")
        (runtime / "buddy-primary.floor").write_text(floor + "\n")
        effort = _FLOOR_TO_EFFORT.get(floor, "low")
        (runtime / "buddy-primary.effort_floor").write_text(effort + "\n")
    # Best-effort activity emit (non-fatal).
    emit = project_root / "tools" / "HME" / "activity" / "emit.py"
    if emit.exists():
        try:
            subprocess.run(
                ["python3", str(emit),
                 "--event=buddy_init", f"--sid={sid}",
                 f"--slot={slot}", f"--floor={floor}"],
                capture_output=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": str(project_root)},
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
    return sid


def main() -> int:
    parser = argparse.ArgumentParser(description="Spawn a buddy synchronously")
    parser.add_argument("--slot", type=int, required=True)
    parser.add_argument("--floor", required=True)
    parser.add_argument("--buddy-count", type=int, required=True)
    parser.add_argument("--sid-file", required=True,
                        help="absolute path where the new sid is written")
    parser.add_argument("--mark-inaugural-primary", action="store_true",
                        help="also write runtime/hme/buddy-primary.{sid,floor,effort_floor}")
    parser.add_argument("--project-root",
                        default=os.environ.get("PROJECT_ROOT") or os.getcwd(),
                        help="root for tmp/ and activity emit script")
    args = parser.parse_args()
    sid = spawn_buddy(
        slot=args.slot, floor=args.floor, buddy_count=args.buddy_count,
        sid_file=Path(args.sid_file),
        project_root=Path(args.project_root),
        mark_inaugural_primary=args.mark_inaugural_primary,
    )
    if sid is None:
        print("buddy_spawn: claude -p produced no session_id", file=sys.stderr)
        return 1
    print(sid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
