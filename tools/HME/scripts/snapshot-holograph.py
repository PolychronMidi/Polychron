#!/usr/bin/env python3
"""HME Self-Coherence Holograph -- full machine-readable snapshot of HME state.

Captures EVERY observable dimension of HME at a single moment, producing a
JSON file that can be:
  - Diffed against future snapshots to surface drift
  - Replayed in an isolated environment to verify reproducibility
  - Fed into HME for meta-learning (the system observing its own history)
  - Coupled with Polychron's pipeline-summary.json to form a 2D state space
    where composition health and self-coherence health co-evolve

Captured dimensions live in snapshot_holograph_capture.py. Diff/replay live
in snapshot_holograph_diff.py.

Output: holograph JSON under HME runtime metrics/holograph/

Usage:
    python3 tools/HME/scripts/snapshot-holograph.py            # write file
    python3 tools/HME/scripts/snapshot-holograph.py --stdout   # print JSON
    python3 tools/HME/scripts/snapshot-holograph.py --diff PATH  # diff vs prior
    python3 tools/HME/scripts/snapshot-holograph.py --replay PATH  # replay prior
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snapshot_holograph_capture import (  # noqa: E402
    METRICS_DIR, _PROJECT,
    capture_audit_state, capture_codebase, capture_git_state,
    capture_hci, capture_hook_surface, capture_kb_summary,
    capture_onboarding, capture_pipeline_history, capture_streak,
    capture_todo_store, capture_tool_surface,
)
from snapshot_holograph_diff import _diff, _replay  # noqa: E402

_HOLOGRAPH_DIR = os.path.join(METRICS_DIR, "holograph")


def _safe(fn, default=None):
    try:
        return fn()
    except Exception as e:
        # silent-ok: optional fallback path.
        return {"_error": f"{type(e).__name__}: {e}", "_default": default}


def build_holograph() -> dict:
    return {
        "schema_version": 1,
        "captured_at": time.time(),
        "captured_at_human": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "project_root": _PROJECT,
        "hci": _safe(capture_hci),
        "onboarding": _safe(capture_onboarding),
        "tool_surface": _safe(capture_tool_surface),
        "hook_surface": _safe(capture_hook_surface),
        "kb_summary": _safe(capture_kb_summary),
        "pipeline_history": _safe(capture_pipeline_history),
        "todo_store": _safe(capture_todo_store),
        "codebase": _safe(capture_codebase),
        "git_state": _safe(capture_git_state),
        "streak": _safe(capture_streak),
        "audit_state": _safe(capture_audit_state),
    }


def _run_diff(prior_path: str) -> int:
    with open(prior_path) as f:
        text = f.read()
    try:
        prior = json.loads(text)
    except json.JSONDecodeError:
        # Self-heal: a non-atomic prior write may have left two JSON objects
        try:
            prior, end = json.JSONDecoder().raw_decode(text)
        except json.JSONDecodeError:
            sys.stderr.write(
                f"[snapshot-holograph] WARN prior holograph "
                f"unrecoverable; skipping diff. path={prior_path}\n"
            )
            return 0
        sys.stderr.write(
            f"[snapshot-holograph] WARN prior holograph had trailing "
            f"data ({len(text) - end} bytes after first object); "
            f"auto-repaired in place.\n"
        )
        tmp = prior_path + ".repair.tmp"
        try:
            with open(tmp, "w") as wf:
                json.dump(prior, wf, indent=2)
            os.replace(tmp, prior_path)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass  # silent-ok: best-effort fs op
    current = build_holograph()
    diffs = _diff(prior, current)
    if not diffs:
        print("No drift between snapshots.")
        return 0
    print(f"# Holograph diff: {len(diffs)} field(s) changed")
    for path, av, bv in diffs:
        a_repr = json.dumps(av)[:80]
        b_repr = json.dumps(bv)[:80]
        print(f"  {path}")
        print(f"    -: {a_repr}")
        print(f"    +: {b_repr}")
    return 0


def main(argv: list) -> int:
    if "--replay" in argv:
        idx = argv.index("--replay")
        replay_path = argv[idx + 1] if idx + 1 < len(argv) else None
        if not replay_path:
            sys.stderr.write("--replay requires a path to a holograph JSON file\n")
            return 2
        return _replay(replay_path)

    if "--diff" in argv:
        idx = argv.index("--diff")
        prior_path = argv[idx + 1] if idx + 1 < len(argv) else None
        if not prior_path or not os.path.isfile(prior_path):
            sys.stderr.write("--diff requires a path to a prior holograph JSON file\n")
            return 2
        return _run_diff(prior_path)

    snap = build_holograph()
    if "--stdout" in argv:
        print(json.dumps(snap, indent=2))
        return 0

    os.makedirs(_HOLOGRAPH_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    out_path = os.path.join(_HOLOGRAPH_DIR, f"holograph-{ts}.json")
    with open(out_path, "w") as f:
        json.dump(snap, f, indent=2)

    hci_score = snap.get("hci", {}).get("hci", "?")
    tool_count = snap.get("tool_surface", {}).get("count_total", "?")
    hook_count = snap.get("hook_surface", {}).get("count", "?")
    kb_files = snap.get("kb_summary", {}).get("indexed_file_count", "?")
    print(f"Holograph saved: {out_path}")
    print(f"  HCI: {hci_score}  tools: {tool_count}  hooks: {hook_count}  kb_files: {kb_files}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
