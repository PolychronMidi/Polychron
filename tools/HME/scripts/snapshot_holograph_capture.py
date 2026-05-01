"""Capture functions for snapshot-holograph.py — extracted to keep the
top-level orchestrator under the LOC target.

Each capture_* function reads one observable dimension of HME state and
returns a JSON-friendly dict. They are wrapped by _safe() in the parent
so their failures don't crash the snapshot.
"""
import ast
import hashlib
import json
import os
import re
import subprocess

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "service", "server")
_SCRIPTS_DIR = os.path.join(_PROJECT, "tools", "HME", "scripts")
METRICS_DIR = os.environ.get("METRICS_DIR") or os.path.join(_PROJECT, "output", "metrics")


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
    summary = os.path.join(METRICS_DIR, "pipeline-summary.json")
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
    f = "/tmp/claude-non-hme-streak.count"
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
