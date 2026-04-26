#!/usr/bin/env python3
"""Python equivalent of ESLint rule `no-doubled-fallback`.

Detect `get(key, default) or something` patterns — either the `or` is dead
code (the default is non-falsy) or, worse, it silently rewrites legitimate
falsy values (empty list, 0, False, '') to the outer fallback. The JS rule
was added after an incident where `safePreBoot.call(..., 0.5) || 0.5`
coerced every legit 0-tension reading to 0.5, skewing regime logic. Same
class of bug in Python.

Matches:
    d.get(k, DEFAULT) or X          # default is already present — doubled
    dict_expr.get(k, DEFAULT) or X

Doesn't match (legitimate patterns):
    d.get(k) or X                   # default=None, `or` coalesces
    d.get(k, None) or X             # explicit None-default, same as above
    x or y                          # plain `or` with no inner .get()

Exits 0 + empty stdout when clean; one-per-line on hits.
"""
from __future__ import annotations
import ast
import pathlib
import sys


def _is_nontrivial_default(node: ast.AST) -> bool:
    """A 'nontrivial' default is anything that isn't None or a falsy literal
    that would flow through `or` identically. None or empty-collection as
    default is fine — the outer `or` catches them intentionally."""
    if isinstance(node, ast.Constant):
        # None, False, 0, '' → trivial — outer `or` is equivalent to `or`-on-None
        if node.value in (None, False, 0, ""):
            return False
        return True
    if isinstance(node, (ast.List, ast.Dict, ast.Set, ast.Tuple)):
        # Empty collections are falsy → trivial
        elts = node.elts if hasattr(node, "elts") else node.keys
        return len(elts) > 0
    # Any expression (call, name, attr) is nontrivial
    return True


def _check_boolop(node: ast.BoolOp) -> list[tuple[int, str]]:
    """Look for `X.get(k, DEFAULT) or Y` where DEFAULT is nontrivial."""
    hits = []
    if not isinstance(node.op, ast.Or):
        return hits
    # Examine each value except the last — the last is the fallback, the
    # preceding ones are the "primary" reads that might have inner defaults.
    for v in node.values[:-1]:
        if (isinstance(v, ast.Call)
                and isinstance(v.func, ast.Attribute)
                and v.func.attr == "get"
                and len(v.args) >= 2
                and _is_nontrivial_default(v.args[1])):
            # Grab the default-value source for the message
            try:
                default_repr = ast.unparse(v.args[1])
            except Exception:
                default_repr = "<default>"
            try:
                primary_repr = ast.unparse(v)[:60]
            except Exception:
                primary_repr = ".get(...)"
            hits.append((
                node.lineno,
                f"{primary_repr} OR ... (inner default {default_repr!r} "
                "already provides a value; outer `or` is doubled fallback)",
            ))
    return hits


def scan(path: pathlib.Path) -> list[str]:
    hits = []
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
            if isinstance(node, ast.BoolOp):
                for (line, msg) in _check_boolop(node):
                    hits.append(f"{f}:{line}: {msg}")
    return hits


def main() -> int:
    paths = sys.argv[1:] or ["tools/HME/service"]
    all_hits = []
    for p in paths:
        all_hits.extend(scan(pathlib.Path(p)))
    if all_hits:
        for h in sorted(all_hits)[:30]:
            print(h)
        if len(all_hits) > 30:
            print(f"... and {len(all_hits) - 30} more")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
