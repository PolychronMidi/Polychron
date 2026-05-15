"""Native TodoWrite <-> HME merge -- bridges Claude Code's native TodoWrite
tool to HME's persistent todo store via the event-kernel TodoWrite hook.

Extracted from todo.py (was lines 717-849). todo.py re-exports merge_native_todowrite.
"""
import json
import os
import re
import sys
import time
import logging

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

from server import context as ctx
from server.tools_analysis import _track

logger = logging.getLogger("HME")

# Pull persistence + entry primitives from the parent module. todo.py loads
from server.tools_analysis.todo import (
    _load_todos, _save_todos, _write_todo_entry, _allocate_id,
    _find_main, _find_any, _check_main_done, _mark_status,
    _todo_lock,
)
from server.tools_analysis.todo_lifesaver import (
    _LIFESAVER_STALE_SECONDS, _MAX_CRITICAL_IN_MERGE,
    _expire_stale_lifesavers, _enforce_lifesaver_caps,
    _prune_done_todos_universal,
)


def merge_native_todowrite(incoming: list) -> list:
    """E3: merge an incoming native TodoWrite payload with the HME store.

    Preserves HME-only items (lifesaver, onboarding, hme_todo) that native
    TodoWrite doesn't know about and returns a MERGED list that becomes the
    updatedInput for the real TodoWrite call. Result is ordered:
      1. critical items first (lifesaver, etc.) -- capped at _MAX_CRITICAL_IN_MERGE
      2. onboarding walkthrough (flattened: parent + indented subs)
      3. agent's incoming native items
      4. other hme_todo items the agent didn't include

    Native items the agent IS submitting win for matching text -- their status
    updates flow through to the store. Stale lifesaver items auto-resolve
    before merge so ancient alerts don't drown current intent.
    """
    with _todo_lock:
        meta, store = _load_todos()
        _expire_stale_lifesavers(meta, store)

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
                tier=existing.get("tier", "E3"),
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
            if src in ("lifesaver", "onboarding", "hme_todo", "spec", "todo_md"):
                new_store.append(t)

        _save_todos(meta, new_store)

        # Build the flattened list returned as updatedInput for native TodoWrite.
        flat = []
        # Order: critical first, onboarding next, then everything else
        def _sort_key(t):
            if t.get("critical"):
                return (0, t["id"])
            if t.get("source") == "onboarding" and t.get("parent_id", 0) == 0:
                return (1, t["id"])
            return (2, t["id"])

        sorted_entries = sorted(new_store, key=_sort_key)
        # Cap critical items to _MAX_CRITICAL_IN_MERGE to avoid alert-flood
        critical_shown = 0
        critical_overflow = 0
        for t in sorted_entries:
            is_critical = bool(t.get("critical"))
            if is_critical:
                if t.get("status") == "completed":
                    continue
                if critical_shown >= _MAX_CRITICAL_IN_MERGE:
                    critical_overflow += 1
                    continue
                critical_shown += 1
            prefix = ""
            if is_critical:
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
                sub_prefix = "  + "
                if t.get("source") == "onboarding":
                    sub_prefix = "  + [HME] "
                flat.append({
                    "content": sub_prefix + s["text"],
                    "activeForm": s.get("activeForm") or (sub_prefix + s["text"]),
                    "status": s.get("status", "pending"),
                })
        if critical_overflow > 0:
            try:
                from tool_invocations import i_form as _i_form
                _signals_hint = _i_form('status', value='signals')
            except ImportError:
                _signals_hint = "i/status mode=signals"  # tool-form-ok: fallback when helper unavailable
            summary_text = (
                f"[CRITICAL] +{critical_overflow} older critical alert(s) "
                f"suppressed -- run `{_signals_hint}` or check todos.json"
            )
            flat.insert(critical_shown, {
                "content": summary_text,
                "activeForm": summary_text,
                "status": "pending",
            })
        return flat
