"""Read the live round progress ledger so a round is never flying blind (run via
`python3 teams/rounds/round_status.py`; no shebang -- thin reader + library).

The round runners (round_measured.sh, plan-consult.sh) append a durable record to
teams/runtime/round-progress.jsonl the instant each step changes status, and write
each peer reply to its own file as it returns. This reader shows current state at a
glance: the step ledger + which reply files exist with byte counts. A mid-round
death loses only the in-flight step, never the prior ones.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_LEDGER = Path(os.environ.get("HME_ROUND_PROGRESS_FILE", _REPO / "teams" / "runtime" / "round-progress.jsonl"))
_OUTDIR = _REPO / "teams" / "runtime" / "output"


def read_ledger(path: str | Path = _LEDGER) -> list[dict]:
    rows: list[dict] = []
    try:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    except OSError:
        return []
    return rows


def main(argv: list) -> int:
    rows = read_ledger()
    if not rows:
        print(f"no round progress ledger yet at {_LEDGER}")
        return 0
    rnd = rows[-1].get("round", "?")
    print(f"round: {rnd}")
    for r in rows:
        line = f"  [{r.get('progress','?')}] {r.get('step','?'):<18} {r.get('status','?'):<12}"
        typed = []
        if r.get("target"):
            typed.append(f"target={r['target']}")
        if "rc" in r:
            typed.append(f"rc={r['rc']}")
        if "reply_bytes" in r:
            typed.append(f"reply_bytes={r['reply_bytes']}")
        if r.get("error_log"):
            typed.append(f"error_log={r['error_log']}")
        if typed:
            line += " " + " ".join(typed)
        if r.get("detail"):
            line += f" -- {r['detail']}"
        print(line)
    # Reply files captured so far (durable per-step output).
    replies = sorted(_OUTDIR.glob("*.json"))
    if replies:
        print("captured replies:")
        for p in replies:
            try:
                reply = json.loads(p.read_text(encoding="utf-8")).get("reply", "")
                print(f"  {p.name}: {len(reply)} reply bytes")
            except (OSError, ValueError):
                print(f"  {p.name}: (unreadable / not yet complete)")
    last = rows[-1]
    if last.get("step") == "round" and last.get("status") == "done":
        state = "COMPLETE"
    elif last.get("step") == "round" and last.get("status") == "failed":
        # A failed round is terminal (complete), not in-progress -- surface it as
        # FAILED so a reader of only the final state is never misled either way.
        state = "FAILED"
    else:
        state = "in progress / incomplete"
    print(f"state: {state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
