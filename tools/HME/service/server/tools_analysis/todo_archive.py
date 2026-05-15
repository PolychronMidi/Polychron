"""TODO.md/devlog lifecycle for hidden hme_todo actions."""
import json
import hashlib
import os
import re
import subprocess
import sys
import time

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402
from paths import (  # noqa: E402
    todo_file as _todo_md_file,
    kb_devlog_dir as _devlog_dir,
    todo_archive_index_file as _archive_index_file,
)
from .todo_md_sync import completion_state, write_blank_todo_md  # noqa: E402

ARCHIVE_REQUIRED_SECTIONS = ("## TODO snapshot", "## todos.json snapshot")


def _ensure_devlog_dir() -> None:
    os.makedirs(_devlog_dir(), exist_ok=True)


def _slugify(text: str, max_len: int = 40) -> str:
    """Filesystem-safe slug for archive filenames."""
    s = re.sub(r"[^a-zA-Z0-9_\-]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "set"


def _detect_complete_set() -> dict:
    """Detect whether the active TODO.md set is complete."""
    out = {"complete": False, "phases": [], "missing": []}
    if not os.path.exists(_todo_md_file()):
        out["missing"].append(f"{_todo_md_file()} missing")
        return out
    with open(_todo_md_file(), encoding="utf-8") as f:
        todo_md = f.read()
    state = completion_state(todo_md)
    if state["total"] == 0:
        out["missing"].append("no TODO.md task lines found")
        return out
    out["phases"].append({
        "n": 0,
        "header": "## TODO",
        "start": 0,
        "end": 0,
        "open_items": state["open"],
        "has_sentinel": True,
    })
    if state["open"] > 0:
        out["missing"].append(f"TODO.md has {state['open']} open task line(s)")
    out["complete"] = state["complete"]
    return out


def _render_archive(set_name: str, ts: str, todo_md: str, todo_json: str) -> str:
    lines = [
        f"# Devlog -- {set_name}",
        "",
        f"_Archived: {ts}_",
        "_Source: doc/templates/TODO.md_",
        "",
        "## TODO snapshot",
        "",
        todo_md.rstrip(),
        "",
        "## todos.json snapshot",
        "",
        "```json",
        todo_json,
        "```",
        "",
    ]
    return "\n".join(lines)


def validate_archive_text(text: str) -> list[str]:
    errors: list[str] = []
    if not text.startswith("# Devlog -- "):
        errors.append("missing devlog title")
    if "_Archived:" not in text:
        errors.append("missing archived timestamp")
    for section in ARCHIVE_REQUIRED_SECTIONS:
        if section not in text:
            errors.append(f"missing {section}")
    if "```json" not in text:
        errors.append("missing todos.json fenced block")
    return errors


def _current_git_commit() -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", ENV.require("PROJECT_ROOT"), "rev-parse", "--short", "HEAD"],
            text=True,
            capture_output=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return "unknown"
    return proc.stdout.strip() if proc.returncode == 0 and proc.stdout.strip() else "unknown"


def _current_hci_score() -> float | None:
    path = os.path.join(
        ENV.require("PROJECT_ROOT"),
        "output", "metrics", "hci-verifier-snapshot.json",
    )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    for key in ("hci", "score", "overall_score"):
        value = data.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    summary = data.get("summary")
    if isinstance(summary, dict):
        value = summary.get("hci") or summary.get("score")
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _record_archive_index(devlog_path: str, set_name: str, ts: str,
                          todo_md: str, todos: list, meta: dict,
                          devlog_content: str) -> None:
    path = _archive_index_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, encoding="utf-8") as f:
            index = json.load(f)
    except FileNotFoundError:
        index = {"archives": []}
    if not isinstance(index, dict) or not isinstance(index.get("archives"), list):
        raise RuntimeError(f"{path} has invalid archive index schema")
    state = completion_state(todo_md)
    rel_path = os.path.relpath(devlog_path, ENV.require("PROJECT_ROOT"))
    archive_id = f"{ts}-{_slugify(set_name)}"
    record = {
        "archive_id": archive_id,
        "archived": ts,
        "set_name": set_name,
        "archive_path": rel_path,
        "task_count": state["total"],
        "done_count": state["total"] - state["open"],
        "todo_count": len(todos),
        "store_max_id": int(meta.get("max_id", 0) or 0),
        "content_sha256": hashlib.sha256(devlog_content.encode("utf-8")).hexdigest(),
        "git_commit": _current_git_commit(),
        "hci_score": _current_hci_score(),
    }
    index["archives"] = [
        item for item in index["archives"]
        if item.get("archive_path") != rel_path
    ] + [record]
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def _archive_set(set_name: str = "", force: bool = False) -> dict:
    """Archive TODO.md plus todos.json, then reset TODO.md."""
    detection = _detect_complete_set()
    if not detection["complete"] and not force:
        return {
            "ok": False,
            "devlog_path": "",
            "message": (
                "Refused: set is not fully complete.\n  " +
                "\n  ".join(detection["missing"])
            ),
        }
    _ensure_devlog_dir()
    ts = time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime())
    if not set_name:
        set_name = "todo"
    slug = _slugify(set_name)
    devlog_path = os.path.join(_devlog_dir(), f"{ts}-{slug}.md")
    todo_md = open(_todo_md_file(), encoding="utf-8").read() if os.path.exists(_todo_md_file()) else ""
    from server.tools_analysis.todo import _load_todos
    meta, todos = _load_todos()
    todo_json = json.dumps({"_meta": meta, "todos": todos}, indent=2, sort_keys=True)
    devlog_content = _render_archive(set_name, ts, todo_md, todo_json)
    contract_errors = validate_archive_text(devlog_content)
    if contract_errors:
        return {
            "ok": False,
            "devlog_path": "",
            "message": "Archive contract failed: " + "; ".join(contract_errors),
        }
    with open(devlog_path, "w", encoding="utf-8") as f:
        f.write(devlog_content)
    _record_archive_index(devlog_path, set_name, ts, todo_md, todos, meta, devlog_content)
    _reset_todo_to_fresh_slate()
    # Auto-fire learning extraction on the new devlog so KB/learnings.jsonl
    # accumulates each cycle's patterns without a human running i/learn learnings.
    try:
        import subprocess as _sp
        _le = os.path.join(ENV.require("PROJECT_ROOT"),
                           "tools", "HME", "scripts", "learning_extract.py")
        if os.path.isfile(_le):
            _sp.run(["python3", _le, "extract"], capture_output=True, timeout=10)
    except Exception:
        pass  # silent-ok: diagnostic; failure non-fatal
    return {
        "ok": True,
        "devlog_path": devlog_path,
        "message": f"Archived TODO.md to {devlog_path}; doc/templates/TODO.md reset to fresh slate.",
    }


def _reset_todo_to_fresh_slate() -> None:
    """Reset doc/templates/TODO.md to the blank synced notepad template."""
    write_blank_todo_md()
