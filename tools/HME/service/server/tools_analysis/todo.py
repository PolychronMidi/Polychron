"""HME hierarchical todo list -- MCP tool with sub-todo support, criticality, and
lifecycle side effects. Unified with native TodoWrite via event_kernel/native_hooks/todo.js.

Schema (authoritative -- all producers use _write_todo_entry to create items):

    {
      "id": int,                           monotonically increasing, never recycled
      "text": str,                         human-readable content
      "activeForm": str,                   present-continuous form (native TodoWrite compat)
      "status": str,                       "pending"|"in_progress"|"completed"
      "done": bool,                        mirror of status == "completed"
      "critical": bool,                    surfaces in userpromptsubmit at turn start
      "source": str,                       "native"|"lifesaver"|"hme_todo"|"todo_md"
      "on_done": str,                      optional lifecycle trigger (see ON_DONE_DISPATCH)
      "ts": float,                         creation timestamp (epoch seconds)
      "parent_id": int,                    id of parent main todo (0 = top-level)
      "subs": [ <entry>, ... ]             nested sub-todos (only on top-level entries)
    }

The store also carries a metadata header at key "_meta":
    {"_meta": {"max_id": int, "updated_ts": float}}

Refactor split (2026-05-01): bolt-on integrations now live in sibling modules,
with todo.py keeping the core CRUD + dispatcher + on_done triggers and re-exporting
their public symbols so existing callers don't change.
  todo_store.py        -- canonical todos.json load/save
  todo_lifesaver.py    -- lifesaver-error registration, dedup, caps, pruning
  todo_native_merge.py -- native TodoWrite payload merge
  todo_markdown_ingest.py -- TODO.md ingest/promote helpers
  todo_archive.py         -- TODO.md/devlog archive lifecycle
  todo_close.py           -- TODO.md close helpers

Main todos are done only when all their subs are done. Marking a parent done
while subs are open raises a refusal message that names the blocking subs.
Completing the last open sub auto-completes the parent.
"""
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
if hasattr(ctx, "bootstrap_project_root_from_env"):
    ctx.bootstrap_project_root_from_env()
from server.onboarding_chain import chained
from . import _track
from .synthesis_session import append_session_narrative
from .todo_store import load_store as _store_load, save_todos as _store_save_todos

logger = logging.getLogger("HME")

_GRAPH_FILE = os.path.join(
    ENV.require("PROJECT_ROOT"), "output", "metrics", "todo-graph.md"
)
_todo_lock = threading.RLock()

# Lifecycle triggers the on_done field may reference. Arbitrary shell is NOT
# allowed -- only entries in this dispatch table fire. Each value is a callable
# taking (entry_dict) and returning a short status string for the caller.
ON_DONE_DISPATCH: dict = {}

def _load_todos() -> tuple[dict, list]:
    _raw, meta, todos = _store_load()
    # In-memory normalize: legacy easy/medium/hard -> E1-E5 via _normalize_tier.
    for t in todos:
        if isinstance(t, dict):
            t["tier"] = _normalize_tier(t.get("tier"))
            for s in t.get("subs", []):
                if isinstance(s, dict):
                    s["tier"] = _normalize_tier(s.get("tier"))
    return meta, todos


def _save_todos(meta: dict, todos: list):
    _store_save_todos(meta, todos)
    try:
        _write_graph_file(todos)
    except Exception as e:
        logger.warning(f"todo-graph render failed: {e}")
    try:
        from .todo_md_sync import sync_todo_md
        sync_todo_md(todos)
    except Exception as e:
        logger.warning(f"TODO.md sync failed: {e}")


def _allocate_id(meta: dict) -> int:
    meta["max_id"] = int(meta.get("max_id", 0)) + 1
    return meta["max_id"]


_VALID_TIERS = ("E1", "E2", "E3", "E4", "E5")
# Legacy easy/medium/hard auto-translate on read.
_LEGACY_TIER_MAP = {"easy": "E2", "medium": "E3", "hard": "E4"}


def _normalize_tier(tier: str) -> str:
    """Coerce to E1..E5. Legacy easy/medium/hard translate (easy->E2,
    medium->E3, hard->E4). Unknown/empty -> E3 (graceful default)."""
    t = (tier or "").strip()
    upper = t.upper()
    if upper in _VALID_TIERS:
        return upper
    legacy = _LEGACY_TIER_MAP.get(t.lower())
    if legacy:
        return legacy
    return "E3"


def _write_todo_entry(meta: dict, *, text: str, status: str = "pending",
                      active_form: str = "", critical: bool = False,
                      source: str = "hme_todo", on_done: str = "",
                      parent_id: int = 0, tier: str = "E3") -> dict:
    """Canonical entry constructor -- every producer goes through this to ensure
    schema stability across LIFESAVER, native mirror, hme_todo, and TODO.md.

    `tier` is one of E1..E5 (canonical) or legacy easy/medium/hard (translated
    on read via _normalize_tier: easy->E2, medium->E3, hard->E4). Defaults
    to E3 so legacy/unlabeled items still sort sensibly.
    """
    # Single-writer invariant: JSON persistence goes through todo_store.py.
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("hme-todo-store", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
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
        "tier": _normalize_tier(tier),
    }


def _find_main(todos: list, todo_id: int) -> dict | None:
    for t in todos:
        if t.get("id") == todo_id:
            return t
    return None


def _find_any(todos: list, todo_id: int) -> tuple[dict | None, dict | None]:
    """Find an entry by id -- returns (main, sub) where sub is None if top-level."""
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
        return (
            "No todos.\n\n"
            "Use native TodoWrite for session tasks. HME merges persistent "
            "critical and TODO.md items automatically."
        )
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
        suffix = " [ok]" if auto_done else (" !!!" if t.get("critical") else "")
        lines.append(f'    {nid}["#{t["id"]} {label}{suffix}"]:::{cls}')
        for s in t.get("subs", []):
            sid = f"T{s['id']}"
            s_label = s["text"][:38].replace('"', "'")
            s_cls = "done" if s.get("done") else ("crit" if s.get("critical") else "open")
            seen_cls.add(s_cls)
            s_suffix = " [ok]" if s.get("done") else (" !!!" if s.get("critical") else "")
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
    """E8: render the mermaid graph to output/metrics/todo-graph.md on every save.
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


# Sibling-module re-exports: external callers `from server.tools_analysis.todo
# import register_todo_from_lifesaver` etc. continue to work without changes.
from .todo_lifesaver import (  # noqa: F401, E402
    _LIFESAVER_MAX_OPEN, _LIFESAVER_TTL_SECONDS,
    _LIFESAVER_PRUNE_AFTER_SECONDS, _DONE_TODO_PRUNE_AFTER_SECONDS,
    _LIFESAVER_STALE_SECONDS, _MAX_CRITICAL_IN_MERGE,
    _normalize_error_for_dedup, _enforce_lifesaver_caps,
    _prune_done_todos_universal, _prune_done_lifesavers,
    register_todo_from_lifesaver, resolve_lifesaver_todos,
    list_critical, list_carried_over,
    _expire_stale_lifesavers,
)
from .todo_native_merge import merge_native_todowrite  # noqa: F401, E402
from .todo_markdown_ingest import (  # noqa: F401, E402
    _NEXT_UP_RE,
    _read_section, _read_todo_open_lines,
    _ingest_from_todo, _promote_to_todo,
    _normalize_for_match, _common_prefix_len,
)
from .todo_archive import (  # noqa: F401, E402
    _ensure_devlog_dir, _slugify, _detect_complete_set, _archive_set,
    _reset_todo_to_fresh_slate, validate_archive_text,
)
from .todo_close import (  # noqa: F401, E402
    _detect_todo_complete, _close_with_todo_update,
)

@ctx.mcp.tool(meta={"hidden": True})
@chained("hme_todo")
def hme_todo(action: str = "list", text: str = "", todo_id: int = 0,
             parent_id: int = 0, critical: bool = False, on_done: str = "",
             status: str = "pending", fmt: str = "text",
             tier: str = "E3") -> str:
    """Hierarchical todo store behind native TodoWrite.

    Native TodoWrite is the public surface. This hidden handler keeps the
    HME-only features native TodoWrite lacks: sub-todos, critical flags,
    lifecycle side-effects, persistence, and TODO.md/devlog lifecycle actions.

    action='list': show all todos. fmt='mermaid' renders as a graph diagram.
    action='add': add main todo (text=). With parent_id=N, adds as sub of #N.
        Pass critical=True to surface at turn start. Pass on_done='reindex'|
        'commit'|'learn' to trigger a lifecycle hook when marked done.
        Pass tier=E1|E2|E3|E4|E5 for model+effort routing (default E3). Legacy easy/medium/hard accepted (translates to E2/E3/E4).
        Identical-text duplicate adds collapse to recurrence increment.
    action='done': mark #todo_id done. Sub-todo done -> checks if parent auto-
        completes. Fires on_done trigger if set.
    action='undo': unmark #todo_id as done (also clears parent if it was auto-
        completed).
    action='remove': remove #todo_id (main or sub).
    action='archive_now': force-archive current TODO.md state to KB devlog.
    action='clear': remove completed main todos. When TODO.md has task lines and
        all are `[x]`, clear auto-archives TODO.md + todos.json and resets TODO.md.
    action='critical': list only critical open items (used by turn-start hook).
    action='ingest_from_todo': ingests open TODO.md task lines.
    action='promote_to_todo': keeps #todo_id visible in TODO.md.
    action='close_with_todo_update': marks #todo_id done and flips the matching
        TODO.md task line if present.

    Changes to this store propagate back to native TodoWrite via the
    native TodoWrite merge -- items appear in the agent's native view
    on the next TodoWrite call.
    """
    _track("hme_todo")
    append_session_narrative("hme_todo", f"hme_todo({action}): {text[:40] or todo_id}")
    # Auto-prune done todos on EVERY invocation (any source past its
    # prune horizon). Keeps the store from accumulating done entries
    # silently between active operations. Cheap (single pass), no
    # state changes for fresh stores. The user complaint that landed
    # this: "look into why you would be skipping clearing done
    # todo/lifesavers and letting them stack."
    with _todo_lock:
        _meta_pre, _todos_pre = _load_todos()
        _pruned_count = _prune_done_todos_universal(_meta_pre, _todos_pre)
        if _pruned_count:
            _save_todos(_meta_pre, _todos_pre)
            logger.info(f"hme_todo: auto-pruned {_pruned_count} done entries past horizon")

    def _render(todos: list) -> str:
        return _format_todos_mermaid(todos) if fmt == "mermaid" else _format_todos(todos)

    with _todo_lock:
        meta, todos = _load_todos()

        if action == "list":
            # Soft reminder when done-but-not-yet-pruned count crosses
            # a threshold. Stays under the auto-prune horizon (so we
            # don't churn the file) but tells the agent/operator the
            # store is accumulating completions worth a `clear` pass.
            done_count = sum(1 for t in todos if _check_main_done(t))
            rendered = _render(todos)
            if done_count >= 15:
                rendered = (
                    f"<system-reminder>\n"
                    f"HME todo store has {done_count} done entries pending cleanup. "
                    f"Use native TodoWrite normally; auto-prune will drop them after the "
                    f"horizon ({_DONE_TODO_PRUNE_AFTER_SECONDS // 86400}d for native, "
                    f"{_LIFESAVER_PRUNE_AFTER_SECONDS // 86400}d for lifesaver).\n"
                    f"</system-reminder>\n\n{rendered}"
                )
            return rendered

        if action == "critical":
            items = list_critical()
            if not items:
                return "No critical todos."
            return "\n".join(f"!!! #{i['id']} {i['text']}" for i in items)

        if action == "add":
            if not text.strip():
                return "Error: text= required for add."
            text_norm = text.strip()
            # Universal text-dedup for the hme_todo add path. If an OPEN
            # entry with identical text + parent_id already exists,
            # increment its recurrence_count instead of creating a
            # duplicate. Prevents the spam class the user reported
            # ("absolutely riddled with spam -- fix it so it never
            # happens again") from re-emerging via a different source.
            # The lifesaver path has its own normalization-aware dedup;
            # this exact-match dedup covers the agent/user-driven path
            # where text is deterministic.
            if parent_id:
                main = _find_main(todos, parent_id)
                if not main:
                    return f"Error: parent #{parent_id} not found."
                for s in main.get("subs", []):
                    if (
                        s.get("text", "").strip() == text_norm
                        and not s.get("done")
                    ):
                        s["recurrence_count"] = int(s.get("recurrence_count", 1)) + 1
                        s["ts"] = time.time()
                        _save_todos(meta, todos)
                        return (
                            f"Already exists as sub #{s['id']} of #{parent_id} "
                            f"(recurrence now {s['recurrence_count']}): "
                            f"{text_norm}\n\n{_render(todos)}"
                        )
                sub = _write_todo_entry(
                    meta, text=text, status=status, critical=critical,
                    on_done=on_done, parent_id=parent_id, tier=tier,
                )
                main.setdefault("subs", []).append(sub)
                _save_todos(meta, todos)
                return f"Added sub #{sub['id']} [{sub['tier']}] (sub of #{parent_id}): {text_norm}\n\n{_render(todos)}"
            for t in todos:
                if (
                    t.get("text", "").strip() == text_norm
                    and t.get("parent_id", 0) == 0
                    and not _check_main_done(t)
                ):
                    t["recurrence_count"] = int(t.get("recurrence_count", 1)) + 1
                    t["ts"] = time.time()
                    _save_todos(meta, todos)
                    return (
                        f"Already exists as #{t['id']} "
                        f"(recurrence now {t['recurrence_count']}): "
                        f"{text_norm}\n\n{_render(todos)}"
                    )
            entry = _write_todo_entry(
                meta, text=text, status=status, critical=critical, on_done=on_done,
                tier=tier,
            )
            todos.append(entry)
            _save_todos(meta, todos)
            return f"Added #{entry['id']} [{entry['tier']}]: {text_norm}\n\n{_render(todos)}"

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
                    return f"Cannot complete #{todo_id} -- sub-todos not done: {names}\n\n{_render(todos)}"
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
                # Parent was possibly auto-completed -- reset if so
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

        if action == "archive_now":
            # Force-archive: bypass _detect_complete_set() trigger.
            archive_result = _archive_set(set_name=text, force=True)
            if archive_result["ok"]:
                return (f"[ARCHIVE-NOW] Set archived to KB devlog:\n  {archive_result['devlog_path']}\n"
                        f"doc/templates/TODO.md reset to fresh slate.")
            return f"[!] Archive refused: {archive_result.get('message', 'unknown error')}"

        if action == "clear":
            detection = _detect_complete_set()
            archive_msg = ""
            if detection["complete"]:
                archive_result = _archive_set(set_name=text)
                if archive_result["ok"]:
                    archive_msg = (
                        f"\n\n[ARCHIVE] Set archived to KB devlog:\n  {archive_result['devlog_path']}\n"
                        f"doc/templates/TODO.md reset to fresh slate."
                    )
                else:
                    archive_msg = f"\n\n[!] Archive refused: {archive_result['message']}"
            elif detection["phases"]:
                missing_count = len(detection["missing"])
                if missing_count:
                    archive_msg = (
                        f"\n\n(Set not yet complete -- {missing_count} blocker(s); "
                        f"archive will fire on next `clear` once TODO.md has no open tasks. "
                        f"First blocker: {detection['missing'][0]})"
                    )
                _ingest_from_todo(meta, todos)
            before = len(todos)
            todos = [t for t in todos if not _check_main_done(t)]
            removed = before - len(todos)
            _save_todos(meta, todos)
            return f"Cleared {removed} completed todos.{archive_msg}\n\n{_render(todos)}"

        if action == "ingest_from_todo":
            phase_arg: int | str = 0
            if text.strip().lower() == "latest":
                phase_arg = "latest"
            elif text.strip().isdigit():
                phase_arg = int(text.strip())
            elif todo_id > 0:
                phase_arg = todo_id  # caller can pass via todo_id= as well
            ingested = _ingest_from_todo(meta, todos, phase=phase_arg)
            _save_todos(meta, todos)
            src = "doc/templates/TODO.md"
            if not ingested:
                return f"No new entries from {src} (all already in the HME todo store).\n"
            lines = [f"  + #{e['id']} [{e['tier']}] {e['text'][:80]}" for e in ingested]
            return f"Ingested {len(ingested)} entries from {src}:\n" + "\n".join(lines)

        if action == "promote_to_todo":
            if not todo_id:
                return "Error: todo_id= required for promote_to_todo."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target = sub or main
            target["source"] = "todo_md"
            target["status"] = target.get("status") or "pending"
            target["done"] = target.get("status") == "completed"
            line = _promote_to_todo(target)
            _save_todos(meta, todos)
            return f"Promoted #{todo_id} to doc/templates/TODO.md Next:\n  {line}"

        if action == "close_with_todo_update":
            if not todo_id:
                return "Error: todo_id= required for close_with_todo_update."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target = sub or main
            todo_flipped, shipped_line = _close_with_todo_update(target)
            # Mark done in the HME todo store.
            _mark_status(target, "completed")
            if sub is not None and _check_main_done(main):
                _mark_status(main, "completed")
            _save_todos(meta, todos)
            note = ""
            if todo_flipped:
                note = f" (flipped TODO.md item: {todo_flipped[:80]})"
            return f"Closed #{todo_id}{note}\nShipped: {shipped_line}\n"

        return ("Unknown action. Use: list, add, done, undo, remove, clear, archive_now, critical, "
                "ingest_from_todo, promote_to_todo, close_with_todo_update.")



# on_done dispatch -- E6: lifecycle triggers fire when entries are completed


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
