#!/usr/bin/env python3
"""Audit Python files for undefined-name references at module scope.

This is the project-local analog of `ruff check --select F821`. It walks the
AST of every Python file under tools/HME/ + src/scripts/pipeline/ + scripts/, and
flags `Name(ctx=Load)` references that aren't bound by any of:

  - module-level def/class
  - module-level assignment (incl. tuple unpack, AugAssign, AnnAssign)
  - import / from-import (including aliased)
  - function arguments (incl. *args, **kwargs, posonly, kwonly)
  - for-loop / comprehension targets (incl. tuple unpack)
  - except-handler `as` name
  - with-item `as` name
  - lambda arguments

Why we wrote this rather than depending on ruff/pyflakes:
  - The repo has no Python build dep (csv_maestro lives in its own package);
    adding a tooling dependency for one verifier costs more than it saves.
  - Stdlib-only means the audit runs identically on every machine that has
    Python 3.10+, no `pip install` step.
  - Targeted scope: we only care about F821-class issues. ruff/pyflakes do
    much more, much of which is noisy on a codebase that wasn't designed
    against them.

Why this matters: every prod bug fixed in the worker / synthesis / coupling
sweep on 2026-05-01 was a missing import after a LOC-driven file split. The
parent module imported its child at the bottom and the child referenced
parent symbols by bare name, working only when the parent loaded first.
Tests didn't exercise the failing load orders, so the bugs accumulated
silently until the worker crashed on first request.

Limitations:
  - We don't trace cross-module imports. A name imported from a sibling
    will be flagged if the local file doesn't have an import for it,
    even if it's "available via the package init." That's the point --
    those are exactly the bugs that bit us.
  - Nested-tuple unpack in `for` targets (`for a, (b, c) in xs`) is handled
    one level deep; deeper nesting may produce false positives. Add such
    names to COMMON_LOOP_VARS if the noise is too much.
  - Names defined via `globals()[k] = v` or `setattr(module, ...)` look
    undefined to AST. Same tradeoff: that pattern hides errors, so flagging
    it is arguably correct.

Usage:
    python3 tools/HME/scripts/audit-python-undefined-names.py
    python3 tools/HME/scripts/audit-python-undefined-names.py --path tools/HME/service
    python3 tools/HME/scripts/audit-python-undefined-names.py --json
    python3 tools/HME/scripts/audit-python-undefined-names.py --strict   # exit 1 on any

Exit codes:
    0 -- no findings (or every finding is in the false-positive ignore list)
    1 -- at least one suspect undefined name found
    2 -- usage error
"""
import ast
import builtins
import json
import os
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

_DEFAULT_ROOTS = [
    os.path.join(_PROJECT, "tools", "HME", "service"),
    os.path.join(_PROJECT, "tools", "HME", "scripts"),
    os.path.join(_PROJECT, "scripts"),
]

_SKIP_DIRS = {"__pycache__", ".git", "node_modules", "csv_maestro", "venv", ".venv"}

# Loop / tuple-unpack short names that are almost always tuple destructuring;
_COMMON_LOOP_VARS = set("a b c d e f g h i j k l m n p q r s t u v w x y z".split())
_COMMON_LOOP_VARS.update([
    "args", "kwargs", "val", "value", "key", "name", "path", "file", "line",
    "count", "desc", "idx", "data", "item", "elem", "el", "obj", "tok", "msg",
    "err", "exc", "ex", "ts", "dt",
])


def _collect_defined(tree: ast.AST) -> set:
    """Names resolvable somewhere in the tree without touching cross-module
    imports. Conservative: everything we can prove is bound stays out of the
    "suspect undefined" pool."""
    defined = set(dir(builtins)) | {"self", "cls"} | _COMMON_LOOP_VARS

    def _bind_target(t):
        if isinstance(t, ast.Name):
            defined.add(t.id)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for el in t.elts:
                _bind_target(el)
        elif isinstance(t, ast.Starred):
            _bind_target(t.value)

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                _bind_target(tgt)
        if isinstance(node, ast.AugAssign):
            _bind_target(node.target)
        if isinstance(node, ast.AnnAssign):
            _bind_target(node.target)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                head = (alias.asname or alias.name).split(".")[0]
                defined.add(head)
        if isinstance(node, (ast.For, ast.AsyncFor)):
            _bind_target(node.target)
        if isinstance(node, ast.comprehension):
            _bind_target(node.target)
        if isinstance(node, ast.arguments):
            for a in node.args + node.kwonlyargs + node.posonlyargs:
                defined.add(a.arg)
            if node.vararg:
                defined.add(node.vararg.arg)
            if node.kwarg:
                defined.add(node.kwarg.arg)
        if isinstance(node, ast.ExceptHandler) and node.name:
            defined.add(node.name)
        if isinstance(node, ast.withitem) and node.optional_vars is not None:
            _bind_target(node.optional_vars)
        if isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            defined.add(node.target.id)
    return defined


_IGNORE_FILE_MARKER = "audit-python-undefined-names: ignore-file"


def _audit_file(path: str) -> list:
    try:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        tree = ast.parse(src, filename=path)
    except (OSError, SyntaxError) as e:
        return [{"path": path, "error": f"{type(e).__name__}: {e}"}]

    # File-level suppression -- for partner-script "shared closure between
    if _IGNORE_FILE_MARKER in src:
        return []

    defined = _collect_defined(tree)
    findings = []
    seen = set()  # dedup per file
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)):
            continue
        if node.id in defined:
            continue
        if node.id.startswith("__"):
            continue  # dunder builtins per Python lookup rules
        if node.id in seen:
            continue
        seen.add(node.id)
        findings.append({
            "path": os.path.relpath(path, _PROJECT),
            "name": node.id,
            "line": node.lineno,
            "col": node.col_offset,
        })
    return findings


def _walk(roots: list[str]):
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if f.endswith(".py"):
                    yield os.path.join(dp, f)


def main(argv: list) -> int:
    paths = list(_DEFAULT_ROOTS)
    as_json = False
    strict = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--path":
            i += 1
            if i >= len(argv):
                sys.stderr.write("--path requires an argument\n")
                return 2
            paths = [os.path.join(_PROJECT, argv[i])]
        elif a == "--json":
            as_json = True
        elif a == "--strict":
            strict = True
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            sys.stderr.write(f"unknown arg: {a}\n")
            return 2
        i += 1

    all_findings = []
    for path in _walk(paths):
        all_findings.extend(_audit_file(path))

    if as_json:
        print(json.dumps({
            "findings": all_findings,
            "count": len(all_findings),
        }, indent=2))
    else:
        if not all_findings:
            print("audit-python-undefined-names: clean (0 findings)")
        else:
            print(f"audit-python-undefined-names: {len(all_findings)} suspect refs")
            for f in all_findings:
                if "error" in f:
                    print(f"  PARSE  {f['path']}: {f['error']}")
                else:
                    print(f"  {f['path']}:{f['line']}:{f['col']}  {f['name']}")

    if strict and all_findings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
