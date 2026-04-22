#!/usr/bin/env python3
"""Silent-fallback detector — the R33-class silent failure.

Bare `except Exception: return <default>` without any logger call swallows
real errors and returns a fake-healthy value. R33 found three instances in
the wild (i/review auto-fire, list_knowledge, get_knowledge_status); each
had degraded a substrate capability for an unknown period because the
fallback value LOOKED legitimate.

This check matches the pattern:
    except Exception[ as _]:
        return []          # or None, False, 0, {}, "", dict(), list(), set()

UNLESS a logger call (logger.debug/info/warning/error/exception) appears
in the except block before the return. Surfacing via logger is the
mitigation; the fallback itself is fine once the error is observable.

Exits 0 + empty stdout when clean. One-per-line `path:line: context`
format when hits found. Matches the scan/print contract used by
check-silent-except.py so the invariant battery surfaces both uniformly.
"""
from __future__ import annotations
import ast
import pathlib
import sys


FALLBACK_VALUES = {
    # Literal returns that look "empty" — the tell-tale silent default.
    "[]", "None", "False", "True", "0", "{}", "''", '""',
    "dict()", "list()", "set()", "tuple()",
}


def _has_log_call(node: ast.ExceptHandler) -> bool:
    """Does the except body contain ANY logger.* call before the return?"""
    for stmt in node.body:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            func = stmt.value.func
            # logger.debug(...) / logger.warning(...) / etc.
            if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
                if func.value.id == "logger":
                    return True
            # print(...) — also surfaces, acceptable for diagnostic scripts
            if isinstance(func, ast.Name) and func.id == "print":
                return True
        # Stop at return — anything after is unreachable
        if isinstance(stmt, ast.Return):
            return False
    return False


def _is_silent_fallback_return(node: ast.ExceptHandler) -> str | None:
    """Return a description of the silent fallback, or None if block is fine."""
    # Must catch Exception (bare or `as name`) — too-narrow catches are OK
    if node.type is None:
        caught = "bare except"
    elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
        caught = "except Exception"
    else:
        # except ValueError / except (A, B): specific handling, not silent-fallback
        return None

    # Must have return as first or only meaningful statement
    body = [s for s in node.body if not (isinstance(s, ast.Pass))]
    if not body:
        return None  # empty-catch handled by check-silent-except.py
    first = body[0]
    if not isinstance(first, ast.Return):
        return None

    # Return value must look like a "fake healthy" default
    val = first.value
    if val is None:
        return_repr = "None"
    elif isinstance(val, ast.Constant):
        return_repr = repr(val.value)
    elif isinstance(val, (ast.List, ast.Dict, ast.Set, ast.Tuple)) and len(val.elts if hasattr(val, 'elts') else val.keys) == 0:
        return_repr = "[]" if isinstance(val, ast.List) else ("{}" if isinstance(val, ast.Dict) else "empty-collection")
    elif isinstance(val, ast.Call) and isinstance(val.func, ast.Name) and val.func.id in {"dict", "list", "set", "tuple"} and not val.args:
        return_repr = f"{val.func.id}()"
    else:
        return None

    # The actual gate: is there a logger call preceding the return?
    if _has_log_call(node):
        return None

    return f"{caught} → return {return_repr} (no logger call before return)"


def scan(path: pathlib.Path) -> list[str]:
    hits: list[str] = []
    files = [path] if path.is_file() else list(path.rglob("*.py"))
    for f in files:
        try:
            src = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        try:
            tree = ast.parse(src, filename=str(f))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler):
                desc = _is_silent_fallback_return(node)
                if desc:
                    hits.append(f"{f}:{node.lineno}: {desc}")
    return hits


def main() -> int:
    paths = sys.argv[1:] or ["tools/HME/mcp"]
    all_hits: list[str] = []
    for p in paths:
        all_hits.extend(scan(pathlib.Path(p)))
    if all_hits:
        print("\n".join(sorted(all_hits)))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
