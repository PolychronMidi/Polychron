"""E1: generate a Context Capsule skeleton for a source file (run via `python3`
or import; no shebang -- library + thin CLI).

The `## evidence` block REFERENCES the live source file path; it never embeds a
frozen copy. The guard (and capsule_lint) inline the current source at dispatch/
lint time, so a capsule can never drift into reviewing stale code. The author
then fills in goal/constraints/rubric and narrows `## coverage included:` to the
symbols actually under review.

The generated capsule passes capsule_lint by construction: every `## coverage
included:` symbol it lists is auto-extracted from the live source, and the linter
resolves the reference back to that same live source, so `_capsule_coverage_gaps`
returns []. Re-run capsule_lint after editing.

Usage:
  capsule_gen.py <source-file> [--title "..."] [--out teams/capsules/<name>.md]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
# Underscore-bearing identifiers and function declarations are the symbols the
# coverage<->evidence check verifies; pull a handful from the source as a seed.
_PY_DEF = re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.M)
_JS_FN = re.compile(r"\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")
_JS_CONST_FN = re.compile(r"\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(")


def _lang(path: Path) -> str:
    return {".py": "python", ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "ts",
            ".sh": "bash", ".bash": "bash"}.get(path.suffix.lower(), "")


def _symbols(text: str, lang: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    pats = [_PY_DEF] if lang == "python" else [_JS_FN, _JS_CONST_FN]
    for pat in pats:
        for m in pat.finditer(text):
            name = m.group(1)
            # The coverage check only verifies underscore-bearing/backtick symbols.
            if "_" in name and name not in seen:
                seen.add(name)
                out.append(name)
    return out


def generate(source: str | Path, title: str = "") -> str:
    p = Path(source)
    text = p.read_text(encoding="utf-8", errors="ignore")
    lang = _lang(p)
    rel = p.as_posix()
    try:
        rel = p.resolve().relative_to(_REPO).as_posix()
    except ValueError:
        pass  # silent-ok: source outside repo keeps its given path
    syms = _symbols(text, lang)
    included = ", ".join(syms[:14]) if syms else "the full live source"
    name = title or f"review {p.name}"
    return (
        f"# Context Capsule: {name}\n\n"
        f"## artifact\n{rel} -- TODO: one-paragraph description of what this code does.\n\n"
        f"## goal\nTODO: the decision-changing flaws to find (correctness/safety). Cite function + fix.\n\n"
        f"## constraints\nTODO: intentional behaviors a reviewer must NOT flag; what is in/out of scope.\n\n"
        f"## rubric\nClassify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact\n"
        f"failure, contradictory evidence (existing guard/test that may cover it, or 'none found\n"
        f"after checking'), and a one-line fix. A clean audit (no decision-changing issue, with\n"
        f"evidence) is a valid successful result.\n\n"
        f"## coverage\nincluded: {included}.\nexcluded: TODO -- imported helpers' internals and callers (assumed correct here).\n\n"
        f"## evidence\nLive source (read fresh at dispatch -- never a stale copy):\n- {rel}\n"
    )


def main(argv: list) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        sys.stderr.write("usage: capsule_gen.py <source-file> [--title \"...\"] [--out <path>]\n")
        return 2
    source = Path(args[0])
    if not source.is_file():
        sys.stderr.write(f"no such file: {source}\n")
        return 2
    title = ""
    out_path = None
    if "--title" in argv:
        i = argv.index("--title")
        title = argv[i + 1] if i + 1 < len(argv) else ""
    if "--out" in argv:
        i = argv.index("--out")
        out_path = Path(argv[i + 1]) if i + 1 < len(argv) else None
    capsule = generate(source, title)
    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(capsule, encoding="utf-8")
        print(f"wrote {out_path}")
    else:
        sys.stdout.write(capsule)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
