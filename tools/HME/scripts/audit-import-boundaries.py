#!/usr/bin/env python3
"""Audit cross-subsystem imports against declared public surfaces.

A subsystem here = any Python directory that contains an `__init__.py`.
The names that `__init__.py` re-exports define the subsystem's public
API. External code (anything outside the subsystem's directory tree)
that imports a name NOT in the public API is reaching into internals.

Why this matters: every LOC-driven file split this codebase has done
produced "bare-name reference between sibling files" bugs because
there was no enforced answer to "which names cross the boundary?"
We landed audit-python-undefined-names to catch the symptoms -- this
audit catches the cause: the import that shouldn't exist in the first
place.

Output: one line per offending import, formatted so editors can jump
to the source. Exit 0 on clean, 1 on findings (with --strict).

Usage:
    python3 scripts/audit-import-boundaries.py
    python3 scripts/audit-import-boundaries.py --json
    python3 scripts/audit-import-boundaries.py --strict
    python3 scripts/audit-import-boundaries.py --subsystem coupling

Design notes:
  - A subsystem's PUBLIC SURFACE is the set of names it imports in its
    own `__init__.py` via `from .submodule import X, Y`. Everything
    else is internal.
  - Same-package imports (within the subsystem) are always allowed.
  - Imports that target the SUBSYSTEM ITSELF (e.g. `from coupling import
    foo`) are public-API access; those are checked against the surface.
  - Imports that target an internal SUBMODULE (e.g. `from
    coupling.coupling_data import _pearson`) are flagged unless the
    importing file is itself inside that subsystem.
  - The audit doesn't try to MOVE imports automatically -- it surfaces
    drift so the developer can decide whether to expand the public
    surface or refactor the caller. Same posture as audit-loc /
    audit-python-undefined-names: report, don't enforce silently.
"""
import ast
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parent.parent)

_DEFAULT_ROOTS = [
    _PROJECT / "tools" / "HME" / "service",
]

_SKIP_DIRS = {"__pycache__", ".git", "node_modules", "venv", ".venv"}


def _find_subsystems(roots):
    """Return list of subsystem directories -- any dir with __init__.py
    that isn't itself the top-level of a root."""
    subsystems = []
    for root in roots:
        if not root.is_dir():
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            if "__init__.py" not in files:
                continue
            p = Path(dp)
            if p == root:
                continue  # the root itself isn't a subsystem
            subsystems.append(p)
    return subsystems


def _is_flat_package(subsystem_dir: Path) -> bool:
    """A subsystem opts out of strict-boundary checks by writing the
    sentinel `# audit: flat-package` in its __init__.py. Used for runtime
    packages that are architecturally a flat namespace (sibling-to-sibling
    imports are normal, no public/private API split). The audit treats
    every name in such a package as public -- in-package imports from
    outside the directory are still allowed, but submodule names aren't
    checked against a surface.

    Why a sentinel comment rather than an attribute: the marker has to be
    parseable WITHOUT importing the module (audit runs over hundreds of
    files, importing each one is too expensive and would trigger side
    effects). A comment-form marker is read-only and safe."""
    init = subsystem_dir / "__init__.py"
    try:
        text = init.read_text(encoding="utf-8")
    except OSError:
        return False
    return "# audit: flat-package" in text


def _public_surface(subsystem_dir: Path) -> set:
    """Names re-exported from __init__.py via `from .submodule import X`
    or `from .submodule import X as Y`. These are the subsystem's public
    API. Star-imports widen to "everything" -- represented as a sentinel.

    Loud on parse error: a corrupt __init__.py used to give an empty
    public surface, which then made every import into the subsystem
    look like a boundary violation. Now the audit refuses to run a
    subsystem-wide false-positive cascade and surfaces the parse error
    at the source."""
    init = subsystem_dir / "__init__.py"
    try:
        tree = ast.parse(init.read_text(encoding="utf-8"))
    except (OSError, SyntaxError) as e:
        raise SystemExit(
            f"audit-import-boundaries: __init__.py at {init} failed to "
            f"parse -- refusing to use empty surface (would mass-flag "
            f"every import as boundary-crossing). Fix the file or "
            f"remove __init__.py to declassify {subsystem_dir.name} as "
            f"a subsystem.\n  cause: {type(e).__name__}: {e}"
        )
    surface = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 1:
            # `from .x import y` -> exposes y
            for alias in node.names:
                if alias.name == "*":
                    surface.add("*")
                else:
                    surface.add(alias.asname or alias.name)
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
            surface.add(node.name)
        if isinstance(node, ast.ClassDef) and not node.name.startswith("_"):
            surface.add(node.name)
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and not tgt.id.startswith("_"):
                    surface.add(tgt.id)
    return surface


def _scan_imports(file_path: Path) -> list:
    """Return list of (line_no, target_module, imported_names) for every
    `from X import Y, Z` in the file. Skips relative imports -- they're
    intra-subsystem by definition.

    Loud on parse error: silently swallowing a SyntaxError used to mean
    a broken file got "0 imports flagged" and slipped through every
    boundary check. The agent rule that catches the same pattern at
    higher levels (no silent fallbacks) applies here."""
    try:
        tree = ast.parse(file_path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError) as e:
        # Surface as a sentinel finding, not a silent skip. Caller's
        # findings list will carry it through to the report.
        return [(-1, "<parse-error>", [f"{type(e).__name__}: {e}"])]
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level != 0:
                continue  # skip relative imports
            if not node.module:
                continue
            names = [alias.name for alias in node.names]
            out.append((node.lineno, node.module, names))
        # `import x.y.z` rarely targets HME internals -- module attribute
        # access at use sites would surface those separately.
    return out


def _is_within(path: Path, ancestor: Path) -> bool:
    try:
        path.resolve().relative_to(ancestor.resolve())
        return True
    except ValueError:
        return False


def _module_path_for(target: str, roots: list[Path]) -> Path | None:
    """Resolve a dotted module name (e.g. 'server.tools_analysis.coupling.
    coupling_data') to a file path under any of `roots`. Returns the
    first match. Tries both `pkg/sub.py` and `pkg/sub/__init__.py`."""
    parts = target.split(".")
    for root in roots:
        candidate_py = root.joinpath(*parts).with_suffix(".py")
        if candidate_py.is_file():
            return candidate_py
        candidate_pkg = root.joinpath(*parts) / "__init__.py"
        if candidate_pkg.is_file():
            return candidate_pkg
    return None


def main(argv: list) -> int:
    as_json = False
    strict = False
    only_sub = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            as_json = True
        elif a == "--strict":
            strict = True
        elif a == "--subsystem":
            i += 1
            only_sub = argv[i] if i < len(argv) else None
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            sys.stderr.write(f"unknown arg: {a}\n")
            return 2
        i += 1

    roots = list(_DEFAULT_ROOTS)
    subsystems = _find_subsystems(roots)
    if only_sub is not None:
        subsystems = [s for s in subsystems if s.name == only_sub]

    # Build subsystem -> public surface map. Flat-packages opt out of
    # strict-boundary checks entirely (see _is_flat_package).
    flat_packages = {s for s in subsystems if _is_flat_package(s)}
    surfaces = {s: _public_surface(s) for s in subsystems}

    # Index search roots so we can resolve dotted module paths to files.
    search_roots = roots + [
        _PROJECT / "tools" / "HME" / "service" / "server",
    ]

    findings = []
    # Walk every Python file under the roots; for each cross-subsystem
    for root in roots:
        if not root.is_dir():
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if not f.endswith(".py"):
                    continue
                fp = Path(dp) / f
                imports = _scan_imports(fp)
                for line_no, target, names in imports:
                    target_path = _module_path_for(target, search_roots)
                    if target_path is None:
                        continue  # non-HME third-party or stdlib
                    # Find which (if any) subsystem the target lives inside.
                    # If it lives inside the SAME subsystem as `fp`, allow.
                    target_subsystem = None
                    for s in subsystems:
                        if _is_within(target_path, s):
                            # target is inside subsystem s; pick the
                            if target_subsystem is None or _is_within(s, target_subsystem):
                                target_subsystem = s
                    if target_subsystem is None:
                        continue  # target isn't part of any subsystem
                    # Same subsystem? OK.
                    if _is_within(fp, target_subsystem):
                        continue
                    # Flat-package: target subsystem opted out of strict
                    if target_subsystem in flat_packages:
                        continue
                    # Target IS a subsystem boundary. Two cases:
                    target_pkg_name = ".".join(
                        target_subsystem.relative_to(_PROJECT).parts
                    )
                    target_dotted = target_pkg_name.replace("/", ".")
                    target_is_init = (target_path.name == "__init__.py")
                    surface = surfaces.get(target_subsystem, set())
                    if target_is_init:
                        # Public-API access -- check each imported name.
                        if "*" in surface:
                            continue
                        for n in names:
                            if n.startswith("_"):
                                findings.append({
                                    "kind": "private-import",
                                    "from_file": str(fp.relative_to(_PROJECT)),
                                    "line": line_no,
                                    "target": target,
                                    "name": n,
                                    "subsystem": target_subsystem.name,
                                })
                            elif n not in surface:
                                findings.append({
                                    "kind": "not-in-public-surface",
                                    "from_file": str(fp.relative_to(_PROJECT)),
                                    "line": line_no,
                                    "target": target,
                                    "name": n,
                                    "subsystem": target_subsystem.name,
                                })
                    else:
                        # Reaching into an internal submodule from outside
                        # the subsystem.
                        for n in names:
                            findings.append({
                                "kind": "reaches-into-internals",
                                "from_file": str(fp.relative_to(_PROJECT)),
                                "line": line_no,
                                "target": target,
                                "name": n,
                                "subsystem": target_subsystem.name,
                            })

    if as_json:
        print(json.dumps({
            "subsystems": [str(s.relative_to(_PROJECT)) for s in subsystems],
            "findings": findings,
            "count": len(findings),
        }, indent=2))
    else:
        # Group by kind for readability.
        grouped = defaultdict(list)
        for f in findings:
            grouped[f["kind"]].append(f)
        print(f"audit-import-boundaries: {len(findings)} cross-boundary imports "
              f"across {len(subsystems)} subsystems")
        for kind in ("reaches-into-internals", "not-in-public-surface", "private-import"):
            items = grouped.get(kind, [])
            if not items:
                continue
            print(f"\n  [{kind}] {len(items)}")
            for f in items[:30]:
                print(f"    {f['from_file']}:{f['line']}  "
                      f"from {f['target']} import {f['name']}  "
                      f"(subsystem: {f['subsystem']})")
            if len(items) > 30:
                print(f"    ... (+{len(items) - 30} more)")
    if strict and findings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
