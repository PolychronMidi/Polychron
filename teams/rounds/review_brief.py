"""Compose + lint per-surface review briefs (run via `python3` or import; no
shebang -- library + thin CLI).

A review brief is DATA (teams/rounds/review-briefs.json), not a committed doc and
not a channel-circumventing capsule file. `compose(key)` rebuilds the brief into
a review-request MESSAGE (framing sections + a `## evidence` reference to the LIVE
source); the round runner sends that message via ask-peer so it lands in the
red/blue/purple channel -- the brief IS a channel message. The guard inlines the
current source for every `## evidence` reference at dispatch, so a brief can never
drift into reviewing stale code.

`lint` reuses the dispatch guard's _resolve_capsule + _capsule_coverage_gaps
(single source of truth) so the check matches exactly what the guard enforces:
required sections present, and every `## coverage included:` symbol present in the
LIVE source.

Usage:
  review_brief.py --list
  review_brief.py compose <key> [--out <path>]
  review_brief.py --lint [<key> ...] | --all
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_BRIEFS = _REPO / "teams" / "rounds" / "review-briefs.json"
_GUARD = _REPO / "tools" / "HME" / "scripts" / "team_dispatch_guard.py"
_CAP = 300000
_REQUIRED = ("artifact", "goal", "rubric")


def _guard():
    spec = importlib.util.spec_from_file_location("team_dispatch_guard", _GUARD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load(path: str | Path = _BRIEFS) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    briefs = data.get("briefs") if isinstance(data, dict) else None
    return briefs if isinstance(briefs, dict) else {}


def compose(key: str, briefs: dict | None = None) -> str:
    b = (briefs if briefs is not None else load())[key]
    refs = "".join(f"- {r}\n" for r in b.get("evidence", []))
    return (
        f"# {b.get('title', key)}\n\n"
        f"## artifact\n{b.get('artifact', '').strip()}\n\n"
        f"## goal\n{b.get('goal', '').strip()}\n\n"
        f"## constraints\n{b.get('constraints', '').strip()}\n\n"
        f"## rubric\n{b.get('rubric', '').strip()}\n\n"
        f"## coverage\nincluded: {b.get('coverage_included', '').strip()}.\n"
        f"excluded: {b.get('coverage_excluded', '').strip()}.\n\n"
        f"## evidence\nLive source (read fresh at dispatch -- never a stale copy):\n{refs}"
    )


def lint(key: str, briefs: dict | None = None, guard=None) -> dict:
    g = guard or _guard()
    text = compose(key, briefs)
    sections = {name for _s, _e, name in g._capsule_headings(text)}
    missing = [s for s in _REQUIRED if s not in sections]
    resolved = g._resolve_capsule(text, _REPO, _CAP)
    gaps = g._capsule_coverage_gaps(resolved)
    return {"key": key, "missing_sections": missing, "coverage_gaps": gaps,
            "ok": not missing and not gaps}


def main(argv: list) -> int:
    if argv[:1] == ["--list"]:
        for k in sorted(load()):
            print(k)
        return 0
    if argv[:1] == ["compose"]:
        if len(argv) < 2:
            sys.stderr.write("usage: review_brief.py compose <key> [--out <path>]\n")
            return 2
        key = argv[1]
        try:
            text = compose(key)
        except KeyError:
            sys.stderr.write(f"unknown brief key: {key}\n")
            return 2
        if "--out" in argv:
            i = argv.index("--out")
            out = Path(argv[i + 1])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")
            print(f"wrote {out}")
        else:
            sys.stdout.write(text)
        return 0
    briefs = load()
    if argv[:1] == ["--all"]:
        keys = sorted(briefs)
    elif argv and not argv[0].startswith("--") or argv[:1] == ["--lint"]:
        keys = [a for a in argv if not a.startswith("--")] or sorted(briefs)
    else:
        sys.stderr.write("usage: review_brief.py --list | compose <key> | --lint [<key>...] | --all\n")
        return 2
    g = _guard()
    bad = 0
    for k in keys:
        if k not in briefs:
            print(f"FAIL  {k}: unknown brief key")
            bad += 1
            continue
        r = lint(k, briefs, g)
        if r["ok"]:
            print(f"ok    {k}")
        else:
            bad += 1
            detail = []
            if r["missing_sections"]:
                detail.append("missing sections: " + ", ".join(r["missing_sections"]))
            if r["coverage_gaps"]:
                detail.append("coverage gaps: " + ", ".join(r["coverage_gaps"][:12]))
            print(f"FAIL  {k}: " + "; ".join(detail))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
