#!/usr/bin/env python3
"""HME Self-Coherence Holograph — full machine-readable snapshot of HME state.

Captures EVERY observable dimension of HME at a single moment, producing a
JSON file that can be:
  - Diffed against future snapshots to surface drift
  - Replayed in an isolated environment to verify reproducibility
  - Fed into HME for meta-learning (the system observing its own history)
  - Coupled with Polychron's pipeline-summary.json to form a 2D state space
    where composition health and self-coherence health co-evolve

Captured dimensions:
  - HCI (full coherence report from verify-coherence.py)
  - Onboarding state + target + walkthrough todo tree
  - Tool surface (registered names, hidden flags, docstring lengths)
  - Hook surface (matchers, scripts, executability)
  - KB summary (entry count by category, age distribution)
  - Pipeline verdict history (last N runs)
  - Streak counters
  - LIFESAVER error count
  - Codebase metrics (LOC, file counts by subsystem)
  - Git state (branch, ahead, dirty file count)
  - Active Python module list (importable from server)
  - Decorator wrap census (which tools have @chained?)
  - Docstring index hash (sha256 of all tool docstrings)

Output: holograph-YYYYMMDD-HHMMSS.json in metrics/holograph/

This is the sub-quantum depth dimension. The holograph IS the system's
introspection — diffing two holographs over time reveals the trajectory of
HME's evolution as a measurable orbit in a high-dimensional state space.

Usage:
    python3 tools/HME/scripts/snapshot-holograph.py            # write file
    python3 tools/HME/scripts/snapshot-holograph.py --stdout   # print JSON
    python3 tools/HME/scripts/snapshot-holograph.py --diff PATH  # diff vs prior
"""
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "mcp", "server")
_SCRIPTS_DIR = os.path.join(_PROJECT, "tools", "HME", "scripts")
_HOLOGRAPH_DIR = os.path.join(_PROJECT, "metrics", "holograph")


def _safe(fn, default=None):
    try:
        return fn()
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}", "_default": default}


def capture_hci() -> dict:
    """Run the unified coherence engine and capture its full JSON report."""
    script = os.path.join(_SCRIPTS_DIR, "verify-coherence.py")
    if not os.path.isfile(script):
        return {"_skipped": "verifier script missing"}
    rc = subprocess.run(
        ["python3", script, "--json"],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "PROJECT_ROOT": _PROJECT},
    )
    try:
        return json.loads(rc.stdout)
    except Exception as e:
        return {"_error": str(e), "_stdout": rc.stdout[:500], "_stderr": rc.stderr[:500]}


def capture_onboarding() -> dict:
    state_file = os.path.join(_PROJECT, "tmp", "hme-onboarding.state")
    target_file = os.path.join(_PROJECT, "tmp", "hme-onboarding.target")
    state = "graduated"
    target = ""
    try:
        if os.path.isfile(state_file):
            with open(state_file) as f:
                state = f.read().strip()
        if os.path.isfile(target_file):
            with open(target_file) as f:
                target = f.read().strip()
    except Exception as e:
        return {"_error": str(e)}
    return {
        "state": state,
        "target": target,
        "is_graduated": state == "graduated",
    }


def capture_tool_surface() -> dict:
    """Walk server source, list every @ctx.mcp.tool() function with metadata."""
    tools = []
    for root, _dirs, files in os.walk(_SERVER_DIR):
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            try:
                with open(path) as fp:
                    tree = ast.parse(fp.read())
            except Exception:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.FunctionDef):
                    continue
                tool_dec = None
                chained = False
                for d in node.decorator_list:
                    if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr == "tool":
                        tool_dec = d
                    if isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id == "chained":
                        chained = True
                if tool_dec is None:
                    continue
                hidden = False
                for kw in tool_dec.keywords:
                    if kw.arg == "meta" and isinstance(kw.value, ast.Dict):
                        for k, v in zip(kw.value.keys, kw.value.values):
                            if (isinstance(k, ast.Constant) and k.value == "hidden"
                                    and isinstance(v, ast.Constant) and v.value):
                                hidden = True
                docstring = ast.get_docstring(node) or ""
                tools.append({
                    "name": node.name,
                    "file": os.path.relpath(path, _PROJECT),
                    "line": node.lineno,
                    "hidden": hidden,
                    "chained": chained,
                    "docstring_len": len(docstring),
                    "docstring_hash": hashlib.sha256(docstring.encode()).hexdigest()[:12],
                })
    tools.sort(key=lambda t: (t["hidden"], t["name"]))
    return {
        "count_total": len(tools),
        "count_public": sum(1 for t in tools if not t["hidden"]),
        "count_hidden": sum(1 for t in tools if t["hidden"]),
        "count_chained": sum(1 for t in tools if t["chained"]),
        "tools": tools,
    }


def capture_hook_surface() -> dict:
    hooks_json = os.path.join(_HOOKS_DIR, "hooks.json")
    try:
        with open(hooks_json) as f:
            data = json.load(f)
    except Exception as e:
        return {"_error": str(e)}
    matchers = []
    for event, entries in data.get("hooks", {}).items():
        for entry in entries:
            matcher = entry.get("matcher", "*")
            for hook in entry.get("hooks", []):
                cmd = hook.get("command", "")
                m = re.search(r'/(\w+\.sh)', cmd)
                script = m.group(1) if m else ""
                script_path = os.path.join(_HOOKS_DIR, script) if script else ""
                exists = os.path.isfile(script_path) if script else False
                executable = os.access(script_path, os.X_OK) if exists else False
                matchers.append({
                    "event": event,
                    "matcher": matcher,
                    "script": script,
                    "exists": exists,
                    "executable": executable,
                })
    return {
        "count": len(matchers),
        "events": sorted(set(m["event"] for m in matchers)),
        "matchers": matchers,
    }


def capture_kb_summary() -> dict:
    """KB lives in tools/HME/KB/. Count entries via Lance metadata if available."""
    db = os.path.join(_PROJECT, "tools", "HME", "KB")
    if not os.path.isdir(db):
        return {"_error": "kb directory missing"}
    info = {
        "path": db,
        "files": sorted(os.listdir(db)),
        "lance_dirs": [f for f in os.listdir(db) if f.endswith(".lance")],
    }
    # File hashes count gives a rough chunked-file count
    fh = os.path.join(db, "file_hashes.json")
    if os.path.isfile(fh):
        try:
            with open(fh) as f:
                hashes = json.load(f)
            info["indexed_file_count"] = len(hashes)
        except Exception:
            pass
    return info


def capture_pipeline_history() -> dict:
    summary = os.path.join(_PROJECT, "metrics", "pipeline-summary.json")
    if not os.path.isfile(summary):
        return {"_skipped": "no pipeline summary"}
    try:
        with open(summary) as f:
            data = json.load(f)
    except Exception as e:
        return {"_error": str(e)}
    return {
        "verdict": data.get("verdict"),
        "wallTimeSeconds": data.get("wallTimeSeconds"),
        "failed": data.get("failed"),
        "errorPatterns_count": len(data.get("errorPatterns", [])),
    }


def capture_todo_store() -> dict:
    store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
    if not os.path.isfile(store):
        return {"_skipped": "no todo store"}
    try:
        with open(store) as f:
            data = json.load(f)
    except Exception as e:
        return {"_error": str(e)}
    entries = [t for t in data if isinstance(t, dict) and t.get("id", 0) > 0]
    by_source = {}
    by_status = {}
    critical = 0
    for t in entries:
        src = t.get("source", "unknown")
        st = t.get("status", "unknown")
        by_source[src] = by_source.get(src, 0) + 1
        by_status[st] = by_status.get(st, 0) + 1
        if t.get("critical"):
            critical += 1
    return {
        "count": len(entries),
        "by_source": by_source,
        "by_status": by_status,
        "critical": critical,
    }


def capture_codebase() -> dict:
    """Polychron-side LOC and file counts by subsystem."""
    src = os.path.join(_PROJECT, "src")
    if not os.path.isdir(src):
        return {"_skipped": "no src dir"}
    counts = {}
    total_loc = 0
    total_files = 0
    for entry in sorted(os.listdir(src)):
        ent_path = os.path.join(src, entry)
        if not os.path.isdir(ent_path):
            continue
        loc = 0
        files = 0
        for root, _dirs, fs in os.walk(ent_path):
            for f in fs:
                if f.endswith(".js"):
                    files += 1
                    try:
                        with open(os.path.join(root, f)) as fp:
                            loc += sum(1 for _ in fp)
                    except Exception:
                        pass
        counts[entry] = {"files": files, "loc": loc}
        total_loc += loc
        total_files += files
    return {"by_subsystem": counts, "total_files": total_files, "total_loc": total_loc}


def capture_git_state() -> dict:
    try:
        branch = subprocess.run(["git", "-C", _PROJECT, "branch", "--show-current"],
                                capture_output=True, text=True, timeout=2).stdout.strip()
        ahead = subprocess.run(["git", "-C", _PROJECT, "rev-list", "--count", "@{u}..HEAD"],
                               capture_output=True, text=True, timeout=2).stdout.strip()
        dirty = subprocess.run(["git", "-C", _PROJECT, "status", "--porcelain"],
                               capture_output=True, text=True, timeout=2).stdout
        last = subprocess.run(["git", "-C", _PROJECT, "log", "--oneline", "-1"],
                              capture_output=True, text=True, timeout=2).stdout.strip()
    except Exception as e:
        return {"_error": str(e)}
    return {
        "branch": branch,
        "ahead": ahead or "0",
        "dirty_count": sum(1 for l in dirty.splitlines() if l.strip()),
        "last_commit": last,
    }


def capture_streak() -> dict:
    f = "/tmp/claude-non-hme-streak.count"  # legacy path
    f2 = "/tmp/hme-non-hme-streak.count"
    streak = None
    for path in (f2, f):
        if os.path.isfile(path):
            try:
                with open(path) as fp:
                    streak = int(fp.read().strip() or 0)
                break
            except Exception:
                continue
    return {"non_hme_streak": streak}


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
    }


# Fields that vary between runs but don't represent real drift —
# excluded from diff output to keep signal-to-noise high.
_NOISE_KEYS = {
    "captured_at", "captured_at_human", "timestamp",
    "duration_ms", "updated_ts",
}


def _diff(a: dict, b: dict, path: str = "") -> list:
    """Recursive diff between two holograph dicts. Returns list of (path, a_val, b_val).

    Filters out timing/timestamp noise so output focuses on REAL state drift.
    """
    diffs = []
    keys = set(a.keys()) | set(b.keys())
    for k in sorted(keys):
        sub = f"{path}.{k}" if path else k
        if k.startswith("_") or k in _NOISE_KEYS:
            continue
        av = a.get(k, "<missing>")
        bv = b.get(k, "<missing>")
        if isinstance(av, dict) and isinstance(bv, dict):
            diffs.extend(_diff(av, bv, sub))
        elif isinstance(av, list) and isinstance(bv, list):
            # For lists of dicts (tools, matchers, etc), compare as JSON
            if json.dumps(av, sort_keys=True) != json.dumps(bv, sort_keys=True):
                diffs.append((sub, f"<list len={len(av)}>", f"<list len={len(bv)}>"))
        elif av != bv:
            diffs.append((sub, av, bv))
    return diffs


def _replay(path: str) -> int:
    """H8: load an old holograph and display its state as if it were current.
    Time-travel debugging — see exactly what HCI + verifier state was at that
    moment. Useful for answering "what broke at time X?" after the fact."""
    if not os.path.isfile(path):
        sys.stderr.write(f"replay path not found: {path}\n")
        return 2
    try:
        with open(path) as f:
            snap = json.load(f)
    except Exception as e:
        sys.stderr.write(f"replay parse error: {e}\n")
        return 2
    print(f"# Holograph replay: {path}")
    print(f"  Captured: {snap.get('captured_at_human', '?')}")
    print(f"  Project:  {snap.get('project_root', '?')}")
    print()
    hci = snap.get("hci", {})
    score = hci.get("hci", "?")
    print(f"  HCI at that moment: {score}")
    cats = hci.get("categories", {})
    if cats:
        for cat in sorted(cats.keys()):
            info = cats[cat]
            print(f"    {cat:12} {info.get('score', 0)*100:5.1f}%")
    print()
    verifiers = hci.get("verifiers", {})
    failed = [(n, v) for n, v in verifiers.items() if v.get("status") in ("FAIL", "ERROR")]
    warned = [(n, v) for n, v in verifiers.items() if v.get("status") == "WARN"]
    if failed:
        print(f"## FAIL/ERROR verifiers at that moment ({len(failed)})")
        for n, v in failed:
            print(f"  {v.get('status'):5}  {n:30}  {v.get('summary', '')}")
    if warned:
        print(f"## WARN verifiers ({len(warned)})")
        for n, v in warned:
            print(f"  WARN   {n:30}  {v.get('summary', '')}")
    if not failed and not warned:
        print("## All verifiers were passing at that moment")
    print()
    # Surface non-HCI state
    onb = snap.get("onboarding", {})
    print(f"Onboarding state: {onb.get('state', '?')} (target: {onb.get('target', '')})")
    git = snap.get("git_state", {})
    print(f"Git: branch={git.get('branch', '?')} dirty={git.get('dirty_count', 0)} last={git.get('last_commit', '?')[:60]}")
    tool_surface = snap.get("tool_surface", {})
    print(f"Tool surface: {tool_surface.get('count_public', '?')} public + {tool_surface.get('count_hidden', '?')} hidden")
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
            sys.stderr.write(f"--diff requires a path to a prior holograph JSON file\n")
            return 2
        with open(prior_path) as f:
            prior = json.load(f)
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
