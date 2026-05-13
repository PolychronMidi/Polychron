#!/usr/bin/env python3
"""Integration smoke-test for the stop-hook detector chain.

Feeds each detector a synthetic transcript exhibiting a known antipattern,
asserts the expected verdict fires, and prints a pass/fail table.

Rationale -- this session uncovered THREE classes of detector bug that
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
import importlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path


_DETECTOR_DIR = Path(__file__).parent



def _registry_verdicts() -> dict[str, set[str]]:
    with open(_DETECTOR_DIR / "registry.json", encoding="utf-8") as f:
        reg = json.load(f)["detectors"]
    out: dict[str, set[str]] = {}
    for d in reg:
        if d.get("deny"):
            out.setdefault(d["module"], set()).add(d["fires_when"])
    return out


def _soft_verdicts() -> dict[str, set[str]]:
    with open(_DETECTOR_DIR / "registry.json", encoding="utf-8") as f:
        reg = json.load(f)["detectors"]
    out: dict[str, set[str]] = {}
    for d in reg:
        if not d.get("deny"):
            out.setdefault(d["module"], set()).add(d["fires_when"])
    return out


def _module_declared_verdicts(module_name: str) -> set[str]:
    mod = importlib.import_module(module_name)
    declared = getattr(mod, "DECLARED_VERDICTS", None)
    return set(declared or {"ok"})

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


def _resolve_project_root() -> str:
    """Resolve PROJECT_ROOT: env first, then walk up from this script
    looking for the CLAUDE.md+.env pair (same heuristic the detectors
    use). Returns "" only if neither path works."""
    env_root = os.environ.get("PROJECT_ROOT", "")
    if env_root:
        return env_root
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
            os.environ["PROJECT_ROOT"] = str(parent)  # propagate to subprocesses
            return str(parent)
    return ""


def _write_transcript(events: list[dict]) -> Path:
    # Fixture under $PROJECT_ROOT/tmp/ (not /tmp/) so fabrication_check's
    # path-safety guard accepts it (only ~/.claude/projects/ or PROJECT_ROOT/tmp).
    project_root = _resolve_project_root()
    if project_root:
        tmp_dir = Path(project_root) / "tmp" / "detector-test-fixtures"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        f = tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False, dir=str(tmp_dir),
        )
    else:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for ev in events:
        f.write(json.dumps(ev) + "\n")
    f.close()
    return Path(f.name)


def _run(detector: str, transcript: Path, env_overrides: dict | None = None) -> str:
    """Run a detector against a transcript; return the verdict token.

    env_overrides forwards extra env vars (e.g. ADVISOR_DOCTRINE_TIER) to
    the subprocess so tier-gated detectors can be exercised deterministically
    without depending on the persistent mode-classifier.jsonl on disk."""
    script = _DETECTOR_DIR / f"{detector}.py"
    sub_env = os.environ.copy()
    if env_overrides:
        sub_env.update(env_overrides)
    out = subprocess.run(
        [sys.executable, str(script), str(transcript)],
        capture_output=True, text=True, timeout=10, env=sub_env,
    )
    return (out.stdout or "").strip().splitlines()[-1] if out.stdout.strip() else "(empty)"


# (detector, scenario_name, transcript, expected_verdict)
_CASES = [
    # exhaust_check -- must fire on "banked / takes effect on next X" register
    ("exhaust_check", "banked-defer",
     [
         _user_msg("anything missing?"),
         _assistant_msg(
             "**Still banked (not actionable right now):**\n"
             "- supervisor fix -- takes effect on next proxy restart.\n"
             "- daemon watchdog -- takes effect on next worker reload.\n\n"
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

    # Research-evaluation exemption: enumeration IS the deliverable when
    # explicitly invited; detector must not fire on this shape.
    ("exhaust_check", "research-eval-exemption",
     [
         _user_msg("what does this project have to offer ours worth integrating?"),
         _assistant_msg(
             "## Worth integrating\n\n"
             "1. Filesystem-queue + drainer pattern\n"
             "2. Sentinel protocol for idle signals\n"
             "3. Sidecar proposal pattern\n\n"
             "## Skip\n\n"
             "- Chain runner -- already covered\n"
             "- Telegram bot -- out of scope\n\n"
             "Three patterns worth borrowing, two to skip."
         ),
     ],
     "ok"),

    # Thorough-sweep exemption: legitimate-deferral list with reasons-each
    # is allowed when user invited comprehensive coverage.
    ("exhaust_check", "thorough-sweep-exemption",
     [
         _user_msg("does that complete ALL of the integration-worthy recommendations from the sweep?"),
         _assistant_msg(
             "Implemented 12 items. Out-of-scope (NOT implemented):\n"
             "- Cursors -- no consumer in HME currently\n"
             "- Glob-shape audit -- no immediate failure case\n"
             "- bufsize=1 streaming Popen -- invasive for marginal value\n"
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
             "1. Pattern A -- the queue dispatcher\n"
             "2. Pattern B -- the sentinel idle-signal\n"
             "3. Pattern C -- sidecar proposals\n"
             "4. Pattern D -- manifest snapshots\n"
             "5. Pattern E -- rate-limit modes\n\n"
             "## Worth skipping\n\n"
             "- Chain runner -- already have main-pipeline.js\n"
             "- Telegram integration -- out of scope\n\n"
             "Five patterns worth borrowing, two to skip. Want me to "
             "implement the highest-leverage ones?"
         ),
     ],
     "exhaust_violation"),

    # Hot-reload narration after >=3 work calls is okay; remaining-work handoffs are not.
    ("exhaust_check", "substantive-work-suppresses-takes-effect",
     [
         _user_msg("apply the project-wide tweak"),
         _assistant_tool_use("Edit", {"file_path": "/a.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "/b.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Write", {"file_path": "/c.py",
                                       "content": "z"}),
         _assistant_msg("Hot-reload landed. The change takes effect on the next Stop event."),
     ],
     "ok"),

    ("exhaust_check", "substantive-work-does-not-hide-remaining-hook-bug",
     [
         _user_msg("fix the onboarding hook"),
         _assistant_tool_use("Edit", {"file_path": "/a.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "/b.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Write", {"file_path": "/c.py",
                                       "content": "z"}),
         _assistant_msg(
             "Fixed onboarding init. One remaining issue:\n"
             "- SessionStart still exits fail=1 and needs a separate fix."
         ),
     ],
     "exhaust_violation"),

    # exhaust_check (b)-clause rescue: agent enumerates remaining items
    # but each one carries an explicit refusal-with-reason. The deny
    # message family explicitly sanctions this path; detector must NOT
    # fire when the agent took the sanctioned alternative.
    ("exhaust_check", "b-clause-rescue-suppresses-enumeration",
     [
         _user_msg("address every item from the suggestion list"),
         _assistant_msg(
             "Items 1-4 implemented and tested. Items 5 and 6 explicitly "
             "skipped:\n\n"
             "- #5 (shellcheck): not doing this is the right call -- "
             "the underlying gap is already covered by the existing "
             "audit, so adding shellcheck duplicates the existing "
             "guarantee.\n"
             "- #6 (centralize logger): duplicates a guarantee the "
             "audit-python-undefined-names script already provides. "
             "Touching 157 files for a guarantee already enforced is "
             "pure churn for zero defensive gain.\n\n"
             "Final state: 4/6 implemented, 2/6 explicitly justified-refusal."
         ),
     ],
     "ok"),

    # exhaust_check ALWAYS_FIRE override still wins: even WITH (b)-clause
    # justification, "want me to" is a permission-ask that the rescue
    # must not suppress. Negative control for the rescue.
    ("exhaust_check", "b-clause-with-want-me-to-still-fires",
     [
         _user_msg("address every item"),
         _assistant_msg(
             "## Items I'm skipping for now\n\n"
             "- #5: not doing this is the right call (duplicates existing audit).\n"
             "- #6: shouldn't change this because of cross-module risk.\n\n"
             "Want me to land any of those anyway?"
         ),
     ],
     "exhaust_violation"),

    # psycho_stop pattern B (b)-clause rescue: agent uses an admit
    # phrase ("not fixed", "skipped") but with explicit reasoning. Same
    # sanctioned path as scope_escape's rescue.
    ("psycho_stop", "pattern-b-b-clause-rescue",
     [
         _user_msg("address all the leftover items"),
         _assistant_msg(
             "Items 1-4 done. Items 5-6 skipped: not doing #5 is the "
             "right call -- duplicates the existing audit. #6 is "
             "already covered by audit-python-undefined-names. The "
             "right move is to skip both -- fixing them would just "
             "be pure churn."
         ),
     ],
     "ok"),

    # phantom_capability -- declared name not in closed enumeration
    ("phantom_capability", "phantom-name",
     [
         _user_msg("do the work"),
         _assistant_msg(
             "Used [CAP] **DeepStructuredReasoning** -> THINK to handle this."
         ),
     ],
     "phantom_capability"),

    # phantom_capability -- known name passes
    ("phantom_capability", "known-passes",
     [
         _user_msg("do the work"),
         _assistant_msg(
             "Used [CAP] **FirstPrinciples** -> THINK and [CAP] **Council** -> REVIEW."
         ),
     ],
     "ok"),

    # phantom_capability -- paraphrase of a real capability
    ("phantom_capability", "paraphrase-soft-flag",
     [
         _user_msg("do the work"),
         _assistant_msg(
             "I used first-principles decomposition to break this down."
         ),
     ],
     "phantom_paraphrase"),

    # advisor_doctrine -- Rule 2 missing pre-BUILD consult at E3+. Tier is
    # forced via ADVISOR_DOCTRINE_TIER env so the fixture is deterministic
    # regardless of mode-classifier.jsonl state on disk.
    ("advisor_doctrine", "missing-pre-build-fires",
     [
         _user_msg("build the audit"),
         _assistant_msg(
             "Committing to the approach below.\n=== BUILD === 4/7"
         ),
     ],
     "advisor_missing_pre_build",
     {"ADVISOR_DOCTRINE_TIER": "E3"}),

    # advisor_doctrine -- solo-rationale rescue suppresses
    ("advisor_doctrine", "solo-rescue-suppresses",
     [
         _user_msg("rename foo to bar"),
         _assistant_msg(
             "Mechanical rename -- solo was right. === BUILD ==="
         ),
     ],
     "ok",
     {"ADVISOR_DOCTRINE_TIER": "E3"}),

    # advisor_doctrine -- tier below threshold short-circuits to ok.
    ("advisor_doctrine", "tier-below-threshold-passes",
     [
         _user_msg("tweak this constant"),
         _assistant_msg(
             "Committing to the approach below.\n=== BUILD ==="
         ),
     ],
     "ok",
     {"ADVISOR_DOCTRINE_TIER": "E1"}),

    # advisor_doctrine -- implicit-solo rescue: a turn with >= 3
    # substantive Edit/Write tool calls is implementing a decision, not
    # crystallizing one. No fresh consult required.
    ("advisor_doctrine", "implicit-solo-via-many-edits",
     [
         _user_msg("wire up the new detector across the chain"),
         _assistant_tool_use("Edit", {"file_path": "/a.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "/b.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Write", {"file_path": "/c.py",
                                       "content": "z"}),
         _assistant_msg("Wired up. All tests pass."),
     ],
     "ok",
     {"ADVISOR_DOCTRINE_TIER": "E4"}),

    # advisor_doctrine -- 2 edits is below the implicit-solo threshold;
    # the gate still fires.
    ("advisor_doctrine", "two-edits-still-fires",
     [
         _user_msg("expand the architecture and ship it"),
         _assistant_tool_use("Edit", {"file_path": "/a.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "/b.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_msg("Done."),
     ],
     "advisor_silently_skipped",
     {"ADVISOR_DOCTRINE_TIER": "E4"}),

    # advisor_doctrine -- bash-driven file mutation counts as substantive
    # work. Pattern: python -c with open() write, sed, mv, redirect.
    ("advisor_doctrine", "bash-byte-edits-implicit-solo",
     [
         _user_msg("apply a project-wide tweak"),
         _assistant_tool_use("Bash", {"command":
             "python3 -c \"import pathlib\nfor p in pathlib.Path('.').rglob('*.py'):\n    raw = open(p,'rb').read()\n    open(p,'wb').write(raw.replace(b'old', b'new'))\""}),
         _assistant_tool_use("Bash", {"command": "sed -i 's/old/new/g' file.txt"}),
         _assistant_tool_use("Bash", {"command": "mv old.py new.py"}),
         _assistant_msg("Applied across the repo."),
     ],
     "ok",
     {"ADVISOR_DOCTRINE_TIER": "E4"}),

    # summary_format -- E5 + substantive work + no closing block fires.
    ("summary_format", "missing-block-fires",
     [
         _user_msg("do the comprehensive sweep"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
         _assistant_msg(
             "Done. All audits pass; details above. Wrapping up."
         ),
     ],
     "summary_missing",
     {"SUMMARY_FORMAT_TIER": "E5"}),

    # summary_format -- E5 text-only turn does NOT fire. Nothing to
    # summarize -> doctrine doesn't apply. Resolves the cascade with
    # ceremony_dodge.
    ("summary_format", "e5-text-only-passes",
     [
         _user_msg("just confirm the architecture"),
         _assistant_msg(
             "The architecture has three layers: detection, policy, dispatch."
         ),
     ],
     "ok",
     {"SUMMARY_FORMAT_TIER": "E5"}),

    # summary_format -- E5 + substantive work + complete block passes.
    ("summary_format", "complete-block-passes",
     [
         _user_msg("do the comprehensive sweep"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
         _assistant_msg(
             "Work complete.\n\n"
             "=== SUMMARY ===\n"
             "[ITERATION]: turn 7/7\n"
             "[CONTENT]: PAI imports #6-#10 wired and verified\n"
             "[STORY]:\n"
             "- problem: PAI patterns not yet integrated into Polychron\n"
             "- what we did: added 5 hooks + detector + audit + tests\n"
             "- how it went: all audits green under --strict\n"
             "- what's next: monitor signal value over next sessions\n"
             "[VOICE] Polychron: PAI doctrine integration landed clean across hooks and detector chain."
         ),
     ],
     "ok",
     {"SUMMARY_FORMAT_TIER": "E5"}),

    # summary_format -- E5 + work + malformed block fires malformed.
    ("summary_format", "malformed-fires",
     [
         _user_msg("comprehensive work"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
         _assistant_msg(
             "Done.\n\n=== SUMMARY ===\n[ITERATION]: 1\n"
             "[STORY]:\n- problem: x\n- what we did: y\n"
             "(missing CONTENT, story bullets, voice line)"
         ),
     ],
     "summary_malformed",
     {"SUMMARY_FORMAT_TIER": "E5"}),

    # summary_format -- tier below threshold short-circuits to ok regardless.
    ("summary_format", "tier-below-passes",
     [
         _user_msg("trivial"),
         _assistant_msg("Done."),
     ],
     "ok",
     {"SUMMARY_FORMAT_TIER": "E1"}),

    # live_probe -- ISA edit + simulated unverified verdict via env
    # override (mirrors ADVISOR_DOCTRINE_TIER pattern). Real-ISA
    # parsing exercised by audit-isa.py's own tests.
    ("live_probe", "isa-with-unverified-isc-fires",
     [
         _user_msg("mark the criterion done"),
         _assistant_tool_use("Edit", {
             "file_path": "tmp/_lp_test/ISA.md",
             "old_string": "x", "new_string": "y",
         }),
     ],
     "live_probe_missing",
     {"LIVE_PROBE_FORCE": "live_probe_missing"}),
    # live_probe -- forced-ok matches the no-fire path.
    ("live_probe", "no-isa-edit-passes",
     [
         _user_msg("just edit a python file"),
         _assistant_tool_use("Edit", {
             "file_path": "some_file.py",
             "old_string": "x", "new_string": "y",
         }),
     ],
     "ok",
     {"LIVE_PROBE_FORCE": "ok"}),

    # phase_gate -- E5 + open-ended prompt + Edit without BUILD fires.
    ("phase_gate", "open-ended-edit-without-marker-fires",
     [
         _user_msg("design the new subsystem and figure out the layout"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
     ],
     "phase_skipped",
     {"PHASE_GATE_TIER": "E5"}),
    # phase_gate -- BUILD marker present allows the edit at E5.
    ("phase_gate", "build-marker-allows-edit",
     [
         _user_msg("design the new subsystem"),
         _assistant_msg("=== BUILD ===\nGoing with this approach."),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
     ],
     "ok",
     {"PHASE_GATE_TIER": "E5"}),
    # phase_gate -- specific directive IS the plan; no marker needed.
    ("phase_gate", "directive-prompt-passes",
     [
         _user_msg("rename foo to bar across the project"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "foo", "new_string": "bar"}),
     ],
     "ok",
     {"PHASE_GATE_TIER": "E5"}),
    # phase_gate -- below E5 short-circuits.
    ("phase_gate", "below-tier-passes",
     [
         _user_msg("design the new subsystem"),
         _assistant_tool_use("Edit", {"file_path": "/x.py",
                                      "old_string": "a", "new_string": "b"}),
     ],
     "ok",
     {"PHASE_GATE_TIER": "E3"}),

    # pile_on -- 2+ NEW detector writes fire; existing-detector edits are consolidation.
    ("pile_on", "two-new-detector-writes-fire",
     [
         _user_msg("add some new gates"),
         _assistant_tool_use("Write", {
             "file_path": "tools/HME/scripts/detectors/new_one.py",
             "content": "x"}),
         _assistant_tool_use("Write", {
             "file_path": "tools/HME/scripts/detectors/new_two.py",
             "content": "y"}),
     ],
     "pile_on"),
    # pile_on -- 2+ existing-detector edits do NOT fire.
    ("pile_on", "two-detector-edits-pass",
     [
         _user_msg("fix existing gates"),
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/detectors/scope_escape.py",
             "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/detectors/exhaust_check.py",
             "old_string": "x", "new_string": "y"}),
     ],
     "ok"),
    # pile_on -- 1 detector edit alone is fine.
    ("pile_on", "single-detector-edit-passes",
     [
         _user_msg("fix one detector"),
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/detectors/scope_escape.py",
             "old_string": "x", "new_string": "y"}),
     ],
     "ok"),
    # pile_on -- non-detector edits don't count.
    ("pile_on", "non-detector-edits-pass",
     [
         _user_msg("update src files"),
         _assistant_tool_use("Edit", {"file_path": "src/a.js",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "src/b.js",
                                      "old_string": "x", "new_string": "y"}),
     ],
     "ok"),

    # summary_format MINIMAL violation: long-form response in MINIMAL mode.
    ("summary_format", "minimal-long-response-fires",
     [
         _user_msg("ack"),
         _assistant_msg(
             "Line 1.\nLine 2.\nLine 3.\nLine 4.\nLine 5.\nLine 6.\nLine 7."
         ),
     ],
     "minimal_format_violation",
     {"SUMMARY_FORMAT_MODE": "MINIMAL"}),
    # summary_format MINIMAL ok: terse response.
    ("summary_format", "minimal-terse-passes",
     [
         _user_msg("ack"),
         _assistant_msg("Done."),
     ],
     "ok",
     {"SUMMARY_FORMAT_MODE": "MINIMAL"}),

    # psycho_stop -- Pattern C: survey-and-ask after being told to fix
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

    # stop_work -- TEXT_ONLY_SHORT when last assistant is brief with no tool calls
    ("stop_work", "text-only-short",
     [
         _user_msg("hi"),
         _assistant_msg("Hi."),
     ],
     "TEXT_ONLY_SHORT"),

    # stop_work exemption: AUTO-COMPLETENESS round-2 ack-confirm directive
    # accepts short confirmation; padding against brevity-invitation is FP.
    ("stop_work", "ack-confirm-exempt",
     [
         _user_msg(
             "AUTO-COMPLETENESS INJECT (round 2/2 -- safety net): Last "
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

    # stop_work: dismissive phrase inside backticks/quotes must NOT fire
    # (mirrors exhaust_check's quote-strip; padded past TEXT_ONLY_SHORT).
    ("stop_work", "dismissive-phrase-in-quoted-context-exempt",
     [
         _user_msg("describe the matcher"),
         _assistant_msg(
             "Source-fix landed in tools/HME/proxy/stop_chain/policies/work_checks.js. "
             "The regex matches the no-op shapes: "
             "`^(Nothing missed|Confirmed nothing remains|All done|All set)[.!]?$`. "
             "Length-gated to 80 chars so a long substantive answer that "
             "happens to contain 'all done' as a fragment doesn't false-fire. "
             "Three regression tests cover the cases -- round-1 nothing-missed "
             "triggers skip, substantive round-1 still fires round-2, and "
             "long responses with embedded fragments stay protected by the "
             "length gate. Net effect: the redundant two-turn cycle is gone."
         ),
     ],
     "ok"),

    # fabrication_check -- invariance claim without verification disclosure
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

    # early_stop -- open-ended round with enumerated gaps and no tool calls after
    ("early_stop", "do-all-then-enumerate-and-stop",
     [
         _user_msg("keep going, do all remaining work"),
         _assistant_msg(
             "Remaining items:\n"
             "- fix the validator regression\n"
             "- update docs\n"
             "- rebuild the worker daemon\n"
         ),
     ],
     "early_stop"),

    ("early_stop", "narrow-prompt-no-trigger",
     [
         _user_msg("rename foo to bar"),
         _assistant_msg("Renamed. Done."),
     ],
     "ok"),

    # idle_after_bg -- background pipeline launched, no other work followed
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

    # ack_skip -- fires when a CRITICAL/FAIL surfaces and no Edit/Write
    # follows. Negative path: surface -> no edit -> ack_skip.
    ("ack_skip", "critical-surfaced-no-edit-fires",
     [
         _user_msg("run the audit and follow through"),
         _assistant_tool_use("Bash", {"command": "i/status"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_audit_run",
                 "content": "LIFESAVER: CRITICAL FAILURES\n  FAIL: env-tamper\n",
             }]},
         },
         _assistant_msg("Noted the failure."),
     ],
     "ack_skip"),

    # ack_skip -- surface fires AND the agent makes an Edit afterward.
    # Detector must NOT fire (the canonical "fix it" path).
    ("ack_skip", "critical-surfaced-with-edit-passes",
     [
         _user_msg("run the audit and follow through"),
         _assistant_tool_use("Bash", {"command": "i/status"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_audit_run",
                 "content": "LIFESAVER: CRITICAL FAILURES\n  FAIL: env-tamper\n",
             }]},
         },
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/.env",
             "old_string": "STAGED=1",
             "new_string": "STAGED=0",
         }),
         _assistant_msg("Fixed."),
     ],
     "ok"),

    # ack_skip self-resolve rescue: deny prompt sanctions
    # "if the CRITICAL is from a long-running background process that
    # will resolve itself, say so EXPLICITLY in text before stopping".
    # When agent does exactly that, detector must not fire.
    ("ack_skip", "self-resolve-rescue-suppresses",
     [
         _user_msg("kick off the build and report"),
         _assistant_tool_use("Bash", {"command": "i/status"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_audit_run",
                 "content": "LIFESAVER: CRITICAL FAILURES\n  FAIL: pipeline-running\n",
             }]},
         },
         _assistant_msg(
             "The CRITICAL is from a long-running background process "
             "that will resolve itself when the build completes. "
             "Pipeline currently running -- will clear on its own. "
             "Not a real critical -- background pipeline in-flight."
         ),
     ],
     "ok"),

    # abandon_check -- Agent spawned for KB work
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

    # scope_escape -- must fire when the agent dismisses surfaced problems
    # by labeling them pre-existing / unrelated / not-introduced-here.
    # Born from a user correction: the agent ran an audit, found 4 issues,
    # said "pre-existing in unrelated files", and stopped.
    ("scope_escape", "label-and-stop",
     [
         _user_msg("add the feature and don't skip anything"),
         _assistant_msg(
             "Feature landed. Lint exit 0, tests pass. The shell-undefined-vars "
             "audit reports 4 issues but they are pre-existing and in unrelated "
             "files; my new files are clean. Selftest 23/35, 1 pre-existing "
             "FAIL on index -- not introduced by my changes."
         ),
     ],
     "scope_escape_violation"),

    # Rescue clause: agent saw the pre-existing issue AND fixed it.
    # Detector must believe the rescue and stay silent.
    ("scope_escape", "rescue-clause-suppresses",
     [
         _user_msg("land the feature"),
         _assistant_msg(
             "Feature landed. While here I noticed a pre-existing undefined-var "
             "bug in tools/HME/hooks/helpers/_resolve_bg_stub.sh and I fixed it "
             "as a bonus. All tests green."
         ),
     ],
     "ok"),

    # Clean response with no escape phrases -- must not fire.
    ("scope_escape", "clean-response",
     [
         _user_msg("finish the rotator"),
         _assistant_msg(
             "Rotator complete. All 6 unit tests pass; lint and tc both exit "
             "0. Module wired into the dispatch loop and documented."
         ),
     ],
     "ok"),

    # Backward rescue: past-tense fix-language IMMEDIATELY before the
    # escape phrase ("Fixed pre-existing X"). The forward window can't
    # see the fix word, but the backward window does.
    ("scope_escape", "backward-rescue-fixed-prefix",
     [
         _user_msg("audit and clean up"),
         _assistant_msg(
             "Audit done. Fixed pre-existing missing import in "
             "coupling_antagonism.py while here. Tests green."
         ),
     ],
     "ok"),

    # (b)-clause rescue: agent does what deny prompt explicitly allows
    # ("explain why fixing is wrong"); detector must NOT fire.
    ("scope_escape", "b-clause-rescue-not-doing-is-right",
     [
         _user_msg("review the leftover items from the suggestion list"),
         _assistant_msg(
             "Suggestion #5 was shellcheck. shellcheck would surface mostly "
             "style noise; the one severe class (SC2069 redirection-order) "
             "is already addressed and confirmed zero remaining instances. "
             "Adding shellcheck on top would be incremental at best. "
             "Not doing this is the right call -- the underlying gap (no "
             "static lint for shell) is filled by the existing audit; "
             "this would be pre-existing complexity for marginal gain."
         ),
     ],
     "ok"),

    # (b)-clause rescue: "fixing this would break / require / regress"
    # explicit-impact reasoning.
    ("scope_escape", "b-clause-rescue-fixing-would-break",
     [
         _user_msg("address every leftover"),
         _assistant_msg(
             "The remaining warning is in a pre-existing test fixture. "
             "Fixing it would require breaking the public CLI invocation "
             "of the script, which several callers depend on by name. "
             "The fixture is intentional -- the verifier test asserts "
             "precisely that the validator catches this case."
         ),
     ],
     "ok"),

    # (b)-clause rescue: "duplicates X / already covered by Y" pattern.
    ("scope_escape", "b-clause-rescue-duplicates",
     [
         _user_msg("centralize the logger imports across all files"),
         _assistant_msg(
             "The 'logger not defined' bug class -- the only failure mode "
             "this rename would prevent -- is pre-existing concern that's "
             "now caught by audit-python-undefined-names. Centralizing "
             "duplicates a guarantee the audit already provides. Not the "
             "right move -- pure churn for zero defensive gain."
         ),
     ],
     "ok"),

    # scope_escape -- substantive-work rescue. >= 3 substantive tool
    # calls bypass the gate even when closing prose mentions
    # "pre-existing"; the work itself shows the agent didn't punt.
    ("scope_escape", "substantive-work-suppresses",
     [
         _user_msg("apply project-wide fix"),
         _assistant_tool_use("Edit", {"file_path": "/a.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Edit", {"file_path": "/b.py",
                                      "old_string": "x", "new_string": "y"}),
         _assistant_tool_use("Write", {"file_path": "/c.py",
                                       "content": "z"}),
         _assistant_msg(
             "Done. The audit-import-boundaries failures shown by "
             "audit-all are pre-existing and not introduced by these "
             "changes -- they live in unrelated files. All my new "
             "files are clean."
         ),
     ],
     "ok"),

    # Negative control: a pre-existing label WITHOUT any rescue-clause
    # justification still fires. Guarantees we didn't accidentally make
    # the rescue-clause regex fire on benign nearby words.
    ("scope_escape", "no-rescue-still-fires",
     [
         _user_msg("clean up the audit findings"),
         _assistant_msg(
             "Audit-shell reports 6 issues. Those are all pre-existing in "
             "unrelated files (proxy / launcher / various hooks). My own "
             "changes for this turn are clean -- selftest passes, no new "
             "warnings. The pre-existing ones predate my changes."
         ),
     ],
     "scope_escape_violation"),

    # senior_consult_debt -- fires when buddy-paradigm design-space files
    # are edited without an i/consult invocation in the same turn.
    # Detector matches path.endswith(target), so relative paths in
    # fixtures hit the same suffix the absolute-path edits would.
    ("senior_consult_debt", "edit-without-consult-fires",
     [
         _user_msg("update the retire threshold"),
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "DEFAULT_RETIRE_PCT = 90.0",
             "new_string": "DEFAULT_RETIRE_PCT = 85.0",
         }),
         _assistant_msg("Done."),
     ],
     "consult-debt"),

    # Solo-rationale rescue: deny prompt explicitly sanctions
    # "OR explicitly note why solo was right". When the agent does that,
    # detector must not fire -- the alternative path the deny advertises
    # has to actually exist.
    ("senior_consult_debt", "solo-rationale-rescue-suppresses",
     [
         _user_msg("rename DEFAULT_RETIRE_PCT to DEFAULT_RETIRE_PERCENT"),
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "DEFAULT_RETIRE_PCT = 90.0",
             "new_string": "DEFAULT_RETIRE_PERCENT = 90.0",
         }),
         _assistant_msg(
             "Renamed. Solo was right here -- this is a mechanical "
             "rename with no design-space implications, no semantic "
             "change. Skipping the consult because there's no decision "
             "to crystallize."
         ),
     ],
     "ok"),

    ("senior_consult_debt", "edit-with-consult-passes",
     [
         _user_msg("update the retire threshold"),
         _assistant_tool_use("Bash", {
             "command": "i/consult primary=abc123 question=\"is 85 right here?\"",
         }),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_consult_quality",
                 "content": "no, keep at 90 -- 10% margin needed.\n# crystallized: [decision] retire-threshold-rationale\n",
             }]},
         },
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "DEFAULT_RETIRE_PCT = 90.0",
             "new_string": "DEFAULT_RETIRE_PCT = 85.0",
         }),
         _assistant_msg("Done."),
     ],
     "ok"),

    ("senior_consult_debt", "non-design-space-edit-passes",
     [
         _user_msg("rename a variable in unrelated file"),
         _assistant_tool_use("Edit", {
             "file_path": "src/some/unrelated.js",
             "old_string": "x",
             "new_string": "y",
         }),
         _assistant_msg("Renamed."),
     ],
     "ok"),

    # Write tool (creating a new file in the design space) must trip
    # the detector -- same governance rule as Edit.
    ("senior_consult_debt", "write-to-design-space-fires",
     [
         _user_msg("add a new spawn variant"),
         _assistant_tool_use("Write", {
             "file_path": "tools/HME/scripts/buddy_spawn.py",
             "content": "# new variant",
         }),
         _assistant_msg("Created."),
     ],
     "consult-debt"),

    # MultiEdit batches several edits -- if any target lands in the
    # design space, the detector should fire just like a single Edit.
    ("senior_consult_debt", "multiedit-design-space-fires",
     [
         _user_msg("batch refactor"),
         _assistant_tool_use("MultiEdit", {
             "file_path": "tools/HME/hooks/helpers/buddy_init.sh",
             "edits": [{"old_string": "x", "new_string": "y"}],
         }),
         _assistant_msg("Done."),
     ],
     "consult-debt"),

    # BUDDY_SYSTEM.md edits without consult must trip -- the doc IS the
    # paradigm's design surface, so changes there are the most
    # consult-relevant edits the detector watches for.
    ("senior_consult_debt", "doc-edit-without-consult-fires",
     [
         _user_msg("update the open-questions list"),
         _assistant_tool_use("Edit", {
             "file_path": "doc/BUDDY_SYSTEM.md",
             "old_string": "Q1",
             "new_string": "Q1 -- RESOLVED",
         }),
         _assistant_msg("Updated."),
     ],
     "consult-debt"),

    # i/consult invoked via the `senior=` alias (legacy) must still
    # count as a consult -- guards against the detector regressing if
    # the alias parsing in i/consult ever changes.
    ("senior_consult_debt", "consult-via-senior-alias-passes",
     [
         _user_msg("ask the buddy"),
         _assistant_tool_use("Bash", {
             "command": "i/consult senior=abc question=\"is this right?\"",
         }),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_alias_quality",
                 "content": "ship it -- # crystallized: [pattern] something useful\n",
             }]},
         },
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "x", "new_string": "y",
         }),
         _assistant_msg("Done."),
     ],
     "ok"),

    # consult-thin: consult invoked AND design-space edited, but the
    # consult produced zero `# crystallized:` markers in its tool_result
    # -- surfaces the satisfy-the-detector-cheaply path the quality
    # proxy was added to catch (Section C in 0e7fbf4d's review).
    ("senior_consult_debt", "consult-without-crystallization-is-thin",
     [
         _user_msg("update the design"),
         _assistant_tool_use("Bash", {
             "command": "i/consult primary=abc question=\"good?\"",
         }),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_thin_consult",
                 "content": "fine, ship it",
             }]},
         },
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "a", "new_string": "b",
         }),
         _assistant_msg("Done."),
     ],
     "consult-thin"),

    # ignore_and_trample detector deleted (now redundant with the request-time
    # trample_gate proxy middleware that injects ack-prefix instruction directly).

    ("senior_consult_debt", "consult-with-crystallization-is-ok",
     [
         _user_msg("review the design"),
         _assistant_tool_use("Bash", {
             "command": "i/consult primary=abc question=\"deep review please\"",
         }),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_quality_consult",
                 "content": "... # crystallized: [pattern] foo\n# crystallized: [decision] bar\n",
             }]},
         },
         _assistant_tool_use("Edit", {
             "file_path": "tools/HME/scripts/buddy_handoff.py",
             "old_string": "a", "new_string": "b",
         }),
         _assistant_msg("Done."),
     ],
     "ok"),

    # Regression: load_turn_events boundary bug. tool_result-wrapper user
    # events were mis-counted as turn boundaries -> detectors saw 1-3 events.
    ("pile_on", "boundary-with-tool-results-new-writes-fire",
     [
         _user_msg("add the chain"),
         _assistant_tool_use("Write", {
             "file_path": "tools/HME/scripts/detectors/foo.py",
             "content": "a",
         }),
         {"type": "user", "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": "tu_t1", "content": "ok"},
         ]}},
         _assistant_tool_use("Write", {
             "file_path": "tools/HME/proxy/stop_chain/policies/bar.js",
             "content": "a",
         }),
         {"type": "user", "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": "tu_t2", "content": "ok"},
         ]}},
         _assistant_msg("Done both."),
     ],
     "pile_on"),

    # Regression: psycho_stop override when prior turn claimed completion.
    # Bullet-enum-in-response-to-ideation must NOT be suppressed.
    ("psycho_stop", "ideation-after-completion-claim-fires",
     [
         _user_msg("do all 4"),
         _assistant_msg("All 4 shipped: each item complete. Proxy restarted."),
         _user_msg("any further suggestions?"),
         _assistant_msg(
             "Sure. Want me to migrate the remaining state files? "
             "Want me to extend boyscout to other audits? "
             "Pick which to start with."
         ),
     ],
     "psycho"),

]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    rows = []
    fails = 0
    registry_verdicts = _registry_verdicts()
    soft_verdicts = _soft_verdicts()
    checked_verdicts: dict[str, set[str]] = {}
    for case in _CASES:
        # 4-tuple: (det, name, events, expected). 5-tuple adds env_overrides.
        detector, scenario, events, expected, *rest = case
        env_overrides = rest[0] if rest else None
        path = _write_transcript(events)
        try:
            got = _run(detector, path, env_overrides)
        finally:
            path.unlink(missing_ok=True)
        ok = got == expected
        rows.append((ok, detector, scenario, expected, got))
        if not ok:
            fails += 1
        if expected != "ok":
            checked_verdicts.setdefault(detector, set()).add(expected)

    declared_failures = []
    for module_name, verdicts in registry_verdicts.items():
        missing = verdicts - checked_verdicts.get(module_name, set())
        if missing:
            declared_failures.append(f"{module_name}: untested deny verdicts {sorted(missing)}")
    declared_or_soft = {m: set(v) for m, v in registry_verdicts.items()}
    for module_name, verdicts in soft_verdicts.items():
        declared_or_soft.setdefault(module_name, set()).update(verdicts)
    for module_name in {d for d, *_ in _CASES}:
        emitted = _module_declared_verdicts(module_name) - {"ok"}
        undeclared = emitted - declared_or_soft.get(module_name, set())
        if undeclared:
            declared_failures.append(f"{module_name}: undeclared verdicts {sorted(undeclared)}")
    fails += len(declared_failures)

    # Print table
    print(f"{'status':<6} {'detector':<22} {'scenario':<28} {'expected':<22} got")
    print("-" * 110)
    for ok, det, scen, exp, got in rows:
        mark = "PASS" if ok else "FAIL"
        print(f"{mark:<6} {det:<22} {scen:<28} {exp:<22} {got}")
    print("-" * 110)
    for msg in declared_failures:
        print(f"FAIL   registry               verdict-coverage             expected-declared     {msg}")
    row_fails = sum(1 for ok, *_ in rows if not ok)
    total_checks = len(rows) + len(declared_failures)
    passed = len(rows) - row_fails
    print(f"{passed}/{total_checks} PASS" if fails == 0 else f"{fails}/{total_checks} FAIL")

    if args.verbose and fails:
        print("\nFailures:")
        for ok, det, scen, exp, got in rows:
            if not ok:
                print(f"  {det}/{scen}: expected {exp!r}, got {got!r}")

    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
