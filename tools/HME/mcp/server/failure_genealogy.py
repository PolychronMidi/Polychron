"""HME failure genealogy — Layer 4 of the self-coherence stack.

Every failure gets a unique failure_id (8-char UUID fragment). Downstream failures
caused by an upstream failure carry a caused_by reference, forming a causal tree.

The LIFESAVER drain groups failures by causal chain — showing:
  [CRITICAL] worker: OOM during index_directory (#7a3b)
    → [CRITICAL] rag.project: ConnectionRefusedError (#8c4d)
    → [WARNING]  supervisor: worker unhealthy (#9e5f)

Instead of three orphaned error entries (audit finding 8.7 deduplication gap).

Deduplication: same source+error within _DEDUP_WINDOW seconds = one record
with an incrementing count, preventing LIFESAVER spam on repeated failures.
"""
import threading
import time
import uuid
import logging

logger = logging.getLogger("HME")

_failures: dict[str, dict] = {}  # failure_id → failure record
_failures_lock = threading.Lock()
_DEDUP_WINDOW = 30.0   # seconds; same source+error within this window = duplicate
_MAX_FAILURES = 500    # prune oldest beyond this


def record_failure(
    source: str,
    error: str,
    severity: str = "CRITICAL",
    caused_by: str | None = None,
) -> tuple[str, bool]:
    """Record a failure. Returns (failure_id, is_new).

    is_new=False means the caller hit an existing dedup entry — the count was
    incremented but no new record was created. Callers can use this to
    suppress duplicate log lines so the same alert doesn't spam hme.log on
    every monitor tick.
    """
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("lifesaver-registry", __file__)
    except ImportError:
        pass
    with _failures_lock:
        now = time.time()
        # Deduplication: same source + error text within window → increment count only
        for fid, f in _failures.items():
            if (
                f["source"] == source
                and f["error"] == error
                and not f.get("resolved")
                and now - f["ts"] < _DEDUP_WINDOW
            ):
                f["count"] = f.get("count", 1) + 1
                return fid, False

        fid = str(uuid.uuid4())[:8]
        _failures[fid] = {
            "id": fid,
            "source": source,
            "error": error,
            "severity": severity,
            "caused_by": caused_by,
            "ts": now,
            "count": 1,
            "resolved": False,
        }
        # Prune oldest if over limit
        if len(_failures) > _MAX_FAILURES:
            oldest = sorted(_failures, key=lambda k: _failures[k]["ts"])
            for old_id in oldest[:50]:
                del _failures[old_id]
        return fid, True


def resolve_failure(failure_id: str) -> None:
    """Mark a failure as resolved (e.g., shim revived, recovery succeeded)."""
    with _failures_lock:
        if failure_id in _failures:
            _failures[failure_id]["resolved"] = True
            _failures[failure_id]["resolved_ts"] = time.time()


def get_active_failures() -> list[dict]:
    """Return all unresolved failures, sorted by timestamp."""
    with _failures_lock:
        active = [f for f in _failures.values() if not f.get("resolved")]
        return sorted(active, key=lambda f: f["ts"])


def drain_as_causal_trees() -> list[list[dict]]:
    """Drain all unresolved failures into causal trees; marks all drained as resolved.

    Returns list of trees, each tree being a list of related failures ordered
    root-first. Orphaned failures (no parent) form single-node trees.
    """
    with _failures_lock:
        active = {fid: f for fid, f in _failures.items() if not f.get("resolved")}
        if not active:
            return []

        # Find roots: failures whose caused_by is not in the active set
        active_ids = set(active.keys())
        roots = [f for f in active.values() if f.get("caused_by") not in active_ids]

        trees = []
        seen: set[str] = set()
        for root in roots:
            tree = _collect_tree(root["id"], active, seen)
            if tree:
                trees.append(tree)

        # Mark all drained as resolved
        now = time.time()
        for fid in active:
            _failures[fid]["resolved"] = True
            _failures[fid]["resolved_ts"] = now

        return trees


def _collect_tree(root_id: str, active: dict, seen: set) -> list[dict]:
    """Collect a failure tree recursively, root first."""
    if root_id in seen or root_id not in active:
        return []
    seen.add(root_id)
    result = [dict(active[root_id])]
    for f in active.values():
        if f.get("caused_by") == root_id:
            result.extend(_collect_tree(f["id"], active, seen))
    return result


def format_tree_as_banner(trees: list[list[dict]]) -> str:
    """Format causal trees as a LIFESAVER-style banner.

    Root failures are shown first; child failures (caused_by) are indented.
    """
    if not trees:
        return ""
    lines = [
        "  LIFESAVER: CRITICAL FAILURES DETECTED — ADDRESS NOW",
    ]
    for tree in trees:
        if not tree:
            continue
        root = tree[0]
        count_str = f" ×{root.get('count', 1)}" if root.get("count", 1) > 1 else ""
        lines.append(f"  [{root['severity']}] {root['source']}: {root['error']}{count_str} (#{root['id']})")
        for child in tree[1:]:
            count_str = f" ×{child.get('count', 1)}" if child.get("count", 1) > 1 else ""
            lines.append(f"    → [{child['severity']}] {child['source']}: {child['error']}{count_str}")
    lines += [
        "  These failures occurred in background threads and were queued",
        "  for your attention. Diagnose and fix before proceeding.",
    ]
    return "\n".join(lines)
