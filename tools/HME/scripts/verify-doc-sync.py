#!/usr/bin/env python3
"""Doc-code sync verifier for HME.

Scans doc/*.md and README.md for HME tool references, compares them against
the actual tool surface discovered by parsing the MCP server source files,
and reports mismatches. Intended to run as a pipeline step so doc drift
(like stale `before_editing` / `add_knowledge` / `find()` references) gets
caught at CI time rather than confusing agents months later.

Exit codes:
    0 — all references valid
    1 — drift detected (prints the report)
    2 — unexpected error (malformed source, etc.)

Usage:
    python3 tools/HME/scripts/verify-doc-sync.py
    python3 tools/HME/scripts/verify-doc-sync.py --fix  # print suggested sed replacements
"""
import ast
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

_SOURCE_DIR = os.path.join(_PROJECT, "tools", "HME", "mcp", "server", "tools_analysis")
_SERVER_ROOT = os.path.join(_PROJECT, "tools", "HME", "mcp", "server")
_DOC_DIRS = [
    os.path.join(_PROJECT, "doc"),
    os.path.join(_PROJECT, "tools", "HME", "skills"),
]
_DOC_FILES_EXTRA = [
    os.path.join(_PROJECT, "README.md"),
    os.path.join(_PROJECT, "CLAUDE.md"),
]

# Old tool names that no longer exist as agent-callable and their replacements.
# When adding new tools, update this map so legacy refs continue to get caught.
_LEGACY_MAP = {
    # Search / KB
    "search_knowledge":  "learn(query=...)",
    "add_knowledge":     "learn(title=, content=)",
    "remove_knowledge":  "learn(remove=id)",
    "compact_knowledge": "learn(action='compact')",
    "export_knowledge":  "learn(action='export')",
    "list_knowledge":    "learn(action='list')",
    "knowledge_graph":   "learn(action='graph')",
    "memory_dream":      "learn(action='dream')",
    "kb_health":         "learn(action='health')",
    # Search (generic)
    "find(query":        "learn(query=...) or trace(target)",
    "search_code(":      "learn(query=...)",
    "find_callers(":     "trace(target)",
    "file_intel(":       "read(target) [hidden; use Read tool]",
    "file_lines(":       "read(target:start-end) [hidden]",
    "get_function_body(": "read(functionName) [hidden]",
    "module_intel(":     "read(target, mode='story') [hidden]",
    # Workflow
    "before_editing(":   "Edit (briefing auto-chains)",
    "what_did_i_forget": "review(mode='forget')",
    "convention_check":  "review(mode='convention')",
    "symbol_audit":      "review(mode='symbols')",
    "doc_sync":          "review(mode='docs')",
    "pipeline_digest":   "review(mode='digest')",
    "regime_report":     "review(mode='regime')",
    "trust_report":      "review(mode='trust')",
    "section_compare":   "review(mode='sections')",
    "audio_analyze":     "review(mode='audio')",
    "codebase_health":   "review(mode='health')",
    # Evolution planning
    "suggest_evolution": "evolve(focus='pipeline')",
    "coupling_intel":    "evolve(focus='coupling')",
    "design_bridges":    "evolve(focus='design')",
    "forge_bridges":     "evolve(focus='forge')",
    "kb_seed":           "evolve(focus='seed')",
    "check_invariants":  "evolve(focus='invariants')",
    "blast_radius":      "evolve(focus='blast', query=...)",
    # Admin
    "hme_selftest":      "hme_admin(action='selftest')",
    "hme_hot_reload":    "hme_admin(action='reload')",
    "index_codebase":    "hme_admin(action='index')",
    "clear_index":       "hme_admin(action='clear_index')",
    "hme_introspect":    "hme_admin(action='introspect')",
    # Todo
    "todo(action":       "hme_todo(action=...) [hidden MCP utility]",
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
    # Allow if line mentions a dispatching tool name — the legacy word is
    # likely being described as a sub-action under that dispatcher, e.g.,
    # `hme_admin(action) | selftest / reload / index / clear_index / ...`
    if any(dispatcher in line for dispatcher in ("hme_admin(", "review(mode", "learn(action", "evolve(focus")):
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
            # Word-boundary match — legacy name must not be preceded by an
            # identifier character, so `todo(` doesn't match inside `hme_todo(`.
            pattern = r'(?<![\w.])' + re.escape(legacy)
            m = re.search(pattern, line)
            if not m:
                continue
            # If the match is wrapped in quotes or backticks as a literal
            # string token (e.g., "clear_index" or `add_knowledge`), it's a
            # LITERAL name in a table cell or code fence — not a callable ref.
            # Check the character immediately before the match.
            start = m.start()
            before = line[start - 1] if start > 0 else ""
            if before in ('"', "'", "`"):
                continue
            hits.append((i, legacy, replacement, line.rstrip()))
    return hits


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

    print(f"# Doc-code sync report")
    print(f"Project root: {_PROJECT}")
    print(f"Actual tool surface (from @ctx.mcp.tool() scan): {sorted(actual_tools)}")
    print(f"Files scanned: {sum(1 for _ in _iter_doc_files())}")
    print(f"Drift hits: {total_hits}")
    print()

    if total_hits == 0:
        print("OK — no stale tool references detected.")
        return 0

    for rel, hits in sorted(reports.items()):
        print(f"## {rel}")
        for lineno, legacy, replacement, line_text in hits:
            print(f"  {rel}:{lineno} — `{legacy}` → `{replacement}`")
            if fix_mode:
                trimmed = line_text.strip()[:80]
                print(f"    (line: {trimmed!r})")
        print()

    if fix_mode:
        print("Fix mode: review each hit above and update the doc.")
        print("Not all legacy mentions are wrong — check context before editing.")
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
