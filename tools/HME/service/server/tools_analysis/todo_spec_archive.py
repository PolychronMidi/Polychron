"""TODO.md/devlog lifecycle compatibility for hidden hme_todo actions."""
import json
import os
import re
import sys
import time

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402
from paths import spec_file as _spec_file, todo_file as _todo_md_file, kb_devlog_dir as _devlog_dir  # noqa: E402
from .todo_md_sync import completion_state, write_blank_todo_md  # noqa: E402

from server.tools_analysis.todo import _load_todos  # noqa: E402


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
    meta, todos = _load_todos()
    todo_json = json.dumps({"_meta": meta, "todos": todos}, indent=2, sort_keys=True)
    devlog_content = [
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
    with open(devlog_path, "w", encoding="utf-8") as f:
        f.write("\n".join(devlog_content) + "\n")
    _reset_spec_to_fresh_slate(set_name, ts, devlog_path)
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
def _reset_spec_to_fresh_slate(prev_set_name: str, prev_ts: str, devlog_path: str) -> None:
    """Keep legacy SPEC.md as a pointer, not an active planning surface."""
    rel_devlog = os.path.relpath(devlog_path, ENV.require('PROJECT_ROOT'))
    pointer = [
        "# SPEC merged into TODO",
        "",
        "Active planning now lives in [TODO.md](TODO.md).",
        "",
        f"_Previous set ({prev_set_name}) archived {prev_ts} to {rel_devlog}._",
        "",
    ]
    os.makedirs(os.path.dirname(_spec_file()), exist_ok=True)
    with open(_spec_file(), "w", encoding="utf-8") as f:
        f.write("\n".join(pointer))


def _reset_todo_to_fresh_slate() -> None:
    """Reset doc/templates/TODO.md to the blank synced notepad template."""
    write_blank_todo_md()
