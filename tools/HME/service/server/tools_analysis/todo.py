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
import re
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
    ENV.require("PROJECT_ROOT"), "output", "metrics", "todo-graph.md"
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
    meta, todos = _split_meta(_load_raw())
    # Backfill `tier` for legacy entries that predate the field. Pure
    # in-memory normalization — does not write back to disk on its own;
    # the next save (any mutating action) persists the backfilled values.
    # Default tier="medium" matches SPEC.md's graceful-degradation rule.
    for t in todos:
        if isinstance(t, dict):
            if "tier" not in t:
                t["tier"] = "medium"
            for s in t.get("subs", []):
                if isinstance(s, dict) and "tier" not in s:
                    s["tier"] = "medium"
    return meta, todos


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


_VALID_TIERS = ("easy", "medium", "hard")


def _normalize_tier(tier: str) -> str:
    """Coerce a tier value to one of {easy, medium, hard}. Defaults to
    'medium' for unknown / empty / legacy entries — matches SPEC.md's
    'graceful degradation' rule for unlabeled items."""
    t = (tier or "").strip().lower()
    if t in _VALID_TIERS:
        return t
    return "medium"


def _write_todo_entry(meta: dict, *, text: str, status: str = "pending",
                      active_form: str = "", critical: bool = False,
                      source: str = "hme_todo", on_done: str = "",
                      parent_id: int = 0, tier: str = "medium") -> dict:
    """Canonical entry constructor — every producer goes through this to ensure
    schema stability across LIFESAVER, native mirror, hme_todo, and onboarding.

    `tier` is one of {easy, medium, hard} (SPEC.md "Difficulty labels").
    Routes the item to the appropriate co-buddy via the
    `effective = max(item_tier, buddy_floor)` rule. Defaults to 'medium'
    so legacy/unlabeled items still dispatch sensibly.
    """
    # Single-writer invariant: only tools_analysis.todo may write the store.
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



# External API


# Lifesaver-todo store-protection knobs. Override via env if the defaults
# need tuning per deployment. The defaults are conservative — chosen to
# keep the open-set under 20 entries and the youngest-stale entry under
# 24h, which together prevent the runaway-monitor flood that put 35
# zombie llamacpp_offload_invariant entries in the store before this
# rule landed (see invariants.json: lifesaver-todo-dedup).
_LIFESAVER_MAX_OPEN = int(os.environ.get("HME_LIFESAVER_TODO_MAX_OPEN", "20"))
_LIFESAVER_TTL_SECONDS = int(os.environ.get("HME_LIFESAVER_TODO_TTL_SEC", str(24 * 3600)))
# Prune-after: how long a DONE lifesaver entry stays in the store before
# being deleted entirely. Once resolved, lifesaver entries have no
# operational value — they're not historical lessons (those are KB
# entries / commits), they're just monitor-loop residue. Default 3 days
# keeps recent context for debugging while preventing unbounded growth
# of todos.json + todo-graph.md (the spam vector the user filed).
_LIFESAVER_PRUNE_AFTER_SECONDS = int(os.environ.get("HME_LIFESAVER_TODO_PRUNE_SEC", str(3 * 24 * 3600)))


def _normalize_error_for_dedup(error: str) -> str:
    """Strip variable tokens (numeric values, MB/GB sizes, hex addresses,
    paths, timestamps) from the error string so structurally-identical
    failures with different runtime numbers collapse to ONE dedup key.

    Without this, an OOM error that varies only in "GPU1 has 17342 MB
    free" vs "GPU1 has 16826 MB free" creates two distinct entries.
    The user's spam-cleanup ticket caught a runaway store with 35 such
    near-duplicates from a single monitor loop firing on memory drift.
    """
    if not error:
        return ""
    s = error
    # Memory sizes: "17342 MB", "22049 MB", "228GB", "1.5 GiB"
    s = re.sub(r"\b\d+(?:\.\d+)?\s*(?:[KMGT]i?B|[KMGT]B)\b", "<SIZE>", s, flags=re.IGNORECASE)
    # Plain large numbers (>= 4 digits) — covers retry counts, line numbers,
    # raw byte values, port numbers, timestamps. Smaller numbers stay
    # because they often distinguish error classes (e.g. HTTP 503 vs 500).
    s = re.sub(r"\b\d{4,}\b", "<NUM>", s)
    # Hex pointers / addresses
    s = re.sub(r"\b0x[0-9a-fA-F]+\b", "<HEX>", s)
    # Absolute paths down to filename — keep filename as it's often the
    # error class signal, drop the variable directory prefix
    s = re.sub(r"/[A-Za-z0-9_\-./]+/([A-Za-z0-9_\-]+\.[A-Za-z0-9]+)", r"<PATH>/\1", s)
    # ISO timestamps and dates
    s = re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?", "<TS>", s)
    s = re.sub(r"\d{4}-\d{2}-\d{2}", "<DATE>", s)
    # Collapse runs of whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _enforce_lifesaver_caps(meta: dict, todos: list) -> int:
    """Sweep two store-protection invariants on every register call:

    1. TTL: lifesaver entries older than HME_LIFESAVER_TODO_TTL_SEC
       (default 24h) auto-resolve with reason=stale-ttl. The recurrence
       counter resets to 1 if the same error fires again later, so
       chronic real failures don't get silently swept under the rug —
       they re-enter as fresh entries when they recur.
    2. MAX_OPEN: at most HME_LIFESAVER_TODO_MAX_OPEN concurrently-open
       lifesaver entries. When the cap is hit, the OLDEST open entries
       (by ts) are auto-resolved with reason=max-open-cap so newer
       failures still surface. Without this cap a runaway monitor loop
       can fill the store unbounded.

    Returns count of entries auto-resolved.
    """
    now = time.time()
    resolved_count = 0
    # TTL pass. _check_main_done reads `t["done"]` (a mirror of
    # status == "completed"); BOTH must be set in lockstep or the
    # subsequent MAX_OPEN re-scan miscounts and resolves entries that
    # the TTL pass already marked.
    for t in todos:
        if t.get("source") != "lifesaver" or _check_main_done(t):
            continue
        age = now - float(t.get("ts", now))
        if age > _LIFESAVER_TTL_SECONDS:
            t["status"] = "completed"
            t["done"] = True
            t["resolved_ts"] = now
            t["resolved_reason"] = "stale-ttl"
            resolved_count += 1
    # MAX_OPEN pass — recompute open set after TTL sweep
    open_lifesavers = [
        t for t in todos
        if t.get("source") == "lifesaver" and not _check_main_done(t)
    ]
    if len(open_lifesavers) > _LIFESAVER_MAX_OPEN:
        # Resolve the oldest excess. Sort by ts ascending; trim until at cap.
        open_lifesavers.sort(key=lambda x: float(x.get("ts", 0)))
        excess = len(open_lifesavers) - _LIFESAVER_MAX_OPEN
        for t in open_lifesavers[:excess]:
            t["status"] = "completed"
            t["done"] = True
            t["resolved_ts"] = now
            t["resolved_reason"] = "max-open-cap"
            resolved_count += 1
    if resolved_count:
        meta["updated_ts"] = now
    return resolved_count


def _prune_done_lifesavers(meta: dict, todos: list) -> int:
    """Delete done lifesaver entries whose resolved_ts (or ts as fallback
    for legacy entries) is older than HME_LIFESAVER_TODO_PRUNE_SEC.

    Once a lifesaver alert is resolved, it carries no operational value
    — historical lessons live in commits / KB / docs. Keeping resolved
    entries in todos.json forever bloats both the JSON store and the
    rendered todo-graph.md (the spam vector the user reported). Pruning
    is safe because:
      1. The dedup key would re-spawn an identical entry if the same
         failure recurs after pruning (cleanup loop self-heals).
      2. recurrence_count + resolved_reason are preserved in any
         downstream metric that reads the file before pruning happens.

    Mutates `todos` in place; returns count pruned.
    """
    now = time.time()
    keep = []
    pruned = 0
    for t in todos:
        if (
            t.get("source") == "lifesaver"
            and _check_main_done(t)
        ):
            # Use the EARLIER of (original ts, resolved_ts) as the prune
            # reference. This makes retroactive cleanup work correctly:
            # a batch sweep that just marked many old entries done sets
            # resolved_ts=now, but their original ts (when the failure
            # actually fired) may be weeks old — those should prune
            # immediately, not wait another 3 days.
            ts_orig = float(t.get("ts") or now)
            ts_resolved = float(t.get("resolved_ts") or now)
            ref_ts = min(ts_orig, ts_resolved)
            if (now - ref_ts) > _LIFESAVER_PRUNE_AFTER_SECONDS:
                pruned += 1
                continue
        keep.append(t)
    if pruned:
        todos[:] = keep
        meta["updated_ts"] = now
    return pruned


def register_todo_from_lifesaver(source: str, error: str, severity: str = "CRITICAL"):
    """LIFESAVER entry point — dedup-aware with store-protection caps.

    Dedup keys on the SEVERITY + SOURCE + NORMALIZED-ERROR-PREFIX. The
    error is normalized first (memory sizes, large numbers, paths,
    timestamps redacted to placeholders) so structurally-identical
    failures with varying runtime numbers collapse to ONE entry that
    increments its recurrence_count rather than spawning duplicates.

    Store-protection (every call): a TTL sweep auto-resolves open
    lifesaver entries older than 24h, and a hard cap (default 20)
    auto-resolves the oldest excess if the open set grows past the
    limit. Catches the runaway-monitor flood class even when dedup
    misses a near-duplicate (e.g. when the source field itself varies).

    Pairs with failure_genealogy.record_failure which dedups the same
    alerts at the LIFESAVER log layer.
    """
    text = f"CRITICAL ERROR - LIFESAVER ALERT: [{severity}] {source}: {error}"
    # Normalized dedup key — strips variable tokens before computing the
    # 80-char prefix so memory-variant errors collapse into ONE entry.
    normalized_err = _normalize_error_for_dedup(error or "")
    dedup_key = f"{severity}|{source}|{normalized_err[:80]}"
    with _todo_lock:
        meta, todos = _load_todos()
        # Sweep TTL + max-open caps BEFORE checking dedup so capped/stale
        # entries can't block a legitimate fresh-recurrence registration.
        cap_resolved = _enforce_lifesaver_caps(meta, todos)
        if cap_resolved:
            logger.info(f"LIFESAVER→TODO store-protection auto-resolved {cap_resolved} entries (ttl/cap)")
        # Prune done-lifesaver residue after the TTL pass so newly-aged-out
        # entries get a chance to be observed once before deletion-on-next-call.
        pruned = _prune_done_lifesavers(meta, todos)
        if pruned:
            logger.info(f"LIFESAVER→TODO pruned {pruned} done entries past prune horizon")
        for existing in todos:
            if (
                existing.get("source") == "lifesaver"
                and not _check_main_done(existing)
            ):
                # Prefer dedup_key match (set on entries written under this
                # dedup regime). Fall back to recomputing the key from the
                # existing entry's stored severity/source/text for legacy
                # entries that predate the dedup_key field.
                existing_key = existing.get("dedup_key")
                if existing_key is None:
                    # Reconstruct: extract error portion past the
                    # "[<severity>] <source>: " separator, normalize, key.
                    existing_text = existing.get("text", "")
                    # Try every severity prefix until one matches; severity
                    # is part of the canonical text shape.
                    existing_err = ""
                    for sev in ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTICE"):
                        sep = f"[{sev}] {source}: "
                        if sep in existing_text:
                            existing_err = existing_text.split(sep, 1)[1]
                            existing_key = f"{sev}|{source}|{_normalize_error_for_dedup(existing_err)[:80]}"
                            break
                if existing_key == dedup_key:
                    # Match — increment recurrence and refresh ts. The TTL
                    # check above ran on the SAVED ts, so a refresh here
                    # legitimately keeps a chronically-recurring failure
                    # surfaced as long as it keeps firing. A failure that
                    # stops firing for 24h ages out via the TTL sweep on
                    # the next register call.
                    existing["ts"] = time.time()
                    existing["recurrence_count"] = int(existing.get("recurrence_count", 1)) + 1
                    # Backfill dedup_key on legacy entries that lacked one.
                    if existing.get("dedup_key") is None:
                        existing["dedup_key"] = dedup_key
                    _save_todos(meta, todos)
                    return
        entry = _write_todo_entry(
            meta, text=text, status="pending",
            critical=True, source="lifesaver",
        )
        entry["recurrence_count"] = 1
        entry["dedup_key"] = dedup_key
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
                t["done"] = True
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


# Lifesaver-critical items that haven't been touched in this many seconds
# are considered stale and auto-resolved on the next merge. Rationale:
# register_todo_from_lifesaver dedupes repeating errors, so a stale entry
# means the source stopped recurring — the agent isn't going to act on an
# alert about a transient GPU OOM from 8 days ago. Without this cleanup,
# every TodoWrite call re-surfaces a mountain of ancient CRITICAL items.
_LIFESAVER_STALE_SECONDS = 6 * 3600

# Hard cap on how many critical items render in the merged output. Anything
# past this is collapsed into a single "+N older critical" summary. Prevents
# a genuine storm of alerts from drowning the agent's real todos.
_MAX_CRITICAL_IN_MERGE = 3


def _expire_stale_lifesavers(meta: dict, todos: list) -> int:
    """Auto-resolve any pending lifesaver todo older than _LIFESAVER_STALE_SECONDS.
    Dedup already prevents duplicates; age-based expiry prevents accumulation."""
    cutoff = time.time() - _LIFESAVER_STALE_SECONDS
    expired = 0
    for t in todos:
        if (t.get("source") == "lifesaver"
                and t.get("status") == "pending"
                and float(t.get("ts", 0)) < cutoff):
            t["status"] = "completed"
            t["resolved_ts"] = time.time()
            t["resolved_reason"] = "stale"
            expired += 1
    return expired


def merge_native_todowrite(incoming: list) -> list:
    """E3: merge an incoming native TodoWrite payload with the HME store.

    Preserves HME-only items (lifesaver, onboarding, hme_todo) that native
    TodoWrite doesn't know about and returns a MERGED list that becomes the
    updatedInput for the real TodoWrite call. Result is ordered:
      1. critical items first (lifesaver, etc.) — capped at _MAX_CRITICAL_IN_MERGE
      2. onboarding walkthrough (flattened: parent + indented subs)
      3. agent's incoming native items
      4. other hme_todo items the agent didn't include

    Native items the agent IS submitting win for matching text — their status
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

        sorted_entries = sorted(new_store, key=_sort_key)
        # Cap critical items to _MAX_CRITICAL_IN_MERGE to avoid alert-flood
        # drowning the agent's real todos. Completed crits are filtered out
        # entirely (no value in re-surfacing resolved alerts), and overflow
        # of pending crits collapses to one summary entry.
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
                sub_prefix = "  └ "
                if t.get("source") == "onboarding":
                    sub_prefix = "  └ [HME] "
                flat.append({
                    "content": sub_prefix + s["text"],
                    "activeForm": s.get("activeForm") or (sub_prefix + s["text"]),
                    "status": s.get("status", "pending"),
                })
        if critical_overflow > 0:
            summary_text = (
                f"[CRITICAL] +{critical_overflow} older critical alert(s) "
                f"suppressed — run `i/status mode=signals` or check todos.json"
            )
            flat.insert(critical_shown, {
                "content": summary_text,
                "activeForm": summary_text,
                "status": "pending",
            })
        return flat



# SPEC/TODO bridge — connects ephemeral i/todo state to durable
# doc/SPEC.md + doc/TODO.md handoff docs. See doc/SPEC.md Phase 0.


_SPEC_FILE = os.path.join(ENV.require("PROJECT_ROOT"), "doc", "SPEC.md")
_TODOMD_FILE = os.path.join(ENV.require("PROJECT_ROOT"), "doc", "TODO.md")
# Archive lives under KB as the "devlog" arm — searchable through the
# same substrate as other knowledge entries, decoupled from the active
# doc/ directory so completed work doesn't tax agents reading the spec.
# Each archive event writes ONE timestamped file containing the
# just-completed set of phases (no monthly rotation; the archive trigger
# IS set-completion).
_DEVLOG_DIR = os.path.join(ENV.require("PROJECT_ROOT"), "tools", "HME", "KB", "devlog")
# Matches a Next-up entry: "- [tier] description. Reason: ..."
_NEXT_UP_RE = re.compile(
    r"^\s*-\s+\[(easy|medium|hard)\]\s+(.+?)(?:\s+Reason:\s+(.+?))?\s*$",
    re.IGNORECASE,
)
# Matches an open spec checkbox: "- [ ] [tier] text"
_SPEC_OPEN_RE = re.compile(
    r"^(\s*-\s+\[)\s(\]\s+\[(?:easy|medium|hard)\]\s+)(.+?)$",
    re.IGNORECASE,
)


def _read_section(md_text: str, header: str) -> list[str]:
    """Return the lines of a section (between '## <header>' and the
    next '## ' or '---' marker), stripped of empty leading/trailing
    lines. Header match is case-sensitive."""
    lines = md_text.splitlines()
    out = []
    in_section = False
    for line in lines:
        if line.startswith("## "):
            if in_section:
                break
            if line.strip()[3:].strip() == header:
                in_section = True
                continue
        if in_section:
            if line.startswith("---"):
                break
            out.append(line)
    # Trim leading/trailing blanks
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return out


def _ingest_from_spec(meta: dict, todos: list) -> list[dict]:
    """Read doc/TODO.md's Next up section, materialize each entry as an
    i/todo entry with source='spec' and tier=<label>. Skips entries
    whose text already matches an OPEN i/todo entry (universal dedup).
    Returns the list of newly-created entries."""
    if not os.path.exists(_TODOMD_FILE):
        logger.warning(f"ingest_from_spec: {_TODOMD_FILE} missing")
        return []
    with open(_TODOMD_FILE, encoding="utf-8") as f:
        md = f.read()
    next_up_lines = _read_section(md, "Next up (queued for next cycle)")
    created = []
    for line in next_up_lines:
        # Skip HTML comments + empty lines
        s = line.strip()
        if not s or s.startswith("<!--") or s.startswith("-->"):
            continue
        m = _NEXT_UP_RE.match(line)
        if not m:
            continue
        tier_str, body, reason = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
        # Strip trailing period from body if reason was attached
        if body.endswith("."):
            body = body[:-1]
        text_norm = body
        # Dedup: skip if an open entry with same text exists
        already = False
        for t in todos:
            if (
                t.get("text", "").strip() == text_norm
                and not _check_main_done(t)
            ):
                already = True
                break
        if already:
            continue
        text_with_provenance = body
        if reason:
            text_with_provenance = f"{body} (from spec — {reason})"
        entry = _write_todo_entry(
            meta, text=text_with_provenance, status="pending",
            critical=False, source="spec", tier=tier_str.lower(),
        )
        todos.append(entry)
        created.append(entry)
    return created


def _promote_to_spec(entry: dict) -> str:
    """Append an i/todo entry to doc/TODO.md's Next up section. Returns
    the appended line for caller display."""
    tier = _normalize_tier(entry.get("tier", "medium"))
    text = entry.get("text", "").strip()
    line = f"- [{tier}] {text}. Reason: i/todo #{entry.get('id')} promoted at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if not os.path.exists(_TODOMD_FILE):
        logger.warning(f"promote_to_spec: {_TODOMD_FILE} missing — creating")
        with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
            f.write("# TODO\n\n## In flight\n\n## Just shipped (last cycle)\n\n## Next up (queued for next cycle)\n\n")
    with open(_TODOMD_FILE, encoding="utf-8") as f:
        md = f.read()
    # Insert at end of Next up section (before --- or EOF)
    marker = "## Next up (queued for next cycle)"
    if marker not in md:
        md += f"\n{marker}\n\n{line}\n"
    else:
        # Find where to insert: end of Next up section
        idx = md.index(marker) + len(marker)
        rest = md[idx:]
        # Find next '---' or end of file
        end = rest.find("\n---")
        if end == -1:
            end = len(rest)
        # Append line just before that boundary
        before = md[:idx] + rest[:end].rstrip() + "\n" + line + "\n"
        after = rest[end:]
        md = before + after
    with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
        f.write(md)
    return line


def _normalize_for_match(s: str) -> str:
    """Coerce two markdown entries to a comparable form: lowercase,
    strip backticks/asterisks/quotes, collapse whitespace, drop trailing
    period. SPEC.md items and TODO.md Next-up entries can be hand-edited
    differently between the two docs (e.g. one has backticks around
    `i/todo` and the other doesn't), so a strict equality match misses
    legitimately-paired items. This normalization is the same shape as
    the lifesaver dedup normalizer — strip noise before comparing.
    """
    if not s:
        return ""
    out = s.lower()
    # Drop markdown emphasis chars + quote marks
    out = re.sub(r"[`*_'\"]+", "", out)
    # Collapse whitespace
    out = re.sub(r"\s+", " ", out).strip()
    # Trim trailing period (TODO.md format includes "Reason:" after period;
    # SPEC.md items often end without period)
    if out.endswith("."):
        out = out[:-1]
    return out


def _common_prefix_len(a: str, b: str) -> int:
    """Length of the longest common prefix of normalized strings."""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


_JUST_SHIPPED_LIMIT = int(os.environ.get("HME_JUST_SHIPPED_LIMIT", "10"))


def _ensure_devlog_dir() -> None:
    os.makedirs(_DEVLOG_DIR, exist_ok=True)


def _slugify(text: str, max_len: int = 40) -> str:
    """Filesystem-safe slug for archive filenames."""
    s = re.sub(r"[^a-zA-Z0-9_\-]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "set"


def _detect_complete_set() -> dict:
    """Detect whether ALL phases in doc/SPEC.md are complete (each phase
    has zero `[ ]` items AND a `_Phase N complete_` sentinel paragraph).
    Returns {complete: bool, phases: [(n, header, start, end)], missing: [reason...]}.

    A "set" = all phases currently in SPEC.md. The archive trigger fires
    only when the entire set is complete — that's the "fresh slate"
    moment the user asked for. Half-completed sets stay in place."""
    out = {"complete": False, "phases": [], "missing": []}
    if not os.path.exists(_SPEC_FILE):
        out["missing"].append(f"{_SPEC_FILE} missing")
        return out
    with open(_SPEC_FILE, encoding="utf-8") as f:
        spec_md = f.read()
    blocks = _phase_blocks(spec_md)
    if not blocks:
        out["missing"].append("no phase blocks found in SPEC")
        return out
    sentinel_re = re.compile(r"_phase\s+\d+\s+complete_", re.IGNORECASE)
    open_re = re.compile(r"^\s*-\s+\[\s\]")
    lines = spec_md.split("\n")
    all_complete = True
    for start, end, header in blocks:
        m = re.match(r"^###\s+Phase\s+(\d+):", header)
        if not m:
            continue
        phase_n = int(m.group(1))
        block = lines[start:end]
        opens = sum(1 for ln in block if open_re.match(ln))
        has_sentinel = any(sentinel_re.search(ln) for ln in block)
        out["phases"].append({"n": phase_n, "header": header.strip(), "start": start, "end": end,
                              "open_items": opens, "has_sentinel": has_sentinel})
        if opens > 0:
            out["missing"].append(f"Phase {phase_n} has {opens} open `[ ]` item(s)")
            all_complete = False
        elif not has_sentinel:
            out["missing"].append(f"Phase {phase_n} missing `_Phase {phase_n} complete_` sentinel")
            all_complete = False
    out["complete"] = all_complete and bool(out["phases"])
    return out


def _archive_set(set_name: str = "") -> dict:
    """Archive the entire set of phases in doc/SPEC.md to a single
    timestamped KB devlog file. Refuses if any phase is incomplete.

    Layout: tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md
    Contents: all phase blocks verbatim + the SPEC's preamble (Goal /
    Architecture / Phases header) + any closing sections (Glossary,
    Three-loop NEVER lists, etc.) — the FULL spec snapshot at archive
    time. Future agents can grep the devlog for "how did we land
    Phase X" without paying the active-spec context tax.

    Also archives the matching TODO.md state (entire file snapshot,
    since "Just shipped" entries correlate with phases) so the devlog
    captures both the plan AND the what-shipped record.

    After archive: doc/SPEC.md is replaced with a fresh-slate
    template; doc/TODO.md is replaced with empty 3-section template.
    The active docs are now ready for the NEXT set without any
    completed-work tax.

    Returns {ok: bool, devlog_path: str, message: str}."""
    detection = _detect_complete_set()
    if not detection["complete"]:
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
        # Derive slug from the first phase's header
        first_header = detection["phases"][0]["header"]
        m = re.match(r"^###\s+Phase\s+\d+:\s*(.+?)\s*$", first_header)
        set_name = m.group(1) if m else "set"
    slug = _slugify(set_name)
    devlog_path = os.path.join(_DEVLOG_DIR, f"{ts}-{slug}.md")
    # Snapshot SPEC.md fully + TODO.md fully into the devlog file.
    spec_md = open(_SPEC_FILE, encoding="utf-8").read() if os.path.exists(_SPEC_FILE) else ""
    todo_md = open(_TODOMD_FILE, encoding="utf-8").read() if os.path.exists(_TODOMD_FILE) else ""
    phase_count = len(detection["phases"])
    devlog_content = [
        f"# Devlog — {set_name}",
        "",
        f"_Archived: {ts}_",
        f"_Phases: {phase_count} ({', '.join(str(p['n']) for p in detection['phases'])})_",
        "",
        "## SPEC snapshot",
        "",
        spec_md.rstrip(),
        "",
        "## TODO snapshot",
        "",
        todo_md.rstrip(),
        "",
    ]
    with open(devlog_path, "w", encoding="utf-8") as f:
        f.write("\n".join(devlog_content) + "\n")
    # Reset active SPEC.md to a fresh-slate template — preserves the
    # preamble (Goal / Architecture) and trailing sections (Glossary,
    # Three-loop NEVER lists, How this file evolves, Difficulty labels,
    # Empty-queue bail) since those are stable across sets. Drops only
    # the Phase blocks — those moved to the devlog.
    _reset_spec_to_fresh_slate(set_name, ts, devlog_path)
    _reset_todo_to_fresh_slate()
    return {
        "ok": True,
        "devlog_path": devlog_path,
        "message": f"Archived {phase_count} phase(s) to {devlog_path}; doc/SPEC.md and doc/TODO.md reset to fresh slate.",
    }


def _reset_spec_to_fresh_slate(prev_set_name: str, prev_ts: str, devlog_path: str) -> None:
    """After archiving a set, replace the Phase blocks in doc/SPEC.md
    with an empty placeholder pointing at the devlog. Keeps preamble
    (Goal / Architecture) and trailing sections (Glossary, NEVER lists,
    How-this-file-evolves, Difficulty labels, Empty-queue bail) intact —
    those are stable across sets and don't need rewriting."""
    if not os.path.exists(_SPEC_FILE):
        return
    with open(_SPEC_FILE, encoding="utf-8") as f:
        spec_md = f.read()
    lines = spec_md.split("\n")
    blocks = _phase_blocks(spec_md)
    if not blocks:
        return
    first_phase_start = blocks[0][0]
    last_phase_end = blocks[-1][1]
    # Replace the [first_phase_start, last_phase_end) span with a
    # placeholder note linking the archived devlog. Anything BEFORE
    # first_phase_start is preamble (Goal / Architecture / Phases
    # header); anything FROM last_phase_end onward is post-phases
    # (Deferred / Glossary / How this evolves / etc.).
    placeholder = [
        "",
        f"_Previous set ({prev_set_name}) archived {prev_ts} to {os.path.relpath(devlog_path, ENV.require('PROJECT_ROOT'))}._",
        "",
        "### Phase 0: <next set — name>",
        "",
        "<1-paragraph context for the new set.>",
        "",
        "- [ ] [easy] First item of the new set",
        "",
    ]
    new_lines = lines[:first_phase_start] + placeholder + lines[last_phase_end:]
    with open(_SPEC_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(new_lines))


def _reset_todo_to_fresh_slate() -> None:
    """After archiving a set, reset doc/TODO.md to the empty 3-section
    template. The previous set's "Just shipped" entries are preserved
    in the devlog snapshot."""
    if not os.path.exists(_TODOMD_FILE):
        return
    fresh = (
        "# Polychron HME TODO (handoff doc)\n\n"
        "> Cross-cycle state. Every skill reads this on start and updates it on close. "
        "Three sections, in this order. See [doc/SPEC.md](SPEC.md) for the full architectural plan.\n\n"
        "## In flight\n\n"
        "<!-- Exactly one line per currently-running skill, format:\n"
        "  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>\n"
        "  Empty when no skill is running. -->\n\n"
        "## Just shipped (last cycle)\n\n"
        "<!-- Append-on-close, newest first. Trim to last 10; older history lives in\n"
        "  the previous set's devlog at tools/HME/KB/devlog/. -->\n\n"
        "## Next up (queued for next cycle)\n\n"
        "<!-- One line per queued item:\n"
        "  - [<difficulty>] <description>. Reason: <source> -->\n\n"
        "(empty — populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)\n\n"
        "---\n\n"
        "When this Next up is empty AND every `- [ ]` in [doc/SPEC.md](SPEC.md) has been "
        "flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "
        "\"Empty-queue bail\" appendix.\n"
    )
    with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
        f.write(fresh)


def _archive_just_shipped_overflow(trimmed_entries: list[str]) -> str:
    """When TODO.md "Just shipped" trims past the rolling-window cap
    mid-set (before the set is fully archived), the trimmed entries
    land in the current devlog scratch file so they're not lost.
    Path: tools/HME/KB/devlog/_in-flight-shipped-overflow.md (single
    rolling file, cleared on next archive_set)."""
    if not trimmed_entries:
        return ""
    _ensure_devlog_dir()
    overflow_path = os.path.join(_DEVLOG_DIR, "_in-flight-shipped-overflow.md")
    header_present = os.path.exists(overflow_path)
    body = []
    if not header_present:
        body.append("# In-flight just-shipped overflow")
        body.append("")
        body.append("> Trimmed from doc/TODO.md \"Just shipped\" rolling-10 window mid-set. "
                    "Cleared when the current set is archived via `i/todo archive_set`.")
        body.append("")
    body.append(f"<!-- trimmed {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} -->")
    body.extend(trimmed_entries)
    body.append("")
    with open(overflow_path, "a", encoding="utf-8") as f:
        if header_present:
            f.write("\n")
        f.write("\n".join(body) + "\n")
    return overflow_path


def _trim_just_shipped(md: str) -> tuple[str, int]:
    """Trim the Just shipped section to most recent N entries (per
    skill-set's rolling-window pattern). Older entries live in SPEC.md
    phase blocks + git log — the user said the file should not bloat
    over time. Mutates the section in-place; non-list lines (HTML
    comments, blank lines) are preserved. Returns (new_md, trimmed_count)."""
    marker = "## Just shipped (last cycle)"
    if marker not in md:
        return md, 0
    lines = md.split("\n")
    out = []
    in_section = False
    in_comment = False
    entry_count = 0
    trimmed = 0
    for line in lines:
        s = line.strip()
        if s == marker:
            out.append(line)
            in_section = True
            entry_count = 0
            continue
        if in_section:
            # Section ends at next "## " or "---"
            if s.startswith("## ") or s.startswith("---"):
                in_section = False
                out.append(line)
                continue
            # Track comment blocks — never trim inside them.
            if "<!--" in line and "-->" not in line:
                in_comment = True
                out.append(line)
                continue
            if in_comment:
                out.append(line)
                if "-->" in line:
                    in_comment = False
                continue
            # Real entry line (markdown list item)
            if s.startswith("- "):
                entry_count += 1
                if entry_count > _JUST_SHIPPED_LIMIT:
                    trimmed += 1
                    continue
            out.append(line)
            continue
        out.append(line)
    return "\n".join(out), trimmed


def _phase_blocks(spec_md: str) -> list[tuple[int, int, str]]:
    """Parse doc/SPEC.md for `### Phase <N>: <name>` blocks. Returns
    list of (start_line_idx, end_line_idx_exclusive, header_line)
    tuples. The end is the line where the next `### Phase` or `## `
    starts (or EOF). Used by phase-completion detection."""
    lines = spec_md.split("\n")
    starts = []
    for i, line in enumerate(lines):
        if re.match(r"^###\s+Phase\s+\d+:", line):
            starts.append((i, line))
    blocks = []
    for k, (start, header) in enumerate(starts):
        if k + 1 < len(starts):
            end = starts[k + 1][0]
        else:
            # Phase block ends at next "## " (top-level section) or EOF
            end = len(lines)
            for j in range(start + 1, len(lines)):
                if lines[j].startswith("## "):
                    end = j
                    break
        blocks.append((start, end, header))
    return blocks


def _detect_phase_complete(spec_md: str) -> list[dict]:
    """For each Phase block, return one entry per phase that:
       - has at least one `- [x]` item AND
       - has zero `- [ ]` items AND
       - does NOT yet have a "phase complete" sentinel paragraph.
    Caller can use this to surface "Phase N is now complete — add a
    completion paragraph" reminders. Pure detection; no mutation.
    """
    open_re = re.compile(r"^\s*-\s+\[\s\]")
    closed_re = re.compile(r"^\s*-\s+\[x\]")
    sentinel_re = re.compile(r"_phase\s+complete_|\*\*phase\s+complete\*\*", re.IGNORECASE)
    lines = spec_md.split("\n")
    out = []
    for start, end, header in _phase_blocks(spec_md):
        block = lines[start:end]
        opens = sum(1 for ln in block if open_re.match(ln))
        closes = sum(1 for ln in block if closed_re.match(ln))
        has_sentinel = any(sentinel_re.search(ln) for ln in block)
        if closes >= 1 and opens == 0 and not has_sentinel:
            out.append({
                "header": header.strip(),
                "start_line": start,
                "end_line": end,
                "closed_count": closes,
            })
    return out


def _close_with_spec_update(entry: dict) -> tuple[str, str]:
    """Atomic SPEC/TODO close: flip the BEST-MATCHING `- [ ] [tier] <text>`
    in doc/SPEC.md to `[x]`, append a Just-shipped entry to doc/TODO.md.

    Match strategy: pick the open SPEC item whose normalized text
    shares the longest common prefix with the i/todo entry's normalized
    text, requiring at least 30 chars of common prefix to fire (avoids
    false positives where two items share a generic preamble like
    "Add"). TODO.md Next-up entries are often shortened versions of
    the full SPEC.md item text, so strict equality / containment misses
    legitimately-paired items.

    After flip+append, trims TODO.md "Just shipped" to most recent N
    entries (skill-set's rolling-window pattern; older history lives in
    SPEC.md phase blocks + git log). Returns (flipped_spec_line,
    shipped_line); flipped is empty if no SPEC item matched."""
    text = entry.get("text", "").strip()
    # Strip the "(from spec — Reason)" provenance suffix if present.
    text_root = re.sub(r"\s+\(from spec.*?\)\s*$", "", text)
    text_norm = _normalize_for_match(text_root)
    flipped = ""
    flipped_idx = -1
    if os.path.exists(_SPEC_FILE) and text_norm:
        with open(_SPEC_FILE, encoding="utf-8") as f:
            spec_md = f.read()
        spec_lines = spec_md.splitlines()
        # Score every open SPEC item by common-prefix length.
        candidates = []
        for i, line in enumerate(spec_lines):
            m = _SPEC_OPEN_RE.match(line)
            if not m:
                continue
            spec_text = m.group(3).rstrip(".").strip()
            spec_norm = _normalize_for_match(spec_text)
            cp = _common_prefix_len(spec_norm, text_norm)
            # Require at least 30 chars of shared prefix OR full equality
            # OR one being a strict prefix of the other.
            if (
                cp >= 30
                or spec_norm == text_norm
                or spec_norm.startswith(text_norm)
                or text_norm.startswith(spec_norm)
            ):
                candidates.append((cp, i, m, spec_text))
        if candidates:
            candidates.sort(key=lambda c: -c[0])
            cp, i, m, spec_text = candidates[0]
            new_line = m.group(1) + "x" + m.group(2) + m.group(3)
            spec_lines[i] = new_line
            flipped = spec_text
            flipped_idx = i
            with open(_SPEC_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(spec_lines) + ("\n" if spec_md.endswith("\n") else ""))
    # Append to TODO.md Just shipped at the FIRST entry slot (newest-first).
    # Skip past HTML comment blocks (`<!-- ... -->`) so the insertion
    # lands in real content space, not inside the template stub.
    shipped = f"- {text_root} — by i/todo #{entry.get('id')} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"
    if os.path.exists(_TODOMD_FILE):
        with open(_TODOMD_FILE, encoding="utf-8") as f:
            md = f.read()
        marker = "## Just shipped (last cycle)"
        if marker in md:
            lines = md.split("\n")
            out = []
            in_section = False
            in_comment = False
            inserted = False
            for line in lines:
                if not inserted:
                    s = line.strip()
                    if s == marker:
                        out.append(line)
                        in_section = True
                        continue
                    if in_section:
                        if "<!--" in line and "-->" not in line:
                            in_comment = True
                            out.append(line)
                            continue
                        if in_comment:
                            out.append(line)
                            if "-->" in line:
                                in_comment = False
                            continue
                        # Real content line within Just shipped — insert
                        # `shipped` BEFORE it, then continue normally.
                        if s and not s.startswith("##"):
                            out.append(shipped)
                            out.append(line)
                            inserted = True
                            in_section = False
                            continue
                        # Hit next section header without finding entries.
                        if s.startswith("##"):
                            out.append(shipped)
                            out.append(line)
                            inserted = True
                            in_section = False
                            continue
                        # Blank line inside section — keep going.
                        out.append(line)
                        continue
                out.append(line)
            if not inserted:
                # Section was at file end with no entries; append at EOF.
                out.append(shipped)
            new_md = "\n".join(out)
            # Apply rolling-window trim AFTER the new entry lands so the
            # newest entry always survives. Trim count is the difference
            # between count-before and the configured limit.
            trimmed_md, _trim_n = _trim_just_shipped(new_md)
            with open(_TODOMD_FILE, "w", encoding="utf-8") as f:
                f.write(trimmed_md)
    return flipped, shipped


# MCP tool — agents call this for hierarchical features TodoWrite lacks


@ctx.mcp.tool(meta={"hidden": True})
@chained("hme_todo")
def hme_todo(action: str = "list", text: str = "", todo_id: int = 0,
             parent_id: int = 0, critical: bool = False, on_done: str = "",
             status: str = "pending", fmt: str = "text",
             tier: str = "medium") -> str:
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
            text_norm = text.strip()
            # Universal text-dedup for the hme_todo add path. If an OPEN
            # entry with identical text + parent_id already exists,
            # increment its recurrence_count instead of creating a
            # duplicate. Prevents the spam class the user reported
            # ("absolutely riddled with spam — fix it so it never
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
            # Auto-archive trigger: when doc/SPEC.md is fully complete
            # (all `[ ]` flipped to `[x]` AND every phase has its
            # `_Phase N complete_` sentinel), `clear` snapshots the
            # full SPEC + TODO state to a timestamped KB devlog file,
            # clears completed i/todo entries, and resets SPEC.md +
            # TODO.md to a fresh-slate template ready for the next set.
            #
            # Mid-set (any open `[ ]` items remaining): `clear` just
            # removes completed i/todo entries (the original behavior).
            # No archive happens because the set isn't done.
            #
            # The archive is "built into" clear — one action, one
            # mental model: "I'm done with this list, clean up."
            detection = _detect_complete_set()
            archive_msg = ""
            if detection["complete"]:
                # Set is fully done — perform the archive + reset.
                # Pass set_name from text= argument if provided, else
                # auto-derive from the first phase header in _archive_set.
                archive_result = _archive_set(set_name=text)
                if archive_result["ok"]:
                    archive_msg = (
                        f"\n\n📦 Set archived to KB devlog:\n  {archive_result['devlog_path']}\n"
                        f"doc/SPEC.md and doc/TODO.md reset to fresh slate."
                    )
                else:
                    # Detection said complete but archive refused —
                    # surface the reason instead of silently skipping.
                    archive_msg = f"\n\n⚠ Archive refused: {archive_result['message']}"
            elif detection["phases"]:
                # Mid-set: surface what's still pending so the user
                # knows why clear isn't archiving yet.
                missing_count = len(detection["missing"])
                if missing_count:
                    archive_msg = (
                        f"\n\n(Set not yet complete — {missing_count} blocker(s); "
                        f"archive will fire on next `clear` once SPEC.md is fully checked. "
                        f"First blocker: {detection['missing'][0]})"
                    )
            before = len(todos)
            todos = [t for t in todos if not _check_main_done(t)]
            removed = before - len(todos)
            _save_todos(meta, todos)
            return f"Cleared {removed} completed todos.{archive_msg}\n\n{_render(todos)}"

        if action == "ingest_from_spec":
            ingested = _ingest_from_spec(meta, todos)
            _save_todos(meta, todos)
            if not ingested:
                return "No new entries from doc/TODO.md Next up (all already in i/todo).\n"
            lines = [f"  + #{e['id']} [{e['tier']}] {e['text'][:80]}" for e in ingested]
            return f"Ingested {len(ingested)} entries from doc/TODO.md Next up:\n" + "\n".join(lines)

        if action == "promote_to_spec":
            if not todo_id:
                return "Error: todo_id= required for promote_to_spec."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target = sub or main
            line = _promote_to_spec(target)
            return f"Promoted #{todo_id} to doc/TODO.md Next up:\n  {line}"

        if action == "close_with_spec_update":
            if not todo_id:
                return "Error: todo_id= required for close_with_spec_update."
            main, sub = _find_any(todos, todo_id)
            if main is None:
                return f"Error: #{todo_id} not found."
            target = sub or main
            spec_flipped, shipped_line = _close_with_spec_update(target)
            # Mark done in i/todo
            _mark_status(target, "completed")
            if sub is not None and _check_main_done(main):
                _mark_status(main, "completed")
            _save_todos(meta, todos)
            note = ""
            if spec_flipped:
                note = f" (flipped doc/SPEC.md item: {spec_flipped[:80]})"
            # Phase-completion detection: if this flip closed the last
            # `[ ]` in any Phase block, surface that to the caller so a
            # buddy / human can append the completion-ritual paragraph
            # via `i/todo phase_complete phase=N summary=\"...\"`.
            phase_complete_msg = ""
            if spec_flipped and os.path.exists(_SPEC_FILE):
                with open(_SPEC_FILE, encoding="utf-8") as f:
                    spec_md = f.read()
                completed = _detect_phase_complete(spec_md)
                if completed:
                    headers = "\n  ".join(c["header"] for c in completed)
                    phase_complete_msg = (
                        f"\n\n🎉 Phase complete (no remaining `[ ]` items):\n  {headers}\n"
                        f"Run `i/todo phase_complete phase=<N> summary=\"...\"` to append "
                        f"the completion paragraph (1-paragraph result + bulleted file "
                        f"citations + test-count delta)."
                    )
            return f"Closed #{todo_id}{note}\nShipped: {shipped_line}{phase_complete_msg}\n"

        if action == "phase_complete":
            # Append the phase-completion sentinel paragraph to a
            # fully-checked Phase block in doc/SPEC.md. Caller passes
            # phase=N (via todo_id arg) and summary (via text arg —
            # the 1-paragraph result; bulleted file citations and
            # test-count delta should be embedded by the caller).
            #
            # When all phases in the SPEC have completion paragraphs
            # AND zero open `[ ]` items, the next `clear` action will
            # auto-archive the set to KB devlog and reset to fresh slate.
            phase_n = todo_id  # repurpose todo_id arg as phase number
            if not phase_n:
                return "Error: phase=N required for phase_complete (pass via todo_id=)."
            if not text:
                return "Error: text= required (the completion paragraph)."
            if not os.path.exists(_SPEC_FILE):
                return f"Error: {_SPEC_FILE} missing."
            with open(_SPEC_FILE, encoding="utf-8") as f:
                spec_md = f.read()
            blocks = _phase_blocks(spec_md)
            target_block = None
            for start, end, header in blocks:
                m = re.match(r"^###\s+Phase\s+(\d+):", header)
                if m and int(m.group(1)) == phase_n:
                    target_block = (start, end, header)
                    break
            if target_block is None:
                return f"Error: Phase {phase_n} not found in {_SPEC_FILE}."
            start, end, header = target_block
            # Verify the phase is actually complete (no remaining `[ ]`)
            lines = spec_md.split("\n")
            block_lines = lines[start:end]
            opens = sum(1 for ln in block_lines if re.match(r"^\s*-\s+\[\s\]", ln))
            if opens > 0:
                return (f"Error: Phase {phase_n} still has {opens} open `[ ]` items. "
                        f"Close them via close_with_spec_update before appending the "
                        f"completion paragraph.")
            # Append the completion block before the next phase / section.
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            completion_block = [
                "",
                f"_Phase {phase_n} complete_ ({ts}):",
                "",
                text.strip(),
                "",
            ]
            new_lines = lines[:end] + completion_block + lines[end:]
            with open(_SPEC_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(new_lines))
            # Surface whether the set is now fully complete (next clear
            # will auto-archive).
            redetect = _detect_complete_set()
            tail = ""
            if redetect["complete"]:
                tail = (
                    f"\n\n📦 All phases now complete — next `i/todo clear` will archive "
                    f"the set to KB devlog and reset SPEC/TODO to fresh slate."
                )
            return f"Phase {phase_n} marked complete in {_SPEC_FILE}.{tail}\n"

        return ("Unknown action. Use: list, add, done, undo, remove, clear, critical, "
                "ingest_from_spec, promote_to_spec, close_with_spec_update, phase_complete.")



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
