"""Lifesaver-todo bridge -- registration, dedup, caps, and pruning.

Extracted from todo.py (was lines 285-715). External API: register_todo_from_lifesaver,
resolve_lifesaver_todos, list_critical, list_carried_over.
"""
import os
import re
import sys
import time
import logging

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)

logger = logging.getLogger("HME")

# Pull persistence + entry primitives from the parent module. todo.py loads
from server.tools_analysis.todo import (
    _load_todos, _save_todos, _write_todo_entry, _check_main_done, _todo_lock,
)




# Lifesaver-todo store-protection knobs. Override via env if the defaults
_LIFESAVER_MAX_OPEN = int(os.environ.get("HME_LIFESAVER_TODO_MAX_OPEN", "20"))
_LIFESAVER_TTL_SECONDS = int(os.environ.get("HME_LIFESAVER_TODO_TTL_SEC", str(24 * 3600)))
# Prune-after: how long a DONE lifesaver entry stays in the store before
_LIFESAVER_PRUNE_AFTER_SECONDS = int(os.environ.get("HME_LIFESAVER_TODO_PRUNE_SEC", str(3 * 24 * 3600)))
# Prune-after for non-lifesaver done todos (native, hme_todo, todo_md).
_DONE_TODO_PRUNE_AFTER_SECONDS = int(os.environ.get("HME_DONE_TODO_PRUNE_SEC", str(7 * 24 * 3600)))


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
    # Plain large numbers (>= 4 digits) -- covers retry counts, line numbers,
    s = re.sub(r"\b\d{4,}\b", "<NUM>", s)
    # Hex pointers / addresses
    s = re.sub(r"\b0x[0-9a-fA-F]+\b", "<HEX>", s)
    # Absolute paths down to filename -- keep filename as it's often the
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
       chronic real failures don't get silently swept under the rug --
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
    # MAX_OPEN pass -- recompute open set after TTL sweep
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


def _prune_done_todos_universal(meta: dict, todos: list) -> int:
    """Prune done todos of ALL sources past their respective prune
    horizons. Was previously lifesaver-only, leaving native/hme_todo/todo_md
    done entries to accumulate forever.

    Per-source horizons:
      - lifesaver:  3 days  (HME_LIFESAVER_TODO_PRUNE_SEC)
      - everything else: 7 days (HME_DONE_TODO_PRUNE_SEC)
        -- set 0 to disable.

    Reference timestamp: min(ts, resolved_ts) -- same as lifesaver path,
    so retroactive cleanup of old failures resolves immediately rather
    than waiting another N days from the resolve-now timestamp.

    Mutates `todos` in place; returns count pruned. Safe to call on
    every internal todo invocation: cheap (single pass over todos list) and
    idempotent (no items to prune -> no-op)."""
    now = time.time()
    keep = []
    pruned = 0
    for t in todos:
        if not _check_main_done(t):
            keep.append(t)
            continue
        source = t.get("source", "")
        if source == "lifesaver":
            horizon = _LIFESAVER_PRUNE_AFTER_SECONDS
        else:
            horizon = _DONE_TODO_PRUNE_AFTER_SECONDS
        if horizon == 0:
            keep.append(t)
            continue
        ts_orig = float(t.get("ts") or now)
        ts_resolved = float(t.get("resolved_ts") or now)
        ref_ts = min(ts_orig, ts_resolved)
        if (now - ref_ts) > horizon:
            pruned += 1
            continue
        keep.append(t)
    if pruned:
        todos[:] = keep
        meta["updated_ts"] = now
    return pruned


def _prune_done_lifesavers(meta: dict, todos: list) -> int:
    """Delete done lifesaver entries whose resolved_ts (or ts as fallback
    for legacy entries) is older than HME_LIFESAVER_TODO_PRUNE_SEC.

    Once a lifesaver alert is resolved, it carries no operational value
    -- historical lessons live in commits / KB / docs. Keeping resolved
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
    """LIFESAVER entry point -- dedup-aware with store-protection caps.

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
    # Normalized dedup key -- strips variable tokens before computing the
    # 80-char prefix so memory-variant errors collapse into ONE entry.
    normalized_err = _normalize_error_for_dedup(error or "")
    dedup_key = f"{severity}|{source}|{normalized_err[:80]}"
    with _todo_lock:
        meta, todos = _load_todos()
        # Sweep TTL + max-open caps BEFORE checking dedup so capped/stale
        # entries can't block a legitimate fresh-recurrence registration.
        cap_resolved = _enforce_lifesaver_caps(meta, todos)
        if cap_resolved:
            logger.info(f"LIFESAVER->TODO store-protection auto-resolved {cap_resolved} entries (ttl/cap)")
        # Prune done-lifesaver residue after the TTL pass so newly-aged-out
        # entries get a chance to be observed once before deletion-on-next-call.
        pruned = _prune_done_lifesavers(meta, todos)
        if pruned:
            logger.info(f"LIFESAVER->TODO pruned {pruned} done entries past prune horizon")
        for existing in todos:
            if (
                existing.get("source") == "lifesaver"
                and not _check_main_done(existing)
            ):
                # Prefer dedup_key match (set on entries written under this
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
                    # Match -- increment recurrence and refresh ts. The TTL
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
    logger.info(f"LIFESAVER->TODO #{entry['id']}: {text[:120]}")


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
        logger.info(f"LIFESAVER->TODO auto-resolved {resolved} entries matching '{source_substring}'")
    return resolved


def list_critical() -> list:
    """Return the list of open critical entries -- used by userpromptsubmit to
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
    """Return all open (non-completed) items from the store -- used by sessionstart
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


# Lifesaver-critical items that haven't been touched in this many seconds
_LIFESAVER_STALE_SECONDS = 6 * 3600

# Hard cap on how many critical items render in the merged output. Anything
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
            t["done"] = True
            t["resolved_ts"] = time.time()
            t["resolved_reason"] = "stale"
            expired += 1
    return expired
