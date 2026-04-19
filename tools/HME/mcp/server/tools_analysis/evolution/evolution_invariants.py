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
        "correlation_direction": _check_correlation_direction,
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
