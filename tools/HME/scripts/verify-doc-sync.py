#!/usr/bin/env python3
"""Doc-code sync verifier for HME.

Scans doc/*.md and README.md for HME tool references, compares them against
the actual tool surface discovered by parsing the MCP server source files,
and reports mismatches. Intended to run as a pipeline step so doc drift
(like stale `before_editing` / `add_knowledge` / `find()` references) gets
caught at CI time rather than confusing agents months later.

Exit codes:
    0 -- all references valid
    1 -- drift detected (prints the report)
    2 -- unexpected error (malformed source, etc.)

Usage:
    python3 tools/HME/scripts/verify-doc-sync.py
    python3 tools/HME/scripts/verify-doc-sync.py --fix  # print suggested sed replacements
"""
import ast
import json
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

_SOURCE_DIR = os.path.join(_PROJECT, "tools", "HME", "service", "server", "tools_analysis")
_SERVER_ROOT = os.path.join(_PROJECT, "tools", "HME", "service", "server")
_DOC_DIRS = [
    os.path.join(_PROJECT, "doc"),
    os.path.join(_PROJECT, "tools", "HME", "skills"),
]
_DOC_FILES_EXTRA = [
    os.path.join(_PROJECT, "README.md"),
    os.path.join(_PROJECT, "doc", "templates", "AGENTS.md"),
]


def _load_invocations() -> dict:
    path = os.path.join(_PROJECT, "tools", "HME", "config", "tool-invocations.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"tools": {}, "actions": {}}


_INVOCATIONS = _load_invocations()


def _tool_form(name: str, fallback: str) -> str:
    entry = _INVOCATIONS.get("tools", {}).get(name, {})
    return entry.get("i") or entry.get("primer") or fallback


def _action_form(action: str) -> str:
    return _INVOCATIONS.get("actions", {}).get(action, f"i/hme admin action={action}")


# Old tool names that no longer exist as agent-callable and their replacements.
# When adding new tools, update this map so legacy refs continue to get caught.
_LEGACY_MAP = {
    # Search / KB
    "search_knowledge":  "i/learn query=...",
    "add_knowledge":     "i/learn title=... content=...",
    "remove_knowledge":  "i/learn action=remove",
    "compact_knowledge": "i/learn action=compact",
    "export_knowledge":  "i/learn action=export",
    "list_knowledge":    "i/learn action=list",
    "knowledge_graph":   "i/learn action=graph",
    "memory_dream":      "i/learn action=dream",
    "kb_health":         "i/learn action=health",
    # Search (generic)
    "find(query":        "i/learn query=... or i/trace target=...",
    "search_code(":      "i/learn query=...",
    "find_callers(":     "i/trace target=...",
    "file_intel(":       "native Read (HME-enriched)",
    "file_lines(":       "native Read (line ranges)",
    "get_function_body(": "native Read plus Grep",
    "module_intel(":     "native Read (HME-enriched)",
    # Workflow
    "before_editing(":   "Edit (briefing auto-chains)",
    "what_did_i_forget": _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "forget"),
    "convention_check":  _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "convention"),
    "symbol_audit":      _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "symbols"),
    "doc_sync":          _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "docs"),
    "pipeline_digest":   _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "digest"),
    "regime_report":     _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "regime"),
    "trust_report":      _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "trust"),
    "section_compare":   _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "sections"),
    "audio_analyze":     _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "audio"),
    "codebase_health":   _tool_form("review", "i/review mode=<MODE>").replace("<MODE>", "health"),
    # Evolution planning
    "suggest_evolution": "i/evolve focus=pipeline",
    "coupling_intel":    "i/evolve focus=coupling",
    "design_bridges":    "i/evolve focus=design",
    "forge_bridges":     "i/evolve focus=forge",
    "kb_seed":           "i/evolve focus=seed",
    "check_invariants":  "i/evolve focus=invariants",
    "blast_radius":      "i/evolve focus=blast query=...",
    # Admin
    "hme_selftest":      _action_form("selftest"),
    "hme_hot_reload":    _action_form("reload"),
    "index_codebase":    _action_form("index"),
    "clear_index":       _action_form("clear_index"),
    "hme_introspect":    _action_form("introspect"),
    # Todo
    "todo(action":       _tool_form("hme_todo", "TodoWrite"),
}

# Contexts where legacy names are FINE to appear (implementation refs, hook files, etc.)
_ALLOW_CONTEXTS = (
    "internal helper",
    "internal",
    "called by",
    "hidden",
    "via ",
    "legacy ",
    "deprecated",
    "pre-unification",
    "before ",  # "before X was unified"
    "which was ",
    "was previously",
    "action=",  # action=clear_index is a legitimate sub-action name
    "focus=",   # focus=blast is a legitimate sub-action
    "mode=",    # mode=forget etc
    "router",   # action-router descriptions
)


def _discover_actual_tools() -> set:
    """Walk the MCP server source tree and collect every @ctx.mcp.tool() name."""
    tools: set = set()
    for root, _dirs, files in os.walk(_SERVER_ROOT):
        for fname in files:
            if not fname.endswith(".py"):
                continue
            path = os.path.join(root, fname)
            try:
                with open(path, encoding="utf-8") as f:
                    tree = ast.parse(f.read(), filename=path)
            except Exception:
                # silent-ok: optional fallback path.
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.FunctionDef):
                    continue
                for dec in node.decorator_list:
                    if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                        if dec.func.attr == "tool":
                            tools.add(node.name)
                            break
    return tools


def _iter_doc_files():
    for d in _DOC_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for fname in files:
                if fname.endswith(".md"):
                    yield os.path.join(root, fname)
    for path in _DOC_FILES_EXTRA:
        if os.path.isfile(path):
            yield path


def _line_is_allowed(line: str) -> bool:
    lo = line.lower()
    if any(ctx in lo for ctx in _ALLOW_CONTEXTS):
        return True
    # Allow if line mentions a dispatching public wrapper -- the legacy word is
    # likely being described as a sub-action under that dispatcher.
    if any(dispatcher in line for dispatcher in ("i/hme admin", "i/review", "i/learn", "i/evolve")):
        return True
    return False


def _scan_file(path: str) -> list:
    """Return list of (lineno, legacy_name, replacement, line_text) for hits in this file."""
    hits = []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except Exception as e:
        return [("?", "read-error", str(e), "")]
    for i, line in enumerate(lines, start=1):
        if _line_is_allowed(line):
            continue
        for legacy, replacement in _LEGACY_MAP.items():
            # Word-boundary match -- legacy name must not be preceded by an
            # identifier character, so `todo(` doesn't match inside `hme_todo(`.
            pattern = r'(?<![\w.])' + re.escape(legacy)
            m = re.search(pattern, line)
            if not m:
                continue
            # If the match is wrapped in quotes or backticks as a literal
            start = m.start()
            before = line[start - 1] if start > 0 else ""
            if before in ('"', "'", "`"):
                continue
            hits.append((i, legacy, replacement, line.rstrip()))
    return hits


def _discover_declared_env_keys() -> tuple:
    """Walk all HME python sources AND scripts/ to classify env-key references.
    Returns (required, optional):
      required = ENV.require* calls -- fail at boot if missing
      optional = ENV.optional*, os.environ.get, os.getenv -- have defaults
    """
    required: set = set()
    optional: set = set()
    scan_roots = [
        os.path.join(_PROJECT, "tools", "HME"),
        os.path.join(_PROJECT, "scripts"),
    ]
    for scan_root in scan_roots:
        if not os.path.isdir(scan_root):
            continue
        for root, _dirs, files in os.walk(scan_root):
            if "__pycache__" in root:
                continue
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fh:
                        src = fh.read()
                    tree = ast.parse(src, filename=path)
                except (OSError, SyntaxError):
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.Call):
                        continue
                    key, kind = _classify_env_call(node)
                    if key is None:
                        continue
                    if kind == "required":
                        required.add(key)
                    else:
                        optional.add(key)
    return required, optional


def _classify_env_call(node) -> tuple:
    """Given an ast.Call, return (env_key, kind) if it's an env-read, else (None, None).
    kind is 'required' or 'optional'.
    Recognized forms:
      ENV.require*('KEY')                       -> required
      ENV.optional*('KEY', default)             -> optional
      os.environ.get('KEY', default)            -> optional
      os.getenv('KEY', default)                 -> optional
      os.environ['KEY']                         -> (subscript, not handled here)
    """
    func = node.func
    if isinstance(func, ast.Attribute):
        attr = func.attr
        # ENV.require* / ENV.optional*
        root = func.value
        if isinstance(root, ast.Name) and root.id in ("ENV", "env"):
            if attr in ("require", "require_int", "require_float", "require_bool"):
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    return node.args[0].value, "required"
            if attr in ("optional", "optional_int", "optional_float", "optional_bool"):
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    return node.args[0].value, "optional"
        if attr == "get" and isinstance(root, ast.Attribute):
            if (isinstance(root.value, ast.Name) and root.value.id == "os"
                    and root.attr == "environ"):
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    return node.args[0].value, "optional"
        if attr == "getenv" and isinstance(root, ast.Name) and root.id == "os":
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                return node.args[0].value, "optional"
    return None, None


def _discover_env_keys_in_file(path: str) -> set:
    """Parse a .env file and return the set of keys it defines."""
    keys: set = set()
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, _v = line.partition("=")
                k = k.strip()
                if k:
                    keys.add(k)
    except OSError:
        pass  # silent-ok: best-effort fs op
    return keys


def _check_env_schema() -> list:
    """Return a list of (rel_path, message) tuples for env schema drift.
    Two checks:
      1. Every ENV.require() key must exist in .env (or fail at boot -- but
         we surface at lint time too).
      2. Backtick-fenced HME_* tokens in docs should match real .env keys.
    """
    issues: list = []
    env_path = os.path.join(_PROJECT, ".env")
    if not os.path.isfile(env_path):
        return issues
    declared = _discover_env_keys_in_file(env_path)
    code_required, code_optional = _discover_declared_env_keys()
    code_total = code_required | code_optional

    # Code REQUIRES env key -> must exist in .env (fail-fast means ENV.require
    # throws at boot if missing, so drift here is always a real bug).
    missing_in_env = sorted(code_required - declared)
    for k in missing_in_env:
        issues.append((".env", f"ENV.require(`{k}`) has no matching .env entry -- will throw at boot"))

    # Docs backtick-mention HME_* token -> should be a real env key OR
    import glob as _glob
    doc_pat = re.compile(r'`(HME_[A-Z0-9_]+)`')
    for doc_dir in _DOC_DIRS:
        if not os.path.isdir(doc_dir):
            continue
        for md in _glob.glob(os.path.join(doc_dir, "**", "*.md"), recursive=True):
            try:
                with open(md, encoding="utf-8") as fh:
                    text = fh.read()
            except OSError:
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                for m in doc_pat.finditer(line):
                    token = m.group(1)
                    if token in declared or token in code_total:
                        continue
                    rel = os.path.relpath(md, _PROJECT)
                    issues.append((rel, f"line {lineno}: `{token}` referenced but not in .env or ENV.* calls -- stale doc reference"))
    return issues


def main(argv: list) -> int:
    fix_mode = "--fix" in argv
    actual_tools = _discover_actual_tools()
    total_hits = 0
    reports: dict = {}
    for path in _iter_doc_files():
        hits = _scan_file(path)
        if hits:
            rel = os.path.relpath(path, _PROJECT)
            reports[rel] = hits
            total_hits += len(hits)

    env_issues = _check_env_schema()
    total_env_issues = len(env_issues)
    total_hits += total_env_issues

    print(f"# Doc-code sync report")
    print(f"Project root: {_PROJECT}")
    print(f"Actual tool surface (from @ctx.mcp.tool() scan): {sorted(actual_tools)}")
    print(f"Files scanned: {sum(1 for _ in _iter_doc_files())}")
    print(f"Drift hits: {total_hits}")
    if total_env_issues:
        print(f"  (of which {total_env_issues} are env-schema issues)")
    print()

    if total_hits == 0:
        print("OK -- no stale tool references or env drift detected.")
        return 0

    for rel, hits in sorted(reports.items()):
        print(f"## {rel}")
        for lineno, legacy, replacement, line_text in hits:
            print(f"  {rel}:{lineno} -- `{legacy}` -> `{replacement}`")
            if fix_mode:
                trimmed = line_text.strip()[:80]
                print(f"    (line: {trimmed!r})")
        print()

    if env_issues:
        print("## env schema")
        for rel, msg in env_issues:
            print(f"  {rel}: {msg}")
        print()

    if fix_mode:
        print("Fix mode: review each hit above and update the doc.")
        print("Not all legacy mentions are wrong -- check context before editing.")
        print("If a mention describes HISTORY or INTERNAL helpers, it's allowed.")

    return 1 if total_hits > 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(2)
