"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _resolve, _excluded, _is_regex
import time
import datetime



def _check_correlation_direction(inv: dict) -> tuple[bool, str]:
    """Verify a named correlation's sign + magnitude matches expectation.
    This is the ultimate anti-drift check: it fires when HME's self-metric
    is actively ANTI-correlated with musical outcome (HME thinks it's
    improving while the music gets worse).

    Config:
      path              -- JSON file containing the correlations dict
      correlations_key  -- top-level key holding the correlations object
                          (default: 'correlations')
      name              -- correlation name (e.g. 'hme_coherence__verdict_numeric')
      direction         -- 'positive' (r > threshold) or 'negative' (r < -threshold)
                          (default: 'positive')
      threshold         -- minimum |r| required (default: 0.0 -- any matching sign)
      min_n             -- minimum sample size required to enforce (default: 10)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv["path"])
    name = inv["name"]
    corrs_key = inv.get("correlations_key", "correlations")
    direction = inv.get("direction", "positive")
    threshold = float(inv.get("threshold", 0.0))
    min_n = int(inv.get("min_n", 10))

    if not os.path.isfile(path):
        return True, f"{inv['path']} missing -- can't check correlation"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {inv['path']}: {e}"
    corrs = data.get(corrs_key, {}) or {}
    entry = corrs.get(name, {}) or {}
    r = entry.get("r")
    n = entry.get("n", 0)
    if r is None or entry.get("degenerate"):
        # Degenerate is a separate invariant's concern (metric_has_variance).
        return True, f"{name!r} degenerate or missing -- covered by variance check"
    if n < min_n:
        return True, f"{name!r} has n={n} < min_n={min_n}, too early to judge"
    if direction == "positive":
        if r < threshold:
            return False, (
                f"{name!r} r={r:+.3f} (want >={threshold:+.3f}, n={n}). "
                f"HME's self-metric is NOT tracking the expected outcome. "
                f"If this is the musical anchor and r is near 0 or negative, "
                f"HME's discipline is not producing better music -- the whole "
                f"optimization direction is wrong."
            )
        return True, f"{name!r} r={r:+.3f}  n={n}  (positive, as expected)"
    if direction == "negative":
        if r > -threshold:
            return False, (
                f"{name!r} r={r:+.3f} (want <={-threshold:+.3f}, n={n})"
            )
        return True, f"{name!r} r={r:+.3f}  n={n}  (negative, as expected)"
    return False, f"unknown direction {direction!r} -- use 'positive' or 'negative'"


def _check_metric_threshold(inv: dict) -> tuple[bool, str]:
    """Verify a named metric field stays above min_value (or below max_value)
    across recent rounds. Used for enforcing prediction-accuracy/recall floors
    once enough data has accumulated.

    Config:
      path                     -- metric JSON file path
      history_key              -- top-level array key (default: 'rounds')
      field                    -- field inside each snapshot to check
      min_value                -- required minimum (exclusive: value > min)
      max_value                -- required maximum (exclusive: value < max)
      min_rounds               -- only evaluate when >= this many data points
                                 (default: 3)
      require_positive_shifts  -- only count rounds where 'shifted_modules'
                                 has >= 1 entry (for reconcile metrics that
                                 are null/0 on idle rounds)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv["path"])
    field = inv["field"]
    history_key = inv.get("history_key", "rounds")
    min_val = inv.get("min_value")
    max_val = inv.get("max_value")
    min_rounds = int(inv.get("min_rounds", 3))
    require_positive_shifts = bool(inv.get("require_positive_shifts", False))

    if not os.path.isfile(path):
        return True, f"metric file {inv['path']} missing -- can't check"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {inv['path']}: {e}"
    history = data.get(history_key, [])
    if not isinstance(history, list):
        return True, f"{inv['path']}.{history_key} is not a list -- skip"
    qualifying = []
    for entry in history:
        if not isinstance(entry, dict):
            continue
        if require_positive_shifts:
            sm = entry.get("shifted_modules")
            if not isinstance(sm, list) or len(sm) == 0:
                continue
        v = entry.get(field)
        if v is None:
            continue
        qualifying.append(v)
    if len(qualifying) < min_rounds:
        return True, f"only {len(qualifying)} qualifying rounds, need >={min_rounds}"
    latest = qualifying[-1]
    if min_val is not None and latest < min_val:
        return False, f"{field}={latest} below min_value={min_val} (over {len(qualifying)} rounds)"
    if max_val is not None and latest > max_val:
        return False, f"{field}={latest} above max_value={max_val} (over {len(qualifying)} rounds)"
    return True, f"{field}={latest} within threshold ({len(qualifying)} rounds)"


def _check_metric_has_variance(inv: dict) -> tuple[bool, str]:
    """Verify a pipeline-metric JSON file has non-degenerate variance in the
    named field across its recent history. Catches the class of bug where a
    metric computation silently produces the same value every round (usually
    because upstream inputs are zero/missing), which makes downstream
    correlations degenerate.

    Config keys:
      path              -- JSON file path (relative to PROJECT_ROOT)
      history_key       -- top-level array field holding round snapshots
                          (default: 'history')
      field             -- the field inside each snapshot to check
      min_distinct      -- minimum distinct values required (default: 2)
      min_rounds        -- only evaluate when history has >= this many entries
                          (default: 5 -- don't fail cold-start pipelines)
      allow_null        -- if True, null entries don't count against variance
                          (default: True -- nulls are "no data", not "stuck")
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv["path"])
    field = inv["field"]
    history_key = inv.get("history_key", "history")
    min_distinct = int(inv.get("min_distinct", 2))
    min_rounds = int(inv.get("min_rounds", 5))
    allow_null = bool(inv.get("allow_null", True))

    if not os.path.isfile(path):
        return True, f"metric file {inv['path']} missing -- can't check variance"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {inv['path']}: {e}"
    history = data.get(history_key, [])
    if not isinstance(history, list):
        return False, f"{inv['path']}.{history_key} is not a list"
    if len(history) < min_rounds:
        return True, f"only {len(history)} rounds, need >={min_rounds} for variance check"
    values = []
    for entry in history:
        if not isinstance(entry, dict):
            continue
        v = entry.get(field)
        if v is None and allow_null:
            continue
        values.append(v)
    if not values:
        return True, f"no non-null {field!r} values in {len(history)} rounds"
    distinct = set(values)
    if len(distinct) < min_distinct:
        sample = sorted(distinct)[:5]
        return False, (
            f"{field!r} stuck at {sample} across {len(values)} rounds "
            f"(need >={min_distinct} distinct values). Upstream input is "
            f"likely producing a constant -- trace the metric's computation."
        )
    return True, f"{field!r} has {len(distinct)} distinct values over {len(values)} rounds"

