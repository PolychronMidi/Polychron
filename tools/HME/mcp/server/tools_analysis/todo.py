"""HME hierarchical todo list — MCP tool with sub-todo support and lifesaver integration.

Main todos contain sub-todos. A main todo is only done when all its sub-todos are done.
Lifesaver alerts auto-append as CRITICAL ERROR items via register_todo_from_lifesaver().
"""
import json
import os
import time
import logging
import threading

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")

_TODO_FILE = os.path.join(
    os.environ.get("PROJECT_ROOT", os.getcwd()), ".claude", "mcp", "HME", "todos.json"
)
_todo_lock = threading.Lock()
_next_id_counter = 0


def _load_todos() -> list[dict]:
    try:
        with open(_TODO_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_todos(todos: list[dict]):
    os.makedirs(os.path.dirname(_TODO_FILE), exist_ok=True)
    with open(_TODO_FILE, "w", encoding="utf-8") as f:
        json.dump(todos, f, indent=2)


def _next_id(todos: list[dict]) -> int:
    all_ids = []
    for t in todos:
        all_ids.append(t["id"])
        for s in t.get("subs", []):
            all_ids.append(s["id"])
    return max(all_ids, default=0) + 1


def _find_main(todos: list[dict], todo_id: int) -> dict | None:
    for t in todos:
        if t["id"] == todo_id:
            return t
    return None


def _check_main_done(main: dict) -> bool:
    """A main todo is done only when all its sub-todos are done."""
    subs = main.get("subs", [])
    if not subs:
        return main.get("done", False)
    return all(s.get("done", False) for s in subs)


def _format_todos(todos: list[dict]) -> str:
    if not todos:
        return "No todos."
    lines = []
    for t in todos:
        auto_done = _check_main_done(t)
        mark = "x" if auto_done else " "
        critical = " !!!" if t.get("critical") else ""
        lines.append(f"[{mark}] #{t['id']} {t['text']}{critical}")
        for s in t.get("subs", []):
            s_mark = "x" if s.get("done") else " "
            s_critical = " !!!" if s.get("critical") else ""
            lines.append(f"  [{s_mark}] #{s['id']} {s['text']}{s_critical}")
    return "\n".join(lines)


def _format_todos_mermaid(todos: list[dict]) -> str:
    if not todos:
        return "```mermaid\ngraph TD\n    empty[\"No todos\"]\n```"
    lines = ["graph TD"]
    seen_cls: set[str] = set()
    for t in todos:
        auto_done = _check_main_done(t)
        nid = f"T{t['id']}"
        label = t["text"][:42].replace('"', "'")
        cls = "done" if auto_done else ("crit" if t.get("critical") else "open")
        seen_cls.add(cls)
        suffix = " ✓" if auto_done else (" !!!" if t.get("critical") else "")
        lines.append(f'    {nid}["#{t["id"]} {label}{suffix}"]:::{cls}')
        for s in t.get("subs", []):
            sid = f"T{s['id']}"
            s_label = s["text"][:38].replace('"', "'")
            s_cls = "done" if s.get("done") else ("crit" if s.get("critical") else "open")
            seen_cls.add(s_cls)
            s_suffix = " ✓" if s.get("done") else (" !!!" if s.get("critical") else "")
            lines.append(f'    {sid}["#{s["id"]} {s_label}{s_suffix}"]:::{s_cls}')
            lines.append(f"    {nid} --> {sid}")
    styles = {
        "done": "fill:#1a4520,stroke:#3a8a3a,color:#90ee90",
        "open": "fill:#1e1e2e,stroke:#555,color:#cdd6f4",
        "crit": "fill:#4a1010,stroke:#cc3333,color:#ff9999",
    }
    for cls in seen_cls:
        lines.append(f"    classDef {cls} {styles[cls]}")
    return "```mermaid\n" + "\n".join(lines) + "\n```"


def register_todo_from_lifesaver(source: str, error: str, severity: str = "CRITICAL"):
    """Called by lifesaver to auto-append critical errors as todos."""
    text = f"CRITICAL ERROR - LIFESAVER ALERT: [{severity}] {source}: {error}"
    with _todo_lock:
        todos = _load_todos()
        new_id = _next_id(todos)
        todos.append({
            "id": new_id,
            "text": text,
            "done": False,
            "critical": True,
            "ts": time.time(),
            "subs": [],
        })
        _save_todos(todos)
    logger.info(f"LIFESAVER→TODO #{new_id}: {text[:120]}")


@ctx.mcp.tool()
def todo(action: str = "list", text: str = "", todo_id: int = 0,
         parent_id: int = 0, fmt: str = "text") -> str:
    """Hierarchical todo list. Main todos have sub-todos; main is done when all subs done.

    action='list': show all todos.
    action='add': add main todo (text=). With parent_id=N, adds as sub-todo of #N.
    action='done': mark #todo_id done. Sub-todo done → checks if parent auto-completes.
    action='undo': unmark #todo_id as done.
    action='remove': remove #todo_id (main or sub).
    action='clear': remove all completed main todos (where all subs done).
    fmt='mermaid': render as a Mermaid graph diagram (works with any action)."""
    _track("todo")

    def _render(todos: list[dict]) -> str:
        return _format_todos_mermaid(todos) if fmt == "mermaid" else _format_todos(todos)

    with _todo_lock:
        todos = _load_todos()

        if action == "list":
            return _render(todos)

        if action == "add":
            if not text.strip():
                return "Error: text= required for add."
            new_id = _next_id(todos)
            if parent_id:
                main = _find_main(todos, parent_id)
                if not main:
                    return f"Error: parent #{parent_id} not found."
                main.setdefault("subs", []).append({
                    "id": new_id, "text": text.strip(), "done": False,
                    "ts": time.time(),
                })
            else:
                todos.append({
                    "id": new_id, "text": text.strip(), "done": False,
                    "critical": False, "ts": time.time(), "subs": [],
                })
            _save_todos(todos)
            parent_note = f" (sub of #{parent_id})" if parent_id else ""
            return f"Added #{new_id}{parent_note}: {text.strip()}\n\n{_render(todos)}"

        if action == "done":
            if not todo_id:
                return "Error: todo_id= required for done."
            for t in todos:
                if t["id"] == todo_id:
                    if t.get("subs"):
                        undone = [s for s in t["subs"] if not s.get("done")]
                        if undone:
                            names = ", ".join(f"#{s['id']}" for s in undone)
                            return f"Cannot complete #{todo_id} — sub-todos not done: {names}\n\n{_render(todos)}"
                    t["done"] = True
                    _save_todos(todos)
                    return f"Done: #{todo_id}\n\n{_render(todos)}"
                for s in t.get("subs", []):
                    if s["id"] == todo_id:
                        s["done"] = True
                        if _check_main_done(t):
                            t["done"] = True
                        _save_todos(todos)
                        auto = f" (parent #{t['id']} auto-completed!)" if t["done"] else ""
                        return f"Done: #{todo_id}{auto}\n\n{_render(todos)}"
            return f"Error: #{todo_id} not found."

        if action == "undo":
            if not todo_id:
                return "Error: todo_id= required for undo."
            for t in todos:
                if t["id"] == todo_id:
                    t["done"] = False
                    _save_todos(todos)
                    return f"Undone: #{todo_id}\n\n{_render(todos)}"
                for s in t.get("subs", []):
                    if s["id"] == todo_id:
                        s["done"] = False
                        t["done"] = False
                        _save_todos(todos)
                        return f"Undone: #{todo_id}\n\n{_render(todos)}"
            return f"Error: #{todo_id} not found."

        if action == "remove":
            if not todo_id:
                return "Error: todo_id= required for remove."
            for i, t in enumerate(todos):
                if t["id"] == todo_id:
                    todos.pop(i)
                    _save_todos(todos)
                    return f"Removed #{todo_id}\n\n{_render(todos)}"
                for j, s in enumerate(t.get("subs", [])):
                    if s["id"] == todo_id:
                        t["subs"].pop(j)
                        _save_todos(todos)
                        return f"Removed sub #{todo_id} from #{t['id']}\n\n{_render(todos)}"
            return f"Error: #{todo_id} not found."

        if action == "clear":
            before = len(todos)
            todos = [t for t in todos if not _check_main_done(t)]
            removed = before - len(todos)
            _save_todos(todos)
            return f"Cleared {removed} completed todos.\n\n{_render(todos)}"

        return f"Unknown action '{action}'. Use: list, add, done, undo, remove, clear."
