#!/usr/bin/env python3
"""Detect FABRICATION — asserting quantitative invariants about pipeline
state without the turn having observed the artifact that proves it.

Origin incident: R36 post-pipeline analysis. Agent asserted "total beats
held steady" as a bridge premise to justify a theory about stochastic
setBalanceAndFX gating, despite never having read the actual beat counts.
The claim was factually wrong (recent runs: 781, 954, 1043, 1155, 1106,
812, 1207, 1047, 1409, 996, 1171, 1056 — range 781-1409) and misled the
subsequent suggestion chain. User's framing: psychopathic fabrication to
subvert and distract. This detector is the stiffarm.

The antipattern shape: in a stochastic music generator, asserting that
some run-level metric held constant across runs without Reading the
artifact. The verbal fingerprint is a closed set of "steady/constant/
unchanged/same-as" phrases. Each run IS random — invariance is the
claim that needs proof, not the default.

Fires when final assistant text contains a fabrication phrase AND the
response has no explicit verification disclosure marker. A response that
verified via tool calls can say "(verified)" / "(confirmed)"; a response
that's speculating must say "(unverified)" / "(assumed)" / "(didn't
check)". Anything else gets blocked.

Usage: fabrication_check.py <transcript_path>
Output: "fabrication" or "ok"
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    load_turn_events, is_assistant, event_content,
)

# Lowercased substring matches. Extend when new verbal forms surface; the
# detector is a floor, not a ceiling.
FABRICATION_PHRASES = (
    "held steady",
    "held constant",
    "holds steady",
    "holds constant",
    "stayed constant",
    "stayed the same",
    "stays constant",
    "stays the same",
    "remained steady",
    "remained constant",
    "remains steady",
    "remains constant",
    "unchanged from",
    "unchanged across",
    "unchanged between",
    "unchanged run-to-run",
    "same across runs",
    "same across rounds",
    "same as last run",
    "same as prior run",
    "same as the last run",
    "same as the prior run",
    "same as previous run",
    "didn't change across",
    "did not change across",
    "didn't shift",
    "did not shift",
    "hasn't moved",
    "has not moved",
    "hasn't budged",
    "has held",
    "appears unchanged",
    "looks unchanged",
    "identical to the prior",
    "identical to the last",
    "locked at the same",
    "no change across",
    "consistently the same",
    "nothing changed",
)

# Presence of ANY of these markers waives the block. The agent must
# explicitly disclose the claim's epistemic status.
VERIFICATION_MARKERS = (
    "(verified)",
    "(confirmed)",
    "(checked)",
    "(read)",
    "(unverified)",
    "(not verified)",
    "(didn't check)",
    "(did not check)",
    "(haven't checked)",
    "(assumed)",
    "(assumption)",
    "(guessing)",
    "(speculating)",
)


def _last_assistant_text(events: list) -> str:
    last_asst = None
    for ev in events:
        if is_assistant(ev):
            last_asst = ev
    if last_asst is None:
        return ""
    parts = []
    for block in event_content(last_asst):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _emit_stats(verdict: str, detail: str) -> None:
    try:
        import json
        import time
        root = os.environ.get("PROJECT_ROOT")
        if not root:
            here = Path(__file__).resolve()
            for parent in [here.parent, *here.parents]:
                if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
                    root = str(parent)
                    break
        if not root:
            return
        out_path = os.path.join(root, "output", "metrics", "detector-stats.jsonl")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.time(),
                "detector": "fabrication_check",
                "verdict": verdict,
                "detail": detail,
            }) + "\n")
    except (OSError, TypeError, ValueError) as _emit_err:
        # Telemetry only — can't bubble (detector writes to stdout),
        # but narrow the type so real bugs (import errors, schema drift)
        # still propagate instead of being swallowed.
        import sys as _sys
        print(f"[fabrication_check] stats emit failed: "
              f"{type(_emit_err).__name__}: {_emit_err}", file=_sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    # Path containment: transcript_path is supplied via Claude Code's hook
    # payload, which is in principle attacker-influenced. A crafted
    # session state could point at /etc/shadow / ~/.ssh/id_rsa / etc.,
    # the detector would read it, regex-match against FABRICATION_PHRASES,
    # and log matched-phrase snippets to detector-stats.jsonl — leaking
    # secret excerpts into a metrics file. Allow only paths under either
    # ~/.claude/projects/ or $PROJECT_ROOT/tmp/.
    import os.path as _osp
    _tp_abs = _osp.abspath(sys.argv[1])
    _allowed_roots = []
    _home = os.environ.get("HOME", "")
    if _home:
        _allowed_roots.append(_osp.abspath(_osp.join(_home, ".claude", "projects")))
    _proot = os.environ.get("PROJECT_ROOT", "")
    if _proot:
        _allowed_roots.append(_osp.abspath(_osp.join(_proot, "tmp")))
    if _allowed_roots and not any(
        _tp_abs == r or _tp_abs.startswith(r + os.sep) for r in _allowed_roots
    ):
        print("ok")  # silently no-op rather than scan an unauthorized path
        return 0
    events = load_turn_events(sys.argv[1])
    # Strip code-fenced / backticked / quoted spans before phrase-
    # matching — same discipline stop_work + exhaust_check + psycho_stop
    # apply. Without this, an agent response that DESCRIBES an
    # invariance claim (regex example, quoted user prompt, code block
    # showing the antipattern) false-fires as if the agent declared it.
    from _text_strip import strip_quoted
    final_text = strip_quoted(_last_assistant_text(events)).lower()
    if not final_text:
        print("ok")
        return 0

    matched = None
    for phrase in FABRICATION_PHRASES:
        if phrase in final_text:
            matched = phrase
            break
    if matched is None:
        _emit_stats("ok", "")
        print("ok")
        return 0

    # Verification disclosure waives the block. The agent must CHOOSE to
    # claim certainty or claim ignorance — silent fabrication is what's
    # caught.
    for marker in VERIFICATION_MARKERS:
        if marker in final_text:
            _emit_stats("ok", f"disclosed: matched={matched!r}")
            print("ok")
            return 0

    _emit_stats("fabrication", f"phrase={matched!r}")
    print("fabrication")
    return 0


if __name__ == "__main__":
    sys.exit(main())
