"""E1: standalone Context Capsule linter (run via `python3` or import; no shebang
-- library + thin CLI).

Reuses the dispatch guard's _load_capsule + _capsule_coverage_gaps so the lint
matches EXACTLY what team_dispatch_guard.py enforces before a peer is grounded
(single source of truth -- no second drifting implementation). Reports:
  - missing required sections (## artifact / ## goal / ## rubric), and
  - coverage<->evidence gaps (a `## coverage included:` code symbol absent from
    the `## evidence` body).

Exit 0 = clean; exit 1 = at least one capsule has an issue; exit 2 = usage error.

Usage:
  capsule_lint.py <capsule.md> [<capsule.md> ...]
  capsule_lint.py --all            # lint every teams/capsules/*.md (except README)
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_GUARD = _REPO / "tools" / "HME" / "scripts" / "team_dispatch_guard.py"
# Capsules whose ## evidence is intentionally narrative (no embedded source) and
# therefore not subject to the required-section/coverage contract.
_EXEMPT = {"README.md", "ctx_design.md"}
_CAP = 300000


def _guard():
    spec = importlib.util.spec_from_file_location("team_dispatch_guard", _GUARD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def lint_capsule(path: str | Path, guard=None) -> dict:
    g = guard or _guard()
    p = Path(path)
    text, missing = g._load_capsule(p, _CAP)
    # Resolve ## evidence file references to LIVE source (mirrors what the guard
    # inlines at dispatch) so the coverage<->evidence check runs against current
    resolved = g._resolve_capsule(text, _REPO, _CAP)
    gaps = g._capsule_coverage_gaps(resolved)
    return {"capsule": str(p), "missing_sections": missing, "coverage_gaps": gaps,
            "ok": not missing and not gaps}


def _all_capsules() -> list[Path]:
    d = _REPO / "teams" / "capsules"
    return [c for c in sorted(d.glob("*.md")) if c.name not in _EXEMPT]


def main(argv: list) -> int:
    os.environ.setdefault("PROJECT_ROOT", str(_REPO))
    if argv[:1] == ["--all"]:
        targets = _all_capsules()
    elif argv:
        targets = [Path(a) for a in argv if not a.startswith("--")]
    else:
        sys.stderr.write("usage: capsule_lint.py <capsule.md>... | --all\n")
        return 2
    if not targets:
        sys.stderr.write("no capsules to lint\n")
        return 2
    g = _guard()
    bad = 0
    for t in targets:
        try:
            r = lint_capsule(t, g)
        except OSError as e:
            print(f"FAIL  {t}: cannot read ({e})")
            bad += 1
            continue
        if r["ok"]:
            print(f"ok    {t.name}")
        else:
            bad += 1
            detail = []
            if r["missing_sections"]:
                detail.append("missing sections: " + ", ".join(r["missing_sections"]))
            if r["coverage_gaps"]:
                detail.append("coverage gaps: " + ", ".join(r["coverage_gaps"][:12]))
            print(f"FAIL  {t.name}: " + "; ".join(detail))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
