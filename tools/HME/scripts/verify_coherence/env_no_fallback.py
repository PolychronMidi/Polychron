"""No-.env-fallback invariant.

The rule, absolute: any env key declared in .env (validated against
doc/templates/.env.example) MUST be accessed with strict subscript
`os.environ['KEY']`. A missing key MUST fail loud and point at .env.

FORBIDDEN, no exceptions:
    os.environ.get('KEY')                 # implicit None fallback
    os.environ.get('KEY', anything)       # explicit fallback
    os.environ.get('KEY') or anything     # disjunctive fallback
    os.environ.get('KEY', None)           # 'None default' is still a fallback
                                          # (poisons downstream `is None` checks
                                          #  that paper over missing .env loads)

There are no legitimate env chains. If a caller would tolerate either
of two keys, they must pick ONE canonical key in .env and read it
strictly; .env can then alias / interpolate to upstream sources.

Scope: every tracked Python file under
tools/HME/scripts/verify_coherence/ (the package whose strictness
underwrites the HCI score). Self-exempt: this module (it has to name
the pattern to detect it).
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

from ._base import (
    VerdictResult,
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
)

_SCAN_DIR = Path(_PROJECT) / "tools" / "HME" / "scripts" / "verify_coherence"
_TEMPLATE = Path(_PROJECT) / "doc" / "templates" / ".env.example"
_SELF_REL = "tools/HME/scripts/verify_coherence/env_no_fallback.py"


def _declared_env_keys(template: Path) -> "set[str]":
    """Parse .env.example for KEY=... lines; returns the set of declared keys."""
    keys: set[str] = set()
    if not template.exists():
        return keys
    pattern = re.compile(r"^([A-Z][A-Z0-9_]*)=")
    for line in template.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = pattern.match(line)
        if m:
            keys.add(m.group(1))
    return keys


def _is_environ_get(call: ast.Call) -> bool:
    """True iff this Call node is `os.environ.get(...)`."""
    func = call.func
    if not isinstance(func, ast.Attribute) or func.attr != "get":
        return False
    val = func.value
    if not isinstance(val, ast.Attribute) or val.attr != "environ":
        return False
    base = val.value
    return isinstance(base, ast.Name) and base.id == "os"


def _first_arg_str(call: ast.Call) -> "str | None":
    if not call.args:
        return None
    arg = call.args[0]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    return None


def _scan_file(path: Path, declared_keys: "set[str]") -> "list[str]":
    """Return list of 'path:line: <message>' offenders found in `path`."""
    offenders: list[str] = []
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
    except (OSError, SyntaxError):
        return offenders

    class V(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
            if _is_environ_get(node):
                key = _first_arg_str(node)
                if key and key in declared_keys:
                    offenders.append(
                        f"{path.relative_to(_PROJECT)}:{node.lineno}: "
                        f"os.environ.get({key!r}, ...) is forbidden; "
                        f"use os.environ[{key!r}] (no .env fallbacks)"
                    )
            self.generic_visit(node)

    V().visit(tree)
    return offenders


@register
class EnvNoFallbackVerifier(Verifier):
    """Enforce: required .env keys are accessed strictly; no `.get(...)` at all."""

    name = "env-no-fallback"
    category = "code"
    subtag = "interface-contract"

    def run(self) -> VerdictResult:
        declared = _declared_env_keys(_TEMPLATE)
        if not declared:
            return failed(
                ".env.example template missing or empty",
                details=[f"expected at {_TEMPLATE.relative_to(_PROJECT)}"],
            )

        offenders: list[str] = []
        for py in sorted(_SCAN_DIR.rglob("*.py")):
            rel = str(py.relative_to(_PROJECT))
            if rel == _SELF_REL:
                continue
            offenders.extend(_scan_file(py, declared))

        if offenders:
            return failed(
                f"{len(offenders)} .env-fallback subversion(s) in verify_coherence/",
                details=offenders[:50],
            )
        return passed(
            f"no .env fallbacks across {len(declared)} declared keys "
            f"in verify_coherence/",
        )
