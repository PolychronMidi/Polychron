#!/usr/bin/env python3
"""Ban silent-fallback imports for infrastructure modules.

The failure mode this catches: `try: from X import Y; except: fallback`
where `X` is critical infrastructure (hme_env, synthesis_config, context).
If Y is unavailable, the module genuinely can't function — silently
falling back to `os.environ.get(...)` or similar HIDES the breakage,
often for weeks. The exact bug this session had: `from .synthesis_config
import ENV` wrapped in `except Exception: fallback to os.environ` —
synthesis_config never exported ENV, so every call silently routed
through os.environ, defeating the .env-as-single-source-of-truth rule.

Banned:
    try:
        from hme_env import ENV
    except Exception:
        ENV = os.environ  # or any fallback

Allowed:
    from hme_env import ENV   # let import fail loud if hme_env is broken

Exit codes:
    0 — no violations (output is empty, shell_output_empty invariant PASS)
    non-0 — violations found (printed to stdout, invariant FAIL)
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path


# Modules whose import is load-bearing infrastructure. Wrapping their
# import in try/except is banned. Extend this list as more infrastructure
# modules become indispensable.
INFRASTRUCTURE_MODULES = frozenset({
    "hme_env",
    "context",
})

# Submodule imports like `from .synthesis_config import ENV` are banned
# when the imported NAME is one of these infrastructure-ish identifiers.
# Catches the exact bug this session had.
INFRASTRUCTURE_NAMES = frozenset({
    "ENV",
})


def _handler_catches(exc_type_node: ast.expr) -> bool:
    """True if the except clause catches ImportError or a broader error."""
    if exc_type_node is None:
        return True  # bare `except:` catches everything
    if isinstance(exc_type_node, ast.Name):
        return exc_type_node.id in ("ImportError", "ModuleNotFoundError", "Exception", "BaseException")
    if isinstance(exc_type_node, ast.Tuple):
        return any(_handler_catches(elt) for elt in exc_type_node.elts)
    return False


def _try_body_has_banned_import(body: list[ast.stmt]) -> tuple[bool, str]:
    """True if the try-body contains an import of a banned infrastructure module."""
    for node in body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in INFRASTRUCTURE_MODULES:
                    return True, f"import {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            mod_root = mod.split(".")[0] if mod else ""
            # Check module name first
            if mod_root in INFRASTRUCTURE_MODULES:
                imported = ", ".join(a.name for a in node.names)
                return True, f"from {mod} import {imported}"
            # Check imported names (covers `from .synthesis_config import ENV`)
            for alias in node.names:
                if alias.name in INFRASTRUCTURE_NAMES:
                    prefix = "." * (node.level or 0)
                    return True, f"from {prefix}{mod} import {alias.name}"
    return False, ""


def scan_file(path: Path) -> list[str]:
    violations: list[str] = []
    try:
        src = path.read_text(errors="ignore")
        tree = ast.parse(src, filename=str(path))
    except (OSError, SyntaxError):
        return violations

    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        has_banned, detail = _try_body_has_banned_import(node.body)
        if not has_banned:
            continue
        # Is at least one handler catching ImportError/Exception-level
        # (i.e. silently-swallowing the import failure)?
        catches = any(_handler_catches(h.type) for h in node.handlers)
        if not catches:
            continue
        # Does any handler contain a "fallback-like" substitute (anything
        # other than pure `raise` / `raise X` — logging is fine as long
        # as it still re-raises)?
        for h in node.handlers:
            reraises = False
            for stmt in ast.walk(h):
                if isinstance(stmt, ast.Raise):
                    reraises = True
                    break
            if not reraises:
                violations.append(
                    f"{path}:{node.lineno}: silent-fallback wrap of `{detail}` — "
                    f"infrastructure imports must fail loud; remove try/except."
                )
                break
    return violations


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    if not root.is_dir():
        print(f"ERROR: {root} is not a directory", file=sys.stderr)
        return 2
    all_violations: list[str] = []
    for py in root.rglob("*.py"):
        if "__pycache__" in py.parts:
            continue
        # hme_env.py itself is the loader — bootstrap exemption.
        if py.name == "hme_env.py":
            continue
        all_violations.extend(scan_file(py))
    for v in sorted(all_violations):
        print(v)
    return 1 if all_violations else 0


if __name__ == "__main__":
    sys.exit(main())
