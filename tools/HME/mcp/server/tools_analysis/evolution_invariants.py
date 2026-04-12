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


# ── Check type implementations ──────────────────────────────────────────────

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
        except Exception:
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


def _is_regex(s: str) -> bool:
    return any(c in s for c in r"\.[](){}*+?^$|")


# ── Main entry point ────────────────────────────────────────────────────────

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


def check_invariants() -> str:
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

    parts.append(f"## Verified ({len(passes)})\n")
    for inv, detail in passes:
        line = f"  PASS [{inv['id']}]: {inv['description']}"
        if detail:
            line += f" ({detail})"
        parts.append(line)

    parts.append(f"\n## Extending")
    parts.append(f"Add to `tools/HME/config/invariants.json` — no Python changes needed.")
    parts.append(f"Types: files_executable, files_referenced, file_exists, symlink_valid,")
    parts.append(f"json_valid, glob_count_gte, pattern_in_file, patterns_all_in_file,")
    parts.append(f"pattern_count_gte, symbols_used")

    return "\n".join(parts)
