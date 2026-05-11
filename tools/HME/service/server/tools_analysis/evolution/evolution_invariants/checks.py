"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import logging
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _resolve, _excluded, _is_regex, _resolve_glob
import time
import datetime

logger = logging.getLogger("HME")



def _check_files_executable(inv: dict) -> tuple[bool, str]:
    exclude = inv.get("exclude", [])
    files = _resolve_glob(inv["glob"])
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
        return True, f"-> {os.path.basename(target)}"
    return False, f"broken symlink -> {os.readlink(path)}"


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




# Re-exports from sibling cluster modules -- preserves the import surface
# in dispatch.py (`from .checks import _check_kb_freshness, ...`).
from .checks_kb import (  # noqa: F401, E402
    _check_symbols_have_kb, _is_regex, _check_kb_freshness,
    _check_kb_content_no_pattern,
)
from .checks_metric import (  # noqa: F401, E402
    _check_correlation_direction, _check_metric_threshold,
    _check_metric_has_variance,
)
from .checks_runtime import (  # noqa: F401, E402
    _check_activity_events_balanced, _check_invariant_chronically_failing,
    _check_same_commit_determinism, _check_activity_field_sanity,
)
from .checks_code import (  # noqa: F401, E402
    _check_public_functions_reachable, _check_shell_output_empty,
    _check_eslint_concordance_complete,
)
