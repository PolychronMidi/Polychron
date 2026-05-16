"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _resolve, _excluded, _is_regex, _load_invariants
import time
import datetime



def _check_activity_events_balanced(inv: dict) -> tuple[bool, str]:
    """Verify paired activity events fire with matching counts over recent
    rounds. Catches observability regressions where a refactor drops a
    pipeline emission silently.

    Config:
      path           -- activity jsonl file (default metrics/hme-activity.jsonl)
      start_event    -- name of the "begin" event (e.g. pipeline_start)
      end_event      -- name of the "end" event (e.g. pipeline_run)
      require_field  -- optional: events must have this field present to count
                        (useful for round_complete which was pre-rename emitted
                        without verdict field from pre-pipeline-era Stop hooks)
      window_events  -- consider only the last N events (default 2000)
      min_occurrences -- only evaluate when >= this many start_events observed
                        (default 2 -- cold-start tolerance)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv.get("path", os.path.join(METRICS_DIR, "hme-activity.jsonl")))
    start_event = inv["start_event"]
    end_event = inv["end_event"]
    require_field = inv.get("require_field", "")
    window = int(inv.get("window_events", 2000))
    min_occ = int(inv.get("min_occurrences", 2))

    if not os.path.isfile(path):
        return True, f"activity log {inv.get('path',os.path.join(METRICS_DIR, 'hme-activity.jsonl'))} missing -- can't check"
    tail: list = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    tail.append(_json.loads(s))
                except ValueError:
                    continue
    except OSError as e:
        return False, f"cannot read {path}: {e}"
    tail = tail[-window:]
    def _matches(e: dict, event_name: str) -> bool:
        if e.get("event") != event_name:
            return False
        if require_field and not e.get(require_field):
            return False
        return True
    starts = sum(1 for e in tail if _matches(e, start_event))
    ends = sum(1 for e in tail if _matches(e, end_event))
    if starts < min_occ:
        return True, f"only {starts} {start_event!r} in last {window} events, need >={min_occ}"
    if starts != ends:
        return False, (
            f"{start_event!r}={starts}  {end_event!r}={ends}  delta={abs(starts-ends)}. "
            f"Pipeline observability is missing {abs(starts-ends)} paired emission(s). "
            f"Either a pipeline run crashed mid-flight without emitting {end_event} "
            f"or a refactor dropped one of the emissions."
        )
    return True, f"{start_event}={starts}  {end_event}={ends}  (balanced)"


def _check_invariant_chronically_failing(inv: dict) -> tuple[bool, str]:
    """Escalation check: warn when ANOTHER invariant has been failing for
    N consecutive invariant runs. Catches the meta-pattern where a FAIL
    becomes background noise. Requires metrics/hme-invariant-history.json
    (maintained by the invariants runner itself -- not wired here yet).

    Config:
      path         -- history file (default metrics/hme-invariant-history.json)
      min_streak   -- minimum consecutive-FAIL runs to trigger (default 10)
      min_severity -- only count invariants at/above this severity (default error)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT,
                        inv.get("path", os.path.join(METRICS_DIR, "hme-invariant-history.json")))
    min_streak = int(inv.get("min_streak", 10))
    if not os.path.isfile(path):
        return True, "no invariant history yet -- chronic-failure check inert"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {path}: {e}"
    rank = {"info": 0, "warning": 1, "error": 2}
    min_rank = rank.get(str(inv.get("min_severity", "error")).lower(), 2)
    ignore_ids = set(inv.get("ignore_ids") or []) | {inv.get("id")}
    severity_by_id = {
        item.get("id"): str(item.get("severity", "error")).lower()
        for item in _load_invariants()
        if item.get("id")
    }
    chronic = []
    ignored = 0
    for inv_id, streaks in (data.get("fail_streaks") or {}).items():
        if not isinstance(streaks, int) or streaks < min_streak:
            continue
        severity = severity_by_id.get(inv_id, "error")
        if inv_id in ignore_ids or rank.get(severity, 2) < min_rank:
            ignored += 1
            continue
        chronic.append(f"{inv_id} ({streaks} runs)")
    if chronic:
        return False, (
            f"{len(chronic)} invariant(s) chronically failing: {', '.join(chronic[:5])}"
            + (f" +{len(chronic)-5} more" if len(chronic) > 5 else "")
        )
    detail = "no chronic error failures"
    if ignored:
        detail += f" ({ignored} warning/info/self streaks ignored)"
    return True, detail


def _check_same_commit_determinism(inv: dict) -> tuple[bool, str]:
    """Verify that consecutive pipeline rounds with the SAME commit produce
    identical metric values. Non-determinism in hme_coherence / HCI across
    same-commit runs means either the metric has random inputs (e.g. a
    clock-dependent verifier) or cached state leaks between runs.

    Config:
      activity_path       -- activity jsonl (default metrics/hme-activity.jsonl)
      correlation_path    -- musical-correlation.json (default)
      field               -- field to check (default 'hme_coherence')
      tolerance           -- absolute difference tolerance (default 0.01)
      window_events       -- tail to scan (default 2000)
    """
    import json as _json
    activity_path = os.path.join(
        ctx.PROJECT_ROOT,
        inv.get("activity_path", os.path.join(METRICS_DIR, "hme-activity.jsonl")),
    )
    corr_path = os.path.join(
        ctx.PROJECT_ROOT,
        inv.get("correlation_path", os.path.join(METRICS_DIR, "hme-musical-correlation.json")),
    )
    field = inv.get("field", "hme_coherence")
    tolerance = float(inv.get("tolerance", 0.01))

    if not (os.path.isfile(activity_path) and os.path.isfile(corr_path)):
        return True, "activity log or correlation file missing -- can't check"
    # Find consecutive pipeline_baseline_delta events with same_commit=1
    baselines: list[dict] = []
    try:
        with open(activity_path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    e = _json.loads(s)
                except ValueError:
                    continue
                if e.get("event") == "pipeline_baseline_delta":
                    baselines.append(e)
    except OSError as e:
        return False, f"cannot read activity: {e}"
    # Load correlation history keyed by round sha
    try:
        with open(corr_path, encoding="utf-8") as f:
            corr = _json.load(f)
    except (OSError, _json.JSONDecodeError):
        return True, "correlation file unparseable -- can't check"
    hist = corr.get("history") or []

    # Build {tree_hash_or_sha: [values]}
    by_sha: dict = {}
    for h in hist:
        tree = h.get("tree_hash")
        if tree and isinstance(tree, str) and len(tree) >= 8:
            key = f"tree_{tree}"
        else:
            rid = h.get("round_id", "")
            if not isinstance(rid, str) or not rid.startswith("r_"):
                continue
            parts = rid.split("_")
            if len(parts) < 3:
                continue
            key = f"sha_{parts[1]}"
        val = h.get(field)
        if val is None:
            continue
        by_sha.setdefault(key, []).append(val)

    # Check any sha with >= 2 values
    violations: list = []
    for sha, vals in by_sha.items():
        if len(vals) < 2:
            continue
        spread = max(vals) - min(vals)
        if spread > tolerance:
            violations.append(f"sha={sha} {field} spread={spread:.4f} across {len(vals)} rounds")
    if violations:
        return False, (
            f"{len(violations)} same-commit spread violation(s) above tol={tolerance}: "
            + "; ".join(violations[:3])
        )
    # Count how many shas had >=2 rounds (any at all) as evidence the check ran
    with_enough = sum(1 for vals in by_sha.values() if len(vals) >= 2)
    if with_enough == 0:
        return True, f"no commit has >=2 rounds yet -- check inert"
    return True, f"{with_enough} commit(s) evaluated, all within tol={tolerance}"


def _check_activity_field_sanity(inv: dict) -> tuple[bool, str]:
    """Validate that a named field on recent activity events matches an
    expected pattern. Catches garbage-module bugs (file_written emitting
    module='18446744073709550176' from LanceDB internal files, for example).

    Config:
      path            -- activity jsonl (default metrics/hme-activity.jsonl)
      event           -- event type to check (e.g. 'file_written')
      field           -- field name to validate (e.g. 'module')
      pattern         -- regex that the field value must match
      window_events   -- consider only the last N events (default 2000)
      max_violations  -- fail threshold (default 10 -- tolerate legacy noise)
      exclude_values  -- field values to skip (e.g. empty strings)
      require_fields  -- event must have ALL these fields (non-empty) to count;
                        skips legacy events that predate a schema extension
                        (e.g. 'source' was added post-R09 -- pre-R09 events
                        without it are legacy noise, not current violations)
    """
    import json as _json
    import re as _re
    path = os.path.join(ctx.PROJECT_ROOT,
                        inv.get("path", os.path.join(METRICS_DIR, "hme-activity.jsonl")))
    event_name = inv["event"]
    field = inv["field"]
    pattern = _re.compile(inv["pattern"])
    window = int(inv.get("window_events", 2000))
    max_violations = int(inv.get("max_violations", 10))
    exclude = set(inv.get("exclude_values", ["", None]))
    require_fields = inv.get("require_fields", [])

    if not os.path.isfile(path):
        return True, f"activity log missing -- can't check"
    tail: list = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    tail.append(_json.loads(s))
                except ValueError:
                    continue
    except OSError as e:
        return False, f"cannot read {path}: {e}"
    tail = tail[-window:]
    violations: list = []
    for e in tail:
        if e.get("event") != event_name:
            continue
        # Skip legacy events missing schema-extension fields (e.g. pre-R09
        if require_fields and any(not e.get(rf) for rf in require_fields):
            continue
        val = e.get(field)
        if val in exclude:
            continue
        if not pattern.match(str(val)):
            violations.append(str(val))
    if len(violations) > max_violations:
        sample = ", ".join(violations[:5])
        return False, (
            f"{len(violations)} {event_name!r} events have invalid {field!r} "
            f"values (max {max_violations}). Samples: {sample}. "
            f"Pattern: {inv['pattern']}"
        )
    return True, f"{len(violations)} invalid (<={max_violations} tolerance)"


