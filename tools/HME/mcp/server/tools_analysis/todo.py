"""HME hierarchical todo list — MCP tool with sub-todo support, criticality, and
lifecycle side effects. Unified with native TodoWrite via pretooluse_todowrite.sh.

Schema (authoritative — all producers use _write_todo_entry to create items):

    {
      "id": int,                           monotonically increasing, never recycled
      "text": str,                         human-readable content
      "activeForm": str,                   present-continuous form (native TodoWrite compat)
      "status": str,                       "pending"|"in_progress"|"completed"
      "done": bool,                        mirror of status == "completed"
      "critical": bool,                    surfaces in userpromptsubmit at turn start
      "source": str,                       "native"|"lifesaver"|"hme_todo"|"onboarding"
      "on_done": str,                      optional lifecycle trigger (see ON_DONE_DISPATCH)
      "ts": float,                         creation timestamp (epoch seconds)
      "parent_id": int,                    id of parent main todo (0 = top-level)
      "subs": [ <entry>, ... ]             nested sub-todos (only on top-level entries)
    }

The store also carries a metadata header at key "_meta":
    {"_meta": {"max_id": int, "updated_ts": float}}

This is stored as the FIRST element in the JSON array with a sentinel id 0, so the
file remains a valid JSON array for backwards compatibility. On load, the header
is separated from the todo list. On save, it is re-prepended.

Main todos are done only when all their subs are done. Marking a parent done
while subs are open raises a refusal message that names the blocking subs.
Completing the last open sub auto-completes the parent.
"""
import json
import os
import sys
import time
import logging
import threading

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

from server import context as ctx
from server.onboarding_chain import chained
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")

_TODO_FILE = os.path.join(
    ENV.require("PROJECT_ROOT"), "tools", "HME", "KB", "todos.json"
)
_GRAPH_FILE = os.path.join(
    ENV.require("PROJECT_ROOT"), "metrics", "todo-graph.md"
)
_todo_lock = threading.RLock()

# Lifecycle triggers the on_done field may reference. Arbitrary shell is NOT
# allowed — only entries in this dispatch table fire. Each value is a callable
# taking (entry_dict) and returning a short status string for the caller.
ON_DONE_DISPATCH: dict = {}


def _default_meta() -> dict:
    return {"max_id": 0, "updated_ts": time.time()}


def _load_raw() -> list:
    try:
        with open(_TODO_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _split_meta(raw: list) -> tuple[dict, list]:
    """Separate the metadata header from the todo list. Creates one if missing."""
    if raw and isinstance(raw[0], dict) and raw[0].get("id") == 0 and "_meta" in raw[0]:
        return raw[0]["_meta"], raw[1:]
    # Legacy file (no header) — synthesize meta from existing entries
    meta = _default_meta()
    if raw:
        max_id = 0
        for t in raw:
            if isinstance(t, dict):
                max_id = max(max_id, int(t.get("id", 0)))
                for s in t.get("subs", []):
                    if isinstance(s, dict):
                        max_id = max(max_id, int(s.get("id", 0)))
        meta["max_id"] = max_id
    return meta, raw


def _load_todos() -> tuple[dict, list]:
    return _split_meta(_load_raw())


def _save_todos(meta: dict, todos: list):
    meta["updated_ts"] = time.time()
    os.makedirs(os.path.dirname(_TODO_FILE), exist_ok=True)
    header = {"id": 0, "_meta": meta}
    with open(_TODO_FILE, "w", encoding="utf-8") as f:
        json.dump([header] + todos, f, indent=2)
    try:
        _write_graph_file(todos)
    except Exception as e:
        logger.warning(f"todo-graph render failed: {e}")


def _allocate_id(meta: dict) -> int:
    meta["max_id"] = int(meta.get("max_id", 0)) + 1
    return meta["max_id"]


def _write_todo_entry(meta: dict, *, text: str, status: str = "pending",
                      active_form: str = "", critical: bool = False,
                      source: str = "hme_todo", on_done: str = "",
                      parent_id: int = 0) -> dict:
    """Canonical entry constructor — every producer goes through this to ensure
    schema stability across LIFESAVER, native mirror, hme_todo, and onboarding."""
    return {
        "id": _allocate_id(meta),
        "text": text.strip(),
        "activeForm": active_form or text.strip(),
        "status": status,
        "done": status == "completed",
        "critical": bool(critical),
        "source": source,
        "on_done": on_done or "",
        "ts": time.time(),
        "parent_id": parent_id,
        "subs": [] if parent_id == 0 else [],
    }


def _find_main(todos: list, todo_id: int) -> dict | None:
    for t in todos:
        if t.get("id") == todo_id:
            return t
    return None


def _find_any(todos: list, todo_id: int) -> tuple[dict | None, dict | None]:
    """Find an entry by id — returns (main, sub) where sub is None if top-level."""
    for t in todos:
        if t.get("id") == todo_id:
            return t, None
        for s in t.get("subs", []):
            if s.get("id") == todo_id:
                return t, s
    return None, None


def _check_main_done(main: dict) -> bool:
    subs = main.get("subs", [])
    if not subs:
        return main.get("done", False)
    return all(s.get("done", False) for s in subs)


def _mark_status(entry: dict, status: str) -> None:
    entry["status"] = status
    entry["done"] = status == "completed"


def _format_todos(todos: list) -> str:
    if not todos:
        return "No todos."
    lines = []
    for t in todos:
        auto_done = _check_main_done(t)
        mark = "x" if auto_done else (" " if t.get("status", "pending") != "in_progress" else "~")
        critical = " !!!" if t.get("critical") else ""
        source = t.get("source", "")
        source_tag = f" [{source}]" if source and source != "native" else ""
        lines.append(f"[{mark}] #{t['id']} {t['text']}{critical}{source_tag}")
        for s in t.get("subs", []):
            s_status = s.get("status", "pending")
            s_mark = "x" if s.get("done") else ("~" if s_status == "in_progress" else " ")
            s_critical = " !!!" if s.get("critical") else ""
            lines.append(f"  [{s_mark}] #{s['id']} {s['text']}{s_critical}")
    return "\n".join(lines)


def _format_todos_mermaid(todos: list) -> str:
    if not todos:
        return "```mermaid\ngraph TD\n    empty[\"No todos\"]\n```"
    lines = ["graph TD"]
    seen_cls: set = set()
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


def _write_graph_file(todos: list) -> None:
    """E8: render the mermaid graph to metrics/todo-graph.md on every save.
    Gives the human a live view of the agent's current work tree."""
    graph = _format_todos_mermaid(todos)
    os.makedirs(os.path.dirname(_GRAPH_FILE), exist_ok=True)
    body = (
        "# HME Todo Graph (live)\n\n"
        f"Updated: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())}\n\n"
        f"{graph}\n"
    )
    with open(_GRAPH_FILE, "w", encoding="utf-8") as f:
        f.write(body)



# External API


def register_todo_from_lifesaver(source: str, error: str, severity: str = "CRITICAL"):
    """LIFESAVER entry point — dedup-aware.

    Dedupes by the canonical text (severity+source+error) so a monitor
    loop hammering the same failure doesn't flood the todo store. If an
    unresolved entry with the same text already exists, this is a no-op.
    Pairs with failure_genealogy.record_failure which dedups the same
    alerts at the LIFESAVER log layer.
    """
    text = f"CRITICAL ERROR - LIFESAVER ALERT: [{severity}] {source}: {error}"
    with _todo_lock:
        meta, todos = _load_todos()
        for existing in todos:
            if (
                existing.get("source") == "lifesaver"
                and existing.get("text") == text
                and not _check_main_done(existing)
            ):
                return  # already queued — count is tracked in failure_genealogy
        entry = _write_todo_entry(
            meta, text=text, status="pending",
            critical=True, source="lifesaver",
        )
        todos.append(entry)
        _save_todos(meta, todos)
    logger.info(f"LIFESAVER→TODO #{entry['id']}: {text[:120]}")


def resolve_lifesaver_todos(source_substring: str) -> int:
    """Mark all open lifesaver-sourced todos whose source matches the given
    substring as resolved. Called by health_topology._auto_resolve_stale_failures
    so recovery in the live system cleans up the mirrored todo entries.

    Returns count of entries resolved.
    """
    if not source_substring:
        return 0
    resolved = 0
    with _todo_lock:
        meta, todos = _load_todos()
        for t in todos:
            if t.get("source") != "lifesaver" or _check_main_done(t):
                continue
            if source_substring in t.get("text", ""):
                t["status"] = "completed"
                t["resolved_ts"] = time.time()
                resolved += 1
        if resolved:
            _save_todos(meta, todos)
    if resolved:
        logger.info(f"LIFESAVER→TODO auto-resolved {resolved} entries matching '{source_substring}'")
    return resolved


def list_critical() -> list:
    """Return the list of open critical entries — used by userpromptsubmit to
    surface LIFESAVER alerts at every turn start."""
    with _todo_lock:
        _meta, todos = _load_todos()
    out = []
    for t in todos:
        if t.get("critical") and not _check_main_done(t):
            out.append({"id": t["id"], "text": t["text"], "source": t.get("source", "")})
        for s in t.get("subs", []):
            if s.get("critical") and not s.get("done"):
                out.append({"id": s["id"], "text": s["text"], "source": s.get("source", "")})
    return out


def list_carried_over() -> list:
    """Return all open (non-completed) items from the store — used by sessionstart
    to surface unfinished work from the prior session."""
    with _todo_lock:
        _meta, todos = _load_todos()
    out = []
    for t in todos:
        if not _check_main_done(t):
            open_subs = [s for s in t.get("subs", []) if not s.get("done")]
            out.append({
                "id": t["id"],
                "text": t["text"],
                "critical": t.get("critical", False),
                "source": t.get("source", ""),
                "open_subs": len(open_subs),
            })
    return out


def register_onboarding_tree(steps: list) -> int:
    """Create or update the onboarding walkthrough tree as a main todo with
    one sub per step. Called by onboarding_chain.py when the walkthrough
    initializes or advances. Returns the parent id.

    steps: list of (text, status) tuples — e.g., [("boot check", "completed"),
           ("pick target", "in_progress"), ("brief", "pending"), ...]

    On update, existing sub IDs are reused by matching on the step text, so
    repeated transitions don't churn the max_id counter.
    """
    with _todo_lock:
        meta, todos = _load_todos()
        existing = next(
            (t for t in todos if t.get("source") == "onboarding" and t.get("parent_id", 0) == 0),
            None,
        )
        if existing is None:
            parent = _write_todo_entry(
                meta, text="HME onboarding walkthrough",
                status="in_progress", source="onboarding",
            )
            parent["subs"] = []
            todos.append(parent)
            prior_subs_by_text = {}
        else:
            parent = existing
            prior_subs_by_text = {s["text"]: s for s in parent.get("subs", [])}
            parent["subs"] = []

        for text, status in steps:
            prior = prior_subs_by_text.get(text)
            if prior is not None:
                prior["status"] = status
                prior["done"] = status == "completed"
                parent["subs"].append(prior)
            else:
                sub = _write_todo_entry(
                    meta, text=text, status=status, source="onboarding",
                    parent_id=parent["id"],
                )
                parent["subs"].append(sub)

        if _check_main_done(parent):
            _mark_status(parent, "completed")
        else:
            in_progress_sub = any(s.get("status") == "in_progress" for s in parent["subs"])
            _mark_status(parent, "in_progress" if in_progress_sub else "pending")
        _save_todos(meta, todos)
        return parent["id"]


def clear_onboarding_tree() -> None:
    """Remove the onboarding parent and all its subs. Called on graduation."""
    with _todo_lock:
        meta, todos = _load_todos()
        todos = [t for t in todos if t.get("source") != "onboarding"]
        _save_todos(meta, todos)


def merge_native_todowrite(incoming: list) -> list:
    """E3: merge an incoming native TodoWrite payload with the HME store.

    Preserves HME-only items (lifesaver, onboarding, hme_todo) that native
    TodoWrite doesn't know about and returns a MERGED list that becomes the
    updatedInput for the real TodoWrite call. Result is ordered:
      1. critical items first (lifesaver, etc.)
      2. onboarding walkthrough (flattened: parent + indented subs)
      3. agent's incoming native items
      4. other hme_todo items the agent didn't include

    Native items the agent IS submitting win for matching text — their status
    updates flow through to the store.
    """
    with _todo_lock:
        meta, store = _load_todos()

        # Index store items by text for matching
        by_text: dict = {}
        for t in store:
            by_text[t["text"]] = t
            for s in t.get("subs", []):
                by_text[s["text"]] = s

        # Start: agent's intended state = the source of truth for native items
        new_store: list = []
        native_texts = set()
        for item in incoming or []:
            text = item.get("content", "")
            if not text:
                continue
            native_texts.add(text)
            existing = by_text.get(text, {})
            entry = _write_todo_entry(
                meta, text=text, status=item.get("status", "pending"),
                active_form=item.get("activeForm", ""),
                source=existing.get("source", "native"),
                critical=existing.get("critical", False),
                on_done=existing.get("on_done", ""),
            )
            # Preserve id + ts from existing (don't churn the max_id counter)
            if existing:
                entry["id"] = existing["id"]
                entry["ts"] = existing.get("ts", entry["ts"])
                # Preserve subs only for non-onboarding items (onboarding tree
                # rebuilds its own subs on every state transition)
                if existing.get("source") != "onboarding":
                    entry["subs"] = existing.get("subs", [])
                else:
                    entry["subs"] = []
                meta["max_id"] = max(meta["max_id"], entry["id"])
            new_store.append(entry)

        # Append HME-only items (critical + onboarding + other hme_todo) that
        # the agent's native payload didn't include
        for t in store:
            if t["text"] in native_texts:
                continue
            src = t.get("source", "")
            if src in ("lifesaver", "onboarding", "hme_todo"):
                new_store.append(t)

        _save_todos(meta, new_store)

        # Build the flattened list returned as updatedInput for native TodoWrite.
        # Format: one entry per visible row. Subs are flattened with an indent
        # prefix. Status flows from the underlying entry.
        flat = []
        # Order: critical first, onboarding next, then everything else
        def _sort_key(t):
            if t.get("critical"):
                return (0, t["id"])
            if t.get("source") == "onboarding" and t.get("parent_id", 0) == 0:
                return (1, t["id"])
            return (2, t["id"])

        for t in sorted(new_store, key=_sort_key):
            prefix = ""
            if t.get("critical"):
                prefix = "[CRITICAL] "
            elif t.get("source") == "onboarding":
                prefix = "[HME onboarding] "
            elif t.get("source") == "lifesaver":
                prefix = "[LIFESAVER] "
            flat.append({
                "content": prefix + t["text"],
                "activeForm": t.get("activeForm") or (prefix + t["text"]),
                "status": t.get("status", "pending"),
            })
            for s in t.get("subs", []):
                sub_prefix = "  └─ "
                if t.get("source") == "onboarding":
                    sub_prefix = "  └─ [HME] "
                flat.append({
                    "content": sub_prefix + s["text"],
                    "activeForm": s.get("activeForm") or (sub_prefix + s["text"]),
                    "status": s.get("status", "pending"),
                })
        return flat



# MCP tool — agents call this for hierarchical features TodoWrite lacks


@ctx.mcp.tool(meta={"hidden": True})
@chained("hme_todo")
def hme_todo(action: str = "list", text: str = "", todo_id: int = 0,
             parent_id: int = 0, critical: bool = False, on_done: str = "",
             status: str = "pending", fmt: str = "text") -> str:
    """Hierarchical todo list (HME extension to native TodoWrite).

    Use this when you need features the native TodoWrite lacks: sub-todos with
    parent auto-completion, critical/priority flags, lifecycle side-effects
    via on_done triggers, or cross-session persistence with diff highlighting.

    action='list': show all todos. fmt='mermaid' renders as a graph diagram.
    action='add': add main todo (text=). With parent_id=N, adds as sub of #N.
        Pass critical=True to surface at turn start. Pass on_done='reindex'|
        'commit'|'learn' to trigger a lifecycle hook when marked done.
    action='done': mark #todo_id done. Sub-todo done → checks if parent auto-
        completes. Fires on_done trigger if set.
    action='undo': unmark #todo_id as done (also clears parent if it was auto-
        completed).
    action='remove': remove #todo_id (main or sub).
    action='clear': remove all completed main todos.
    action='critical': list only critical open items (used by turn-start hook).

    Changes to this store propagate back to native TodoWrite via the
    pretooluse_todowrite.sh merge — items appear in the agent's native view
    on the next TodoWrite call.
    """
    _track("hme_todo")
    append_session_narrative("hme_todo", f"hme_todo({action}): {text[:40] or todo_id}")

    def _render(todos: list) -> str:
        return _format_todos_mermaid(todos) if fmt == "mermaid" else _format_todos(todos)

    with _todo_lock:
        meta, todos = _load_todos()

        if action == "list":
            return _render(todos)

        if action == "critical":
            items = list_critical()
            if not items:
                return "No critical todos."
            return "\n".join(f"!!! #{i['id']} {i['text']}" for i in items)

        if action == "add":
            if not text.strip():
                return "Error: text= required for add."
            if parent_id:
                main = _find_main(todos, parent_id)
                if not main:
                    return f"Error: parent #{parent_id} not found."
                sub = _write_todo_entry(
                    meta, text=text, status=status, critical=critical,
                    on_done=on_done, parent_id=parent_id,
                )
                main.setdefault("subs", []).append(sub)
                _save_todos(meta, todos)
                return f"Added sub #{sub['id']} (sub of #{parent_id}): {text.strip()}\n\n{_render(todos)}"
            entry = _write_todo_entry(
                meta, text=text, status=status, critical=critical, on_done=on_done,
            )
            todos.append(entry)
            _save_todos(meta, todos)
            return f"Added #{entry['id']}: {text.strip()}\n\n{_render(todos)}"

        if action == "done":
            if not todo_id:
                return "Error: todo_id= required for done."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target_entry = sub or main
            if sub is None and main.get("subs"):
                undone = [s for s in main["subs"] if not s.get("done")]
                if undone:
                    names = ", ".join(f"#{s['id']}" for s in undone)
                    return f"Cannot complete #{todo_id} — sub-todos not done: {names}\n\n{_render(todos)}"
            _mark_status(target_entry, "completed")
            # If it was a sub, check if parent auto-completes
            auto_note = ""
            if sub is not None and _check_main_done(main):
                _mark_status(main, "completed")
                auto_note = f" (parent #{main['id']} auto-completed!)"
                trigger_result = _fire_on_done(main)
                if trigger_result:
                    auto_note += f"\non_done: {trigger_result}"
            trigger_result = _fire_on_done(target_entry)
            trigger_note = f"\non_done: {trigger_result}" if trigger_result else ""
            _save_todos(meta, todos)
            return f"Done: #{todo_id}{auto_note}{trigger_note}\n\n{_render(todos)}"

        if action == "undo":
            if not todo_id:
                return "Error: todo_id= required for undo."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target_entry = sub or main
            _mark_status(target_entry, "pending")
            if sub is not None:
                # Parent was possibly auto-completed — reset if so
                _mark_status(main, "in_progress" if any(s.get("status") == "in_progress" for s in main.get("subs", [])) else "pending")
            _save_todos(meta, todos)
            return f"Undone: #{todo_id}\n\n{_render(todos)}"

        if action == "remove":
            if not todo_id:
                return "Error: todo_id= required for remove."
            for i, t in enumerate(todos):
                if t.get("id") == todo_id:
                    todos.pop(i)
                    _save_todos(meta, todos)
                    return f"Removed #{todo_id}\n\n{_render(todos)}"
                for j, s in enumerate(t.get("subs", [])):
                    if s.get("id") == todo_id:
                        t["subs"].pop(j)
                        _save_todos(meta, todos)
                        return f"Removed sub #{todo_id} from #{t['id']}\n\n{_render(todos)}"
            return f"Error: #{todo_id} not found."

        if action == "clear":
            before = len(todos)
            todos = [t for t in todos if not _check_main_done(t)]
            removed = before - len(todos)
            _save_todos(meta, todos)
            return f"Cleared {removed} completed todos.\n\n{_render(todos)}"

        return f"Unknown action '{action}'. Use: list, add, done, undo, remove, clear, critical."



# on_done dispatch — E6: lifecycle triggers fire when entries are completed


def _fire_on_done(entry: dict) -> str:
    """Run the on_done trigger named in the entry. Returns a short status
    string (for inclusion in the hme_todo response) or empty string if no
    trigger configured or trigger unknown.
    """
    trigger = entry.get("on_done", "")
    if not trigger:
        return ""
    fn = ON_DONE_DISPATCH.get(trigger)
    if fn is None:
        return f"unknown trigger '{trigger}'"
    try:
        return fn(entry) or f"fired '{trigger}'"
    except Exception as e:
        logger.warning(f"on_done trigger '{trigger}' failed: {e}")
        return f"trigger '{trigger}' error: {e}"


def _trigger_reindex(entry: dict) -> str:
    try:
        from .evolution_admin import hme_admin
        # Run in a thread so we don't block the tool call
        import threading
        threading.Thread(target=lambda: hme_admin(action="index"), daemon=True).start()
        return "hme_admin(action='index') started in background"
    except Exception as e:
        return f"reindex failed: {e}"


def _trigger_learn_prompt(entry: dict) -> str:
    """Write a prompt file that gets surfaced at the next UserPromptSubmit."""
    try:
        prompt_file = os.path.join(
            ENV.require("PROJECT_ROOT"),
            "tmp", "hme-todo-learn-prompts.log",
        )
        os.makedirs(os.path.dirname(prompt_file), exist_ok=True)
        with open(prompt_file, "a", encoding="utf-8") as f:
            f.write(f"- #{entry['id']}: {entry['text']}\n")
        return "learn() reminder queued for next turn"
    except Exception as e:
        return f"learn prompt failed: {e}"


def _trigger_commit_nudge(entry: dict) -> str:
    """Flag the nexus that a commit is pending for this completed todo."""
    try:
        nexus_file = os.path.join(
            ENV.require("PROJECT_ROOT"),
            "tmp", "hme-nexus.state",
        )
        if os.path.isfile(nexus_file):
            with open(nexus_file, "a", encoding="utf-8") as f:
                f.write(f"COMMIT_NUDGE:{int(time.time())}:{entry['text'][:80]}\n")
        return "commit nudge flagged in nexus"
    except Exception as e:
        return f"commit nudge failed: {e}"


ON_DONE_DISPATCH["reindex"] = _trigger_reindex
ON_DONE_DISPATCH["learn"] = _trigger_learn_prompt
ON_DONE_DISPATCH["commit"] = _trigger_commit_nudge
