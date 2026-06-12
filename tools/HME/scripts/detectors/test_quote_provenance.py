#!/usr/bin/env python3
"""Negative-control suite for quote_provenance.py.

Builds synthetic transcripts (real user prompt + final assistant text) under
PROJECT_ROOT/tmp so the detector's path-containment check passes, runs the
detector as a subprocess, and asserts the verdict for each case.

Usage: test_quote_provenance.py   (exit 0 all green, 1 on any fail)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_DET = Path(__file__).parent / "quote_provenance.py"
_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])


def _transcript(tmpdir: Path, user_texts: list[str], assistant_text: str) -> Path:
    rows = []
    for ut in user_texts:
        rows.append({"type": "user", "message": {"content": [{"type": "text", "text": ut}]}})
    rows.append({"type": "assistant", "message": {"content": [{"type": "text", "text": assistant_text}]}})
    p = tmpdir / "session.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    return p


def _run(transcript: Path) -> str:
    env = dict(os.environ)
    env.setdefault("PROJECT_ROOT", str(_ROOT))
    r = subprocess.run([sys.executable, str(_DET), str(transcript)],
                       capture_output=True, text=True, env=env)
    return (r.stdout or "").strip().splitlines()[-1] if r.stdout.strip() else ""


CASES = [
    # (name, user_texts, assistant_text, expected_verdict)
    ("real-quote-of-user",
     ["do 15 & 18"],
     'You said "do 15 & 18", so I started there.',
     "ok"),
    ("fabricated-attributed-quote",
     ["do 15 & 18"],
     'You said "frobnicate the gizmo", so I did.',
     "quote_fabrication"),
    ("paraphrase-no-delimited-quote",
     ["do 15 & 18"],
     "You wanted both items done, so I did them.",
     "ok"),
    ("tool-output-quote-no-user-attribution",
     ["run the tests"],
     'The grep returned "no matches" for that pattern.',
     "ok"),
    ("injected-banner-quote",
     ["[ALERT] LIFESAVER - MID-TURN ERRORS DETECTED: conflict markers detected"],
     'You said "conflict markers detected", so I cleaned them.',
     "quote_fabrication"),
    ("apostrophe-case-whitespace-variance",
     ["Don't   touch the Config"],
     "As you put it, `dont touch the config`.",
     "ok"),
]


def main() -> int:
    failures = []
    for name, users, asst, expected in CASES:
        with tempfile.TemporaryDirectory(dir=str(_ROOT / "tmp")) as td:
            tp = _transcript(Path(td), users, asst)
            got = _run(tp)
        ok = got == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: expected={expected} got={got}")
        if not ok:
            failures.append(name)
    if failures:
        print(f"\n{len(failures)} case(s) failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    print(f"all {len(CASES)} cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
