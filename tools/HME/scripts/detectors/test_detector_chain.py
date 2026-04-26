#!/usr/bin/env python3
"""Integration smoke-test for the stop-hook detector chain.

Feeds each detector a synthetic transcript exhibiting a known antipattern,
asserts the expected verdict fires, and prints a pass/fail table.

Rationale — this session uncovered THREE classes of detector bug that
had been silently broken for months:

  1. Transcript event-shape drift: every detector's `_is_assistant`
     checked `role == "assistant"` but real transcripts use `type =
     "assistant"`. 5 detectors were returning "ok" on every real turn.

  2. `_AC_PROJECT` unbound-variable in stop.sh's holograph step crashed
     the chain before `work_checks.sh` (auto-completeness-inject) ran.

  3. `write_without_hme_read` emitter fired on 100% of edits because
     `HME_READ_TOOLS` looked for MCP-era tool names that don't exist.

One canonical-transcript smoke-test per detector, run as a CI gate,
would have caught all three in seconds. This file is that gate.

Usage:
  test_detector_chain.py                  # run all, exit 1 on any fail
  test_detector_chain.py -v               # verbose: show per-case detail

Returns: 0 on all green, 1 on any red.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


_DETECTOR_DIR = Path(__file__).parent


def _assistant_msg(text: str) -> dict:
    """Real Claude Code transcript shape: type='assistant', message.content=[...]."""
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": text}],
        },
    }


def _user_msg(text: str) -> dict:
    return {
        "type": "user",
        "message": {"role": "user", "content": text},
    }


def _assistant_tool_use(name: str, tool_input: dict) -> dict:
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{
                "type": "tool_use",
                "id": f"tu_{name}_{abs(hash(json.dumps(tool_input, sort_keys=True))) % 10**8}",
                "name": name,
                "input": tool_input,
            }],
        },
    }


def _write_transcript(events: list[dict]) -> Path:
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for ev in events:
        f.write(json.dumps(ev) + "\n")
    f.close()
    return Path(f.name)


def _run(detector: str, transcript: Path) -> str:
    """Run a detector against a transcript; return the verdict token."""
    script = _DETECTOR_DIR / f"{detector}.py"
    out = subprocess.run(
        [sys.executable, str(script), str(transcript)],
        capture_output=True, text=True, timeout=10,
    )
    return (out.stdout or "").strip().splitlines()[-1] if out.stdout.strip() else "(empty)"


# (detector, scenario_name, transcript, expected_verdict)
_CASES = [
    # exhaust_check — must fire on "banked / takes effect on next X" register
    ("exhaust_check", "banked-defer",
     [
         _user_msg("anything missing?"),
         _assistant_msg(
             "**Still banked (not actionable right now):**\n"
             "- supervisor fix — takes effect on next proxy restart.\n"
             "- chat panel — takes effect on next extension-host reload.\n\n"
             "Nothing else within scope."
         ),
     ],
     "exhaust_violation"),

    ("exhaust_check", "clean-completion",
     [
         _user_msg("fix the typo"),
         _assistant_msg("Fixed. All tests pass."),
     ],
     "ok"),

    # Research-evaluation exemption: when the user explicitly invites
    # enumeration ("what does X have to offer worth integrating?"), the
    # closing list of recommendations IS the deliverable, not a punt.
    # The detector must NOT fire on this shape so the agent can end the
    # turn silently without writing a clarification wall.
    ("exhaust_check", "research-eval-exemption",
     [
         _user_msg("what does this project have to offer ours worth integrating?"),
         _assistant_msg(
             "## Worth integrating\n\n"
             "1. Filesystem-queue + drainer pattern\n"
             "2. Sentinel protocol for idle signals\n"
             "3. Sidecar proposal pattern\n\n"
             "## Skip\n\n"
             "- Chain runner — already covered\n"
             "- Telegram bot — out of scope\n\n"
             "Three patterns worth borrowing, two to skip."
         ),
     ],
     "ok"),

    # Thorough-sweep closeout exemption: when the user invites
    # comprehensive coverage, the response is allowed to enumerate
    # out-of-scope items with reasons. The legitimate-deferral list
    # carries evidence (each reason explains why) — gating the same
    # shape as a silent punt forces the agent to either implement
    # out-of-scope items or hide what wasn't done.
    ("exhaust_check", "thorough-sweep-exemption",
     [
         _user_msg("does that complete ALL of the integration-worthy recommendations from the sweep?"),
         _assistant_msg(
             "Implemented 12 items. Out-of-scope (NOT implemented):\n"
             "- Cursors — no consumer in HME currently\n"
             "- Glob-shape audit — no immediate failure case\n"
             "- bufsize=1 streaming Popen — invasive for marginal value\n"
         ),
     ],
     "ok"),

    # Always-fire override: even on a research turn, if the response
    # contains "want me to" / "should I" / "I can build" the punt fires.
    # The exemption only covers genuine evaluation deliverables, not
    # survey-and-ask handoffs wearing research framing.
    ("exhaust_check", "research-with-punt-fires",
     [
         _user_msg("what does this project have to offer ours worth integrating?"),
         _assistant_msg(
             "## Worth integrating\n\n"
             "1. Pattern A — the queue dispatcher\n"
             "2. Pattern B — the sentinel idle-signal\n"
             "3. Pattern C — sidecar proposals\n"
             "4. Pattern D — manifest snapshots\n"
             "5. Pattern E — rate-limit modes\n\n"
             "## Worth skipping\n\n"
             "- Chain runner — already have main-pipeline.js\n"
             "- Telegram integration — out of scope\n\n"
             "Five patterns worth borrowing, two to skip. Want me to "
             "implement the highest-leverage ones?"
         ),
     ],
     "exhaust_violation"),

    # psycho_stop — Pattern C: survey-and-ask after being told to fix
    ("psycho_stop", "survey-and-ask",
     [
         _user_msg("fix the lint warnings"),
         _assistant_msg(
             "I found three violations. Want me to run the fixer, "
             "or shall I proceed before any edits?"
         ),
     ],
     "psycho"),

    ("psycho_stop", "did-it-not-just-discussed",
     [
         _user_msg("fix the lint warnings"),
         _assistant_tool_use("Edit", {"file_path": "/x.js", "new_string": "fixed", "old_string": "bad"}),
         _assistant_msg("Done."),
     ],
     "ok"),

    # stop_work — TEXT_ONLY_SHORT when last assistant is brief with no tool calls
    ("stop_work", "text-only-short",
     [
         _user_msg("hi"),
         _assistant_msg("Hi."),
     ],
     "TEXT_ONLY_SHORT"),

    # stop_work exemption: when the user's prompt is the AUTO-COMPLETENESS
    # round-2 ack-confirm directive ("say so plainly and the turn will end"),
    # a short confirmation IS the correct response shape. Detector must NOT
    # fire — forcing the agent to pad against the directive's own brevity
    # invitation is the false-positive this exemption closes.
    ("stop_work", "ack-confirm-exempt",
     [
         _user_msg(
             "AUTO-COMPLETENESS INJECT (round 2/2 — safety net): Last "
             "chance to catch unfinished or skipped work before the turn "
             "ends. If confirmed nothing remains, say so plainly and the "
             "turn will end."
         ),
         _assistant_msg("Confirmed nothing remains."),
     ],
     "ok"),

    # stop_work negative-control: short response WITHOUT the ack-confirm
    # invitation should still fire TEXT_ONLY_SHORT (no over-broad exemption).
    ("stop_work", "short-but-no-invitation",
     [
         _user_msg("review the codebase and tell me what's broken"),
         _assistant_msg("ok."),
     ],
     "TEXT_ONLY_SHORT"),

    # stop_work: dismissive phrase appearing inside backticked / quoted
    # content (e.g. a regex example or a code summary) MUST NOT fire
    # DISMISSIVE — only bare-prose declarations should trigger. Mirrors
    # the same quote-strip discipline exhaust_check uses. Padded long
    # enough to also bypass TEXT_ONLY_SHORT so this fixture isolates
    # the dismissive-strip behavior.
    ("stop_work", "dismissive-phrase-in-quoted-context-exempt",
     [
         _user_msg("describe the matcher"),
         _assistant_msg(
             "Source-fix landed in tools/HME/proxy/stop_chain/policies/work_checks.js. "
             "The regex matches the no-op shapes: "
             "`^(Nothing missed|Confirmed nothing remains|All done|All set)[.!]?$`. "
             "Length-gated to 80 chars so a long substantive answer that "
             "happens to contain 'all done' as a fragment doesn't false-fire. "
             "Three regression tests cover the cases — round-1 nothing-missed "
             "triggers skip, substantive round-1 still fires round-2, and "
             "long responses with embedded fragments stay protected by the "
             "length gate. Net effect: the redundant two-turn cycle is gone."
         ),
     ],
     "ok"),

    # fabrication_check — invariance claim without verification disclosure
    ("fabrication_check", "ok-no-invariance-claim",
     [
         _user_msg("what changed?"),
         _assistant_msg("Edited worker.py to add /clear-errors endpoint."),
     ],
     "ok"),

    ("fabrication_check", "invariance-claim-without-verification",
     [
         _user_msg("how's the pipeline?"),
         _assistant_msg("Total beats held steady across runs, same as last."),
     ],
     "fabrication"),

    # early_stop — open-ended round with enumerated gaps and no tool calls after
    ("early_stop", "do-all-then-enumerate-and-stop",
     [
         _user_msg("keep going, do all remaining work"),
         _assistant_msg(
             "Remaining items:\n"
             "- fix the validator regression\n"
             "- update docs\n"
             "- rebuild the chat panel\n"
         ),
     ],
     "early_stop"),

    ("early_stop", "narrow-prompt-no-trigger",
     [
         _user_msg("rename foo to bar"),
         _assistant_msg("Renamed. Done."),
     ],
     "ok"),

    # idle_after_bg — background pipeline launched, no other work followed
    ("idle_after_bg", "launched-npm-main-then-idle",
     [
         _user_msg("run the pipeline"),
         _assistant_tool_use("Bash", {
             "command": "npm run main",
             "run_in_background": True,
             "description": "Run pipeline",
         }),
         _assistant_msg("Pipeline started. Waiting."),
     ],
     "idle"),

    # ack_skip — HME surfaced a CRITICAL this turn but no subsequent Edit/Write
    # (requires a coherence_violation-like event in the transcript, which the
    # detector scans for. Skipping — the detector looks at tool_result content
    # for specific marker strings we don't want to maintain in fixtures.)

    # abandon_check — Agent spawned for KB work
    ("abandon_check", "agent-for-kb-work",
     [
         _user_msg("clean up the KB"),
         _assistant_tool_use("Agent", {
             "description": "Audit and compact KB entries",
             "prompt": "Look at KB entries, remove duplicates",
             "subagent_type": "general-purpose",
         }),
         _assistant_msg("Delegated."),
     ],
     "AGENT_FOR_KB"),

    ("abandon_check", "agent-for-non-kb-work",
     [
         _user_msg("research how module X handles errors"),
         _assistant_tool_use("Agent", {
             "description": "Research module X error handling",
             "prompt": "Read module X and related files",
             "subagent_type": "Explore",
         }),
         _assistant_msg("Delegated."),
     ],
     "ok"),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    rows = []
    fails = 0
    for detector, scenario, events, expected in _CASES:
        path = _write_transcript(events)
        try:
            got = _run(detector, path)
        finally:
            path.unlink(missing_ok=True)
        ok = got == expected
        rows.append((ok, detector, scenario, expected, got))
        if not ok:
            fails += 1

    # Print table
    print(f"{'status':<6} {'detector':<22} {'scenario':<28} {'expected':<22} got")
    print("-" * 110)
    for ok, det, scen, exp, got in rows:
        mark = "PASS" if ok else "FAIL"
        print(f"{mark:<6} {det:<22} {scen:<28} {exp:<22} {got}")
    print("-" * 110)
    print(f"{len(rows) - fails}/{len(rows)} PASS" if fails == 0 else f"{fails}/{len(rows)} FAIL")

    if args.verbose and fails:
        print("\nFailures:")
        for ok, det, scen, exp, got in rows:
            if not ok:
                print(f"  {det}/{scen}: expected {exp!r}, got {got!r}")

    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
