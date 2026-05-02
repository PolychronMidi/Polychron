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
import os
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
    # Write the fixture under $PROJECT_ROOT/tmp/ rather than the system
    # temp dir. fabrication_check's path-safety guard restricts
    # transcripts to ~/.claude/projects/ or $PROJECT_ROOT/tmp/ to
    # prevent malicious paths from leaking secrets via metric writes.
    # System /tmp is excluded → fixture-based tests for that detector
    # silently no-op. Caught April 2026 during the dual-purpose audit.
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
             "- daemon watchdog — takes effect on next worker reload.\n\n"
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
             "- #5 (shellcheck): not doing this is the right call — "
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
             "right call — duplicates the existing audit. #6 is "
             "already covered by audit-python-undefined-names. The "
             "right move is to skip both — fixing them would just "
             "be pure churn."
         ),
     ],
     "ok"),

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

    # ack_skip — fires when a CRITICAL/FAIL surfaces and no Edit/Write
    # follows. Negative path: surface → no edit → ack_skip.
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

    # ack_skip — surface fires AND the agent makes an Edit afterward.
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
             "Pipeline currently running — will clear on its own. "
             "Not a real critical — background pipeline in-flight."
         ),
     ],
     "ok"),

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

    # scope_escape — must fire when the agent dismisses surfaced problems
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
             "FAIL on index — not introduced by my changes."
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

    # Clean response with no escape phrases — must not fire.
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

    # (b)-clause rescue: the deny prompt explicitly says
    # "if fixing is genuinely wrong, say so explicitly and explain why
    # fixing is the wrong move". When the agent does exactly that, the
    # detector must NOT fire — otherwise the deny offers an alternative
    # path that doesn't actually exist.
    ("scope_escape", "b-clause-rescue-not-doing-is-right",
     [
         _user_msg("review the leftover items from the suggestion list"),
         _assistant_msg(
             "Suggestion #5 was shellcheck. shellcheck would surface mostly "
             "style noise; the one severe class (SC2069 redirection-order) "
             "is already addressed and confirmed zero remaining instances. "
             "Adding shellcheck on top would be incremental at best. "
             "Not doing this is the right call — the underlying gap (no "
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
             "The fixture is intentional — the verifier test asserts "
             "precisely that the validator catches this case."
         ),
     ],
     "ok"),

    # (b)-clause rescue: "duplicates X / already covered by Y" pattern.
    ("scope_escape", "b-clause-rescue-duplicates",
     [
         _user_msg("centralize the logger imports across all files"),
         _assistant_msg(
             "The 'logger not defined' bug class — the only failure mode "
             "this rename would prevent — is pre-existing concern that's "
             "now caught by audit-python-undefined-names. Centralizing "
             "duplicates a guarantee the audit already provides. Not the "
             "right move — pure churn for zero defensive gain."
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
             "changes for this turn are clean — selftest passes, no new "
             "warnings. The pre-existing ones predate my changes."
         ),
     ],
     "scope_escape_violation"),

    # senior_consult_debt — fires when buddy-paradigm design-space files
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
    # detector must not fire — the alternative path the deny advertises
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
             "Renamed. Solo was right here — this is a mechanical "
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
                 "content": "no, keep at 90 — 10% margin needed.\n# crystallized: [decision] retire-threshold-rationale\n",
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
    # the detector — same governance rule as Edit.
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

    # MultiEdit batches several edits — if any target lands in the
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

    # BUDDY_SYSTEM.md edits without consult must trip — the doc IS the
    # paradigm's design surface, so changes there are the most
    # consult-relevant edits the detector watches for.
    ("senior_consult_debt", "doc-edit-without-consult-fires",
     [
         _user_msg("update the open-questions list"),
         _assistant_tool_use("Edit", {
             "file_path": "doc/BUDDY_SYSTEM.md",
             "old_string": "Q1",
             "new_string": "Q1 — RESOLVED",
         }),
         _assistant_msg("Updated."),
     ],
     "consult-debt"),

    # i/consult invoked via the `senior=` alias (legacy) must still
    # count as a consult — guards against the detector regressing if
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
                 "content": "ship it — # crystallized: [pattern] something useful\n",
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
    # — surfaces the satisfy-the-detector-cheaply path the quality
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

    # Consult that DID produce crystallized blocks lands as ok — the
    # quality proxy is satisfied even on a design-space edit turn.
    # ignore_and_trample: user sent a new message mid-response (system-reminder
    # embedded in a tool_result). Agent's NEXT text must open with
    # "Acknowledged <one-word> input" OR "Wrapping up this quickly first.".
    # Continuing prior work without acknowledgment = violation.
    ("ignore_and_trample", "no-interrupt-passes",
     [
         _user_msg("do the thing"),
         _assistant_tool_use("Bash", {"command": "ls"}),
         _assistant_msg("done."),
     ],
     "ok"),

    ("ignore_and_trample", "interrupt-acknowledged-passes",
     [
         _user_msg("do the thing"),
         _assistant_tool_use("Bash", {"command": "ls"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_ack_ok",
                 "content": "ok\n\n<system-reminder>\nThe user sent a new message while you were working: stop and check the logs first\n</system-reminder>",
             }]},
         },
         _assistant_msg("Acknowledged log-check input. Pivoting now."),
     ],
     "ok"),

    ("ignore_and_trample", "interrupt-wrap-up-acknowledgment-passes",
     [
         _user_msg("refactor this"),
         _assistant_tool_use("Bash", {"command": "grep foo"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_wrap_ok",
                 "content": "found 3 matches\n<system-reminder>\nThe user sent a new message while you were working: also rename bar\n</system-reminder>",
             }]},
         },
         _assistant_msg("Wrapping up this quickly first. Then I'll handle the bar rename."),
     ],
     "ok"),

    ("ignore_and_trample", "interrupt-ignored-fires",
     [
         _user_msg("refactor this"),
         _assistant_tool_use("Bash", {"command": "grep foo"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_ignored",
                 "content": "found 3 matches\n<system-reminder>\nThe user sent a new message while you were working: stop, check the logs first\n</system-reminder>",
             }]},
         },
         # Agent ignores the interrupt and keeps going on the refactor —
         # the EXACT "kept going" failure mode this detector prevents.
         _assistant_msg("Continuing the refactor. Found 3 matches; let me edit each one."),
     ],
     "ignore-and-trample"),

    ("ignore_and_trample", "interrupt-with-empty-text-fires",
     [
         # Edge case: agent's reply is just a tool_use with no leading text.
         # That's still ignoring (the user expected acknowledgment text).
         _user_msg("do work"),
         _assistant_tool_use("Bash", {"command": "echo first"}),
         {
             "type": "user",
             "message": {"role": "user", "content": [{
                 "type": "tool_result",
                 "tool_use_id": "tu_silent",
                 "content": "first\n<system-reminder>\nThe user sent a new message while you were working: STOP\n</system-reminder>",
             }]},
         },
         _assistant_tool_use("Bash", {"command": "echo second"}),
         _assistant_msg("Then continued past."),
     ],
     "ignore-and-trample"),

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
