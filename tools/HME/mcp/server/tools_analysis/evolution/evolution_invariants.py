"""Declarative invariant battery — loads checks from config/invariants.json.

No LLM, pure programmatic. Add new invariants by editing the JSON file.
"""
import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

_CONFIG_REL = os.path.join("tools", "HME", "config", "invariants.json")


def _load_invariants() -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, _CONFIG_REL)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("invariants", [])


def _resolve(rel_path: str) -> str:
    if rel_path.startswith("~/"):
        return os.path.expanduser(rel_path)
    return os.path.join(ctx.PROJECT_ROOT, rel_path)


def _excluded(basename: str, exclude: list[str]) -> bool:
    return any(fnmatch.fnmatch(basename, pat) for pat in exclude)


# Check type implementations

def _check_files_executable(inv: dict) -> tuple[bool, str]:
    pattern = os.path.join(ctx.PROJECT_ROOT, inv["glob"])
    exclude = inv.get("exclude", [])
    files = globmod.glob(pattern, recursive=True)
    checked = [(f, os.path.basename(f)) for f in files
               if not _excluded(os.path.basename(f), exclude)]
    failures = [name for path, name in checked if not os.access(path, os.X_OK)]
    if failures:
        return False, f"{len(failures)} not executable: {', '.join(sorted(failures))}"
    return True, f"all {len(checked)} executable"


def _check_files_referenced(inv: dict) -> tuple[bool, str]:
    pattern = os.path.join(ctx.PROJECT_ROOT, inv["glob"])
    exclude = inv.get("exclude", [])
    ref_path = _resolve(inv["reference_file"])
    with open(ref_path, encoding="utf-8") as f:
        ref_content = f.read()
    files = globmod.glob(pattern, recursive=True)
    checked = [os.path.basename(f) for f in files
               if not _excluded(os.path.basename(f), exclude)]
    match_mode = inv.get("match_mode", "basename")
    missing = []
    for name in checked:
        needle = os.path.splitext(name)[0] if match_mode == "stem" else name
        if needle not in ref_content:
            missing.append(name)
    if missing:
        return False, f"{len(missing)} not referenced: {', '.join(sorted(missing))}"
    return True, f"all {len(checked)} referenced"


def _check_file_exists(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    if os.path.exists(path):
        return True, "exists"
    return False, f"missing: {inv['path']}"


def _check_symlink_valid(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    if not os.path.islink(path):
        if os.path.exists(path):
            return True, "exists (not a symlink)"
        return False, f"not found: {inv['path']}"
    target = os.path.realpath(path)
    if os.path.exists(target):
        return True, f"→ {os.path.basename(target)}"
    return False, f"broken symlink → {os.readlink(path)}"


def _check_json_valid(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    with open(path, encoding="utf-8") as f:
        json.load(f)
    return True, "valid JSON"


def _check_glob_count_gte(inv: dict) -> tuple[bool, str]:
    pattern = os.path.join(ctx.PROJECT_ROOT, inv["glob"])
    exclude = inv.get("exclude", [])
    files = globmod.glob(pattern, recursive=True)
    counted = [f for f in files if not _excluded(os.path.basename(f), exclude)]
    min_count = inv["min_count"]
    if len(counted) >= min_count:
        return True, f"{len(counted)} (>= {min_count})"
    return False, f"only {len(counted)} (need >= {min_count})"


def _check_pattern_in_file(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    with open(path, encoding="utf-8") as f:
        content = f.read()
    if re.search(inv["pattern"], content):
        return True, "pattern found"
    return False, f"pattern not found: {inv['pattern']}"


def _check_patterns_all_in_file(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    with open(path, encoding="utf-8") as f:
        content = f.read()
    patterns = inv["patterns"]
    missing = [p for p in patterns if not re.search(re.escape(p) if not _is_regex(p) else p, content)]
    if missing:
        return False, f"{len(missing)} missing: {', '.join(missing)}"
    return True, f"all {len(patterns)} patterns present"


def _check_pattern_count_gte(inv: dict) -> tuple[bool, str]:
    path = _resolve(inv["path"])
    with open(path, encoding="utf-8") as f:
        content = f.read()
    matches = re.findall(inv["pattern"], content)
    min_count = inv["min_count"]
    if len(matches) >= min_count:
        return True, f"{len(matches)} matches (>= {min_count})"
    return False, f"only {len(matches)} matches (need >= {min_count})"


def _check_symbols_used(inv: dict) -> tuple[bool, str]:
    def_path = os.path.join(ctx.PROJECT_ROOT, inv["definition_file"])
    with open(def_path, encoding="utf-8") as f:
        def_content = f.read()
    symbols = re.findall(inv["definition_pattern"], def_content)
    if not symbols:
        return False, "no symbols found in definition file"

    usage_tmpl = inv.get("usage_pattern", "{symbol}")
    usage_glob = os.path.join(ctx.PROJECT_ROOT, inv["usage_glob"])
    min_usages = inv.get("min_usages", 1)

    usage_files = globmod.glob(usage_glob, recursive=True)
    file_contents: dict[str, str] = {}
    for uf in usage_files:
        if uf == def_path:
            continue
        try:
            with open(uf, encoding="utf-8") as f:
                file_contents[uf] = f.read()
        except Exception as _err:
            logger.debug(f"unnamed-except evolution_invariants.py:155: {type(_err).__name__}: {_err}")
            continue

    unused = []
    for sym in symbols:
        pat = usage_tmpl.replace("{symbol}", re.escape(sym))
        count = sum(1 for c in file_contents.values() if re.search(pat, c))
        if count < min_usages:
            unused.append(sym)

    if unused:
        preview = unused[:10]
        suffix = f" (+{len(unused) - 10} more)" if len(unused) > 10 else ""
        return False, f"{len(unused)}/{len(symbols)} unused: {', '.join(preview)}{suffix}"
    return True, f"all {len(symbols)} symbols used"


def _check_files_mtime_window(inv: dict) -> tuple[bool, str]:
    """Two files must have mtimes within max_delta_seconds of each other."""
    path_a = _resolve(inv["path_a"])
    path_b_glob = inv.get("path_b_glob", "")
    max_delta = inv.get("max_delta_seconds", 300)
    if not os.path.exists(path_a):
        return False, f"file_a missing: {inv['path_a']}"
    mtime_a = os.path.getmtime(path_a)
    if path_b_glob:
        import glob as _gm
        candidates = sorted(_gm.glob(os.path.join(ctx.PROJECT_ROOT, path_b_glob)))
        if not candidates:
            return False, f"no files match path_b_glob: {path_b_glob}"
        path_b = candidates[-1]  # most recent
    else:
        path_b = _resolve(inv["path_b"])
        if not os.path.exists(path_b):
            return False, f"file_b missing: {inv.get('path_b', '')}"
    mtime_b = os.path.getmtime(path_b)
    delta = abs(mtime_a - mtime_b)
    if delta <= max_delta:
        return True, f"in sync (delta={delta:.0f}s)"
    from datetime import datetime
    ta = datetime.fromtimestamp(mtime_a).strftime("%H:%M")
    tb = datetime.fromtimestamp(mtime_b).strftime("%H:%M")
    return False, f"out of sync: {os.path.basename(path_a)}={ta} vs {os.path.basename(path_b)}={tb} (delta={delta/60:.0f}m)"


def _check_symbols_have_kb(inv: dict) -> tuple[bool, str]:
    """Top-N highest-caller IIFE globals must each have at least one KB entry."""
    if ctx.project_engine is None:
        return True, "engine not available — skipped (pipeline context)"
    from tools_analysis.health_analysis import _compute_iife_caller_counts
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    _, caller_counts, _ = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)
    if not caller_counts:
        return False, "no IIFE globals found"
    top_n = inv.get("top_n", 10)
    min_callers = inv.get("min_callers", 5)
    ranked = sorted(
        [(n, c) for n, c in caller_counts.items() if c >= min_callers],
        key=lambda x: -x[1]
    )[:top_n]
    if not ranked:
        return True, "no modules meet min_callers threshold"
    # Build a fast title-scan index from KB JSON files (avoids semantic search score threshold)
    kb_titles_lower: set[str] = set()
    kb_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp", "rag_data", "project_knowledge")
    if os.path.isdir(kb_dir):
        for kb_file in globmod.glob(os.path.join(kb_dir, "*.json")):
            try:
                with open(kb_file, encoding="utf-8") as _f:
                    kb_entry = json.load(_f)
                title = kb_entry.get("title", "").lower()
                content = kb_entry.get("content", "").lower()
                kb_titles_lower.add(title + " " + content[:200])
            except Exception as _err:
                logger.debug(f"unnamed-except evolution_invariants.py:226: {type(_err).__name__}: {_err}")
                continue

    uncovered = []
    for name, _ in ranked:
        name_lower = name.lower()
        # Primary: semantic search; fallback: title/content text scan
        hits = ctx.project_engine.search_knowledge(name, top_k=1)
        if not hits:
            # Fallback: check if name appears as a word boundary in any KB entry title/content
            found = any(name_lower in text for text in kb_titles_lower)
            if not found:
                uncovered.append(name)
    if uncovered:
        return False, f"{len(uncovered)}/{len(ranked)} uncovered: {', '.join(uncovered)}"
    return True, f"all {len(ranked)} top-caller modules have KB entries"


def _is_regex(s: str) -> bool:
    return any(c in s for c in r"\.[](){}*+?^$|")


def _check_kb_freshness(inv: dict) -> tuple[bool, str]:
    """Warn if no KB entry has been updated within max_age_days days (staleness signal)."""
    if ctx.project_engine is None:
        return True, "engine not available — skipped (pipeline context)"
    import time
    max_age_days = inv.get("max_age_days", 14)
    entries = ctx.project_engine.list_knowledge_full()
    if not entries:
        return True, "KB empty"
    max_ts = max(e.get("timestamp", 0) for e in entries)
    age_days = (time.time() - max_ts) / 86400
    if age_days > max_age_days:
        from datetime import datetime
        last_str = datetime.fromtimestamp(max_ts).strftime("%Y-%m-%d") if max_ts else "never"
        return False, f"most recent KB update {age_days:.0f}d ago (last: {last_str}, threshold: {max_age_days}d)"
    from datetime import datetime
    last_str = datetime.fromtimestamp(max_ts).strftime("%Y-%m-%d")
    return True, f"last updated {age_days:.0f}d ago ({last_str})"


def _check_kb_content_no_pattern(inv: dict) -> tuple[bool, str]:
    """Scan all KB entries; fail if any title or content matches the given pattern.

    Use to guard against LLM artifact leaks (e.g. <|thinking|> tags in KB content).
    """
    if ctx.project_engine is None:
        return True, "engine not available — skipped (pipeline context)"
    pattern = inv["pattern"]
    entries = ctx.project_engine.list_knowledge_full()
    if not entries:
        return True, "KB empty (nothing to check)"
    leaking = []
    for e in entries:
        text = (e.get("title", "") or "") + "\n" + (e.get("content", "") or "")
        if re.search(pattern, text, re.IGNORECASE):
            leaking.append(e.get("id", "?")[:12])
    if leaking:
        return False, f"{len(leaking)} entries contain pattern '{pattern}': {', '.join(leaking[:5])}"
    return True, f"all {len(entries)} entries clean"


def _check_correlation_direction(inv: dict) -> tuple[bool, str]:
    """Verify a named correlation's sign + magnitude matches expectation.
    This is the ultimate anti-drift check: it fires when HME's self-metric
    is actively ANTI-correlated with musical outcome (HME thinks it's
    improving while the music gets worse).

    Config:
      path              — JSON file containing the correlations dict
      correlations_key  — top-level key holding the correlations object
                          (default: 'correlations')
      name              — correlation name (e.g. 'hme_coherence__verdict_numeric')
      direction         — 'positive' (r > threshold) or 'negative' (r < -threshold)
                          (default: 'positive')
      threshold         — minimum |r| required (default: 0.0 — any matching sign)
      min_n             — minimum sample size required to enforce (default: 10)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv["path"])
    name = inv["name"]
    corrs_key = inv.get("correlations_key", "correlations")
    direction = inv.get("direction", "positive")
    threshold = float(inv.get("threshold", 0.0))
    min_n = int(inv.get("min_n", 10))

    if not os.path.isfile(path):
        return True, f"{inv['path']} missing — can't check correlation"
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
        return True, f"{name!r} degenerate or missing — covered by variance check"
    if n < min_n:
        return True, f"{name!r} has n={n} < min_n={min_n}, too early to judge"
    if direction == "positive":
        if r < threshold:
            return False, (
                f"{name!r} r={r:+.3f} (want ≥{threshold:+.3f}, n={n}). "
                f"HME's self-metric is NOT tracking the expected outcome. "
                f"If this is the musical anchor and r is near 0 or negative, "
                f"HME's discipline is not producing better music — the whole "
                f"optimization direction is wrong."
            )
        return True, f"{name!r} r={r:+.3f}  n={n}  (positive, as expected)"
    if direction == "negative":
        if r > -threshold:
            return False, (
                f"{name!r} r={r:+.3f} (want ≤{-threshold:+.3f}, n={n})"
            )
        return True, f"{name!r} r={r:+.3f}  n={n}  (negative, as expected)"
    return False, f"unknown direction {direction!r} — use 'positive' or 'negative'"


def _check_metric_threshold(inv: dict) -> tuple[bool, str]:
    """Verify a named metric field stays above min_value (or below max_value)
    across recent rounds. Used for enforcing prediction-accuracy/recall floors
    once enough data has accumulated.

    Config:
      path                     — metric JSON file path
      history_key              — top-level array key (default: 'rounds')
      field                    — field inside each snapshot to check
      min_value                — required minimum (exclusive: value > min)
      max_value                — required maximum (exclusive: value < max)
      min_rounds               — only evaluate when ≥ this many data points
                                 (default: 3)
      require_positive_shifts  — only count rounds where 'shifted_modules'
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
        return True, f"metric file {inv['path']} missing — can't check"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {inv['path']}: {e}"
    history = data.get(history_key, [])
    if not isinstance(history, list):
        return True, f"{inv['path']}.{history_key} is not a list — skip"
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
        return True, f"only {len(qualifying)} qualifying rounds, need ≥{min_rounds}"
    # Check the most-recent round (strict) — we care about current state, not historical
    latest = qualifying[-1]
    if min_val is not None and latest <= min_val:
        return False, f"{field}={latest} below min_value={min_val} (over {len(qualifying)} rounds)"
    if max_val is not None and latest >= max_val:
        return False, f"{field}={latest} above max_value={max_val} (over {len(qualifying)} rounds)"
    return True, f"{field}={latest} within threshold ({len(qualifying)} rounds)"


def _check_metric_has_variance(inv: dict) -> tuple[bool, str]:
    """Verify a pipeline-metric JSON file has non-degenerate variance in the
    named field across its recent history. Catches the class of bug where a
    metric computation silently produces the same value every round (usually
    because upstream inputs are zero/missing), which makes downstream
    correlations degenerate.

    Config keys:
      path              — JSON file path (relative to PROJECT_ROOT)
      history_key       — top-level array field holding round snapshots
                          (default: 'history')
      field             — the field inside each snapshot to check
      min_distinct      — minimum distinct values required (default: 2)
      min_rounds        — only evaluate when history has >= this many entries
                          (default: 5 — don't fail cold-start pipelines)
      allow_null        — if True, null entries don't count against variance
                          (default: True — nulls are "no data", not "stuck")
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv["path"])
    field = inv["field"]
    history_key = inv.get("history_key", "history")
    min_distinct = int(inv.get("min_distinct", 2))
    min_rounds = int(inv.get("min_rounds", 5))
    allow_null = bool(inv.get("allow_null", True))

    if not os.path.isfile(path):
        return True, f"metric file {inv['path']} missing — can't check variance"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {inv['path']}: {e}"
    history = data.get(history_key, [])
    if not isinstance(history, list):
        return False, f"{inv['path']}.{history_key} is not a list"
    if len(history) < min_rounds:
        return True, f"only {len(history)} rounds, need ≥{min_rounds} for variance check"
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
            f"(need ≥{min_distinct} distinct values). Upstream input is "
            f"likely producing a constant — trace the metric's computation."
        )
    return True, f"{field!r} has {len(distinct)} distinct values over {len(values)} rounds"


def _check_activity_events_balanced(inv: dict) -> tuple[bool, str]:
    """Verify paired activity events fire with matching counts over recent
    rounds. Catches observability regressions where a refactor drops a
    pipeline emission silently.

    Config:
      path           — activity jsonl file (default metrics/hme-activity.jsonl)
      start_event    — name of the "begin" event (e.g. pipeline_start)
      end_event      — name of the "end" event (e.g. pipeline_run)
      require_field  — optional: events must have this field present to count
                        (useful for round_complete which was pre-rename emitted
                        without verdict field from chat-turn Stop hooks)
      window_events  — consider only the last N events (default 2000)
      min_occurrences — only evaluate when >= this many start_events observed
                        (default 2 — cold-start tolerance)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, inv.get("path", "metrics/hme-activity.jsonl"))
    start_event = inv["start_event"]
    end_event = inv["end_event"]
    require_field = inv.get("require_field", "")
    window = int(inv.get("window_events", 2000))
    min_occ = int(inv.get("min_occurrences", 2))

    if not os.path.isfile(path):
        return True, f"activity log {inv.get('path','metrics/hme-activity.jsonl')} missing — can't check"
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
        return True, f"only {starts} {start_event!r} in last {window} events, need ≥{min_occ}"
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
    (maintained by the invariants runner itself — not wired here yet).

    Config:
      path         — history file (default metrics/hme-invariant-history.json)
      min_streak   — minimum consecutive-FAIL runs to trigger (default 10)
    """
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT,
                        inv.get("path", "metrics/hme-invariant-history.json"))
    min_streak = int(inv.get("min_streak", 10))
    if not os.path.isfile(path):
        return True, "no invariant history yet — chronic-failure check inert"
    try:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
    except (OSError, _json.JSONDecodeError) as e:
        return False, f"cannot read {path}: {e}"
    chronic = []
    for inv_id, streaks in (data.get("fail_streaks") or {}).items():
        if isinstance(streaks, int) and streaks >= min_streak:
            chronic.append(f"{inv_id} ({streaks} runs)")
    if chronic:
        return False, (
            f"{len(chronic)} invariant(s) chronically failing: {', '.join(chronic[:5])}"
            + (f" +{len(chronic)-5} more" if len(chronic) > 5 else "")
        )
    return True, "no chronic failures"


def _check_same_commit_determinism(inv: dict) -> tuple[bool, str]:
    """Verify that consecutive pipeline rounds with the SAME commit produce
    identical metric values. Non-determinism in hme_coherence / HCI across
    same-commit runs means either the metric has random inputs (e.g. a
    clock-dependent verifier) or cached state leaks between runs.

    Config:
      activity_path       — activity jsonl (default metrics/hme-activity.jsonl)
      correlation_path    — musical-correlation.json (default)
      field               — field to check (default 'hme_coherence')
      tolerance           — absolute difference tolerance (default 0.01)
      window_events       — tail to scan (default 2000)
    """
    import json as _json
    activity_path = os.path.join(
        ctx.PROJECT_ROOT,
        inv.get("activity_path", "metrics/hme-activity.jsonl"),
    )
    corr_path = os.path.join(
        ctx.PROJECT_ROOT,
        inv.get("correlation_path", "metrics/hme-musical-correlation.json"),
    )
    field = inv.get("field", "hme_coherence")
    tolerance = float(inv.get("tolerance", 0.01))

    if not (os.path.isfile(activity_path) and os.path.isfile(corr_path)):
        return True, "activity log or correlation file missing — can't check"
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
        return True, "correlation file unparseable — can't check"
    hist = corr.get("history") or []

    # Build {tree_hash_or_sha: [values]}
    # tree_hash is preferred — it's stable across auto-commits that don't change
    # file content, so two same-source-tree runs can be compared. Falls back to
    # SHA extracted from round_id for older history entries that lack tree_hash.
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
    # Count how many shas had ≥2 rounds (any at all) as evidence the check ran
    with_enough = sum(1 for vals in by_sha.values() if len(vals) >= 2)
    if with_enough == 0:
        return True, f"no commit has ≥2 rounds yet — check inert"
    return True, f"{with_enough} commit(s) evaluated, all within tol={tolerance}"


def _check_activity_field_sanity(inv: dict) -> tuple[bool, str]:
    """Validate that a named field on recent activity events matches an
    expected pattern. Catches garbage-module bugs (file_written emitting
    module='18446744073709550176' from LanceDB internal files, for example).

    Config:
      path            — activity jsonl (default metrics/hme-activity.jsonl)
      event           — event type to check (e.g. 'file_written')
      field           — field name to validate (e.g. 'module')
      pattern         — regex that the field value must match
      window_events   — consider only the last N events (default 2000)
      max_violations  — fail threshold (default 10 — tolerate legacy noise)
      exclude_values  — field values to skip (e.g. empty strings)
      require_fields  — event must have ALL these fields (non-empty) to count;
                        skips legacy events that predate a schema extension
                        (e.g. 'source' was added post-R09 — pre-R09 events
                        without it are legacy noise, not current violations)
    """
    import json as _json
    import re as _re
    path = os.path.join(ctx.PROJECT_ROOT,
                        inv.get("path", "metrics/hme-activity.jsonl"))
    event_name = inv["event"]
    field = inv["field"]
    pattern = _re.compile(inv["pattern"])
    window = int(inv.get("window_events", 2000))
    max_violations = int(inv.get("max_violations", 10))
    exclude = set(inv.get("exclude_values", ["", None]))
    require_fields = inv.get("require_fields", [])

    if not os.path.isfile(path):
        return True, f"activity log missing — can't check"
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
        # events without 'source'). Without this, adding a new field causes
        # retroactive invariant failures on all historical events.
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
    return True, f"{len(violations)} invalid (≤{max_violations} tolerance)"


def _check_public_functions_reachable(inv: dict) -> tuple[bool, str]:
    """Every undecorated public function (no leading `_`) in a scanned dir must
    be either @ctx.mcp.tool-decorated, referenced from another module, OR
    listed in the explicit `allowed_internals` list. Catches the class of
    bug where a handler is defined with a public-looking name but nothing
    can actually call it (status() was unreachable for months for exactly
    this reason).

    Config:
      scan_dir         — directory to walk for .py files
      allowed_internals — list of function names that are legitimately
                          internal-but-undecorated (dispatch-table-called,
                          test harness, etc.)
    """
    import ast as _ast
    import re as _re
    scan_dir = os.path.join(ctx.PROJECT_ROOT, inv["scan_dir"])
    allowed = set(inv.get("allowed_internals", []))
    candidates: dict = {}
    for root, _dirs, files in os.walk(scan_dir):
        if "__pycache__" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            try:
                tree = _ast.parse(open(path, encoding="utf-8").read(), filename=path)
            except (OSError, SyntaxError):
                continue
            for node in tree.body:
                if not isinstance(node, _ast.FunctionDef):
                    continue
                if node.name.startswith("_"):
                    continue
                if node.name in allowed:
                    continue
                has_tool = any(
                    "mcp.tool" in (_ast.unparse(d) if hasattr(_ast, "unparse") else "")
                    for d in node.decorator_list
                )
                if has_tool:
                    continue
                rel = os.path.relpath(path, ctx.PROJECT_ROOT)
                candidates[node.name] = (rel, node.lineno)

    # Check cross-file references
    scan_root = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp")
    orphans: list = []
    for name, (file, line) in candidates.items():
        refs = 0
        for root, _dirs, files in os.walk(scan_root):
            if "__pycache__" in root:
                continue
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                rel = os.path.relpath(path, ctx.PROJECT_ROOT)
                if rel == file:
                    continue
                try:
                    content = open(path, encoding="utf-8").read()
                except OSError:
                    continue
                if _re.search(rf"\b{_re.escape(name)}\b", content):
                    refs += 1
                    break
        if refs == 0:
            orphans.append(f"{file}:{line}:{name}")

    if orphans:
        preview = ", ".join(orphans[:5])
        suffix = f" (+{len(orphans)-5} more)" if len(orphans) > 5 else ""
        return False, (
            f"{len(orphans)} undecorated public function(s) with zero external "
            f"references: {preview}{suffix}. Either prefix with `_` to mark "
            f"internal, add @ctx.mcp.tool() to expose, or add to "
            f"`allowed_internals` in the invariant config."
        )
    return True, f"all {len(candidates)} public functions reachable"


def _check_shell_output_empty(inv: dict) -> tuple[bool, str]:
    """Run a shell command; pass if stdout is empty, fail if it produces any output.

    Use for git-clean checks: shell='git ls-files --others --exclude-standard'
    fails if any untracked non-gitignored files exist.
    Optional 'cwd' key (default: PROJECT_ROOT).
    """
    import subprocess
    shell_cmd = inv["shell"]
    cwd = inv.get("cwd", ctx.PROJECT_ROOT)
    result = subprocess.run(
        shell_cmd, shell=True, capture_output=True, text=True, cwd=cwd
    )
    output = result.stdout.strip()
    if output:
        lines = output.splitlines()
        preview = ", ".join(lines[:5])
        suffix = f" (+{len(lines)-5} more)" if len(lines) > 5 else ""
        return False, f"{len(lines)} untracked file(s): {preview}{suffix}"
    return True, "no untracked files"


# Main entry point

def _eval(inv: dict) -> tuple[bool, str]:
    checkers = {
        "files_executable": _check_files_executable,
        "files_referenced": _check_files_referenced,
        "file_exists": _check_file_exists,
        "symlink_valid": _check_symlink_valid,
        "json_valid": _check_json_valid,
        "glob_count_gte": _check_glob_count_gte,
        "pattern_in_file": _check_pattern_in_file,
        "patterns_all_in_file": _check_patterns_all_in_file,
        "pattern_count_gte": _check_pattern_count_gte,
        "symbols_used": _check_symbols_used,
        "symbols_have_kb": _check_symbols_have_kb,
        "files_mtime_window": _check_files_mtime_window,
        "kb_content_no_pattern": _check_kb_content_no_pattern,
        "kb_freshness": _check_kb_freshness,
        "metric_has_variance": _check_metric_has_variance,
        "metric_threshold": _check_metric_threshold,
        "correlation_direction": _check_correlation_direction,
        "activity_events_balanced": _check_activity_events_balanced,
        "activity_field_sanity": _check_activity_field_sanity,
        "same_commit_determinism": _check_same_commit_determinism,
        "invariant_chronically_failing": _check_invariant_chronically_failing,
        "public_functions_reachable": _check_public_functions_reachable,
        "shell_output_empty": _check_shell_output_empty,
    }
    inv_type = inv.get("type", "")
    checker = checkers.get(inv_type)
    if not checker:
        return False, f"unknown type: {inv_type}"
    try:
        return checker(inv)
    except FileNotFoundError as e:
        return False, f"file not found: {e.filename}"
    except Exception as e:
        return False, f"check error: {e}"


def _persist_invariant_history(results: list) -> None:
    """Update metrics/hme-invariant-history.json with pass/fail streaks.
    fail_streaks[id] = consecutive FAILs (reset on PASS, incremented on FAIL).
    last_run tracks most recent timestamp so stale invariants can be detected.
    """
    import json as _json
    import time as _time
    history_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-invariant-history.json")
    history: dict = {}
    if os.path.isfile(history_path):
        try:
            with open(history_path, encoding="utf-8") as _f:
                history = _json.load(_f) or {}
        except (OSError, _json.JSONDecodeError):
            history = {}
    fail_streaks = history.get("fail_streaks") or {}
    last_result = history.get("last_result") or {}
    for inv, ok, _detail in results:
        inv_id = inv.get("id", "?")
        if ok:
            fail_streaks[inv_id] = 0
        else:
            fail_streaks[inv_id] = int(fail_streaks.get(inv_id, 0)) + 1
        last_result[inv_id] = "pass" if ok else "fail"
    out = {
        "last_run": int(_time.time()),
        "total_runs": int(history.get("total_runs", 0)) + 1,
        "fail_streaks": fail_streaks,
        "last_result": last_result,
    }
    os.makedirs(os.path.dirname(history_path), exist_ok=True)
    tmp = history_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as _f:
        _json.dump(out, _f, indent=2)
    os.replace(tmp, history_path)


def check_invariants(verbose: bool = False) -> str:
    """Run the declarative invariant battery from config/invariants.json."""
    try:
        invariants = _load_invariants()
    except Exception as e:
        return f"# Invariant Battery: FAILED TO LOAD\n\nError: {e}"

    if not invariants:
        return "# Invariant Battery: empty\n\nAdd invariants to tools/HME/config/invariants.json"

    results: list[tuple[dict, bool, str]] = []
    for inv in invariants:
        ok, detail = _eval(inv)
        results.append((inv, ok, detail))

    # Persist per-invariant pass/fail history so the chronic-failure check
    # has data. Increments fail_streak on FAIL, resets on PASS. Tracked per
    # invariant id so retirement/rename doesn't leak into unrelated streaks.
    try:
        _persist_invariant_history(results)
    except Exception as _hist_err:
        logger.debug(f"invariant history write failed: {type(_hist_err).__name__}: {_hist_err}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    parts = [f"# Invariant Battery: {passed}/{total} passed ({total} from invariants.json)\n"]

    errors = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "error"]
    warnings = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "warning"]
    infos = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "info"]
    passes = [(inv, d) for inv, ok, d in results if ok]

    if errors:
        parts.append(f"## ERRORS ({len(errors)})\n")
        for inv, detail in errors:
            parts.append(f"  FAIL [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    if warnings:
        parts.append(f"## WARNINGS ({len(warnings)})\n")
        for inv, detail in warnings:
            parts.append(f"  WARN [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    if infos:
        parts.append(f"## INFO ({len(infos)})\n")
        for inv, detail in infos:
            parts.append(f"  INFO [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    # Enumerate PASSes only when verbose=True OR there are no failures.
    # When there ARE failures, the agent only needs the failing items to
    # act on; the 100+ PASS lines are ~8k chars of pure filler per call.
    # An "all <N> pass" summary conveys the same positive signal in ~60
    # chars. The `evolve(focus='invariants', query='verbose')` escape
    # hatch surfaces the full listing when needed.
    if passes and (verbose or not (errors or warnings or infos)):
        parts.append(f"## Verified ({len(passes)})\n")
        for inv, detail in passes:
            line = f"  PASS [{inv['id']}]: {inv['description']}"
            if detail:
                line += f" ({detail})"
            parts.append(line)
    elif passes:
        parts.append(f"## Verified ({len(passes)} — detail suppressed; use `evolve(focus='invariants', query='verbose')` for full listing)")

    parts.append(f"\n## Extending")
    parts.append(f"Add to `tools/HME/config/invariants.json` — no Python changes needed.")
    parts.append(f"Types: files_executable, files_referenced, file_exists, symlink_valid,")
    parts.append(f"json_valid, glob_count_gte, pattern_in_file, patterns_all_in_file,")
    parts.append(f"pattern_count_gte, symbols_used, symbols_have_kb, files_mtime_window,")
    parts.append(f"kb_content_no_pattern, kb_freshness")

    return "\n".join(parts)
