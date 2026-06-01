#!/usr/bin/env python3
"""Algorithm 7-phase tracking + invariant gate (PAI v6.3.0 Algorithm).

PAI's universal execution loop has 7 phases:
  OBSERVE -> THINK -> PLAN -> BUILD -> EXECUTE -> VERIFY -> LEARN

Each phase has a different posture. The hard invariant we enforce
here: NO Edit/Write/MultiEdit before the agent has explicitly entered
the BUILD or EXECUTE phase. Pre-BUILD edits are the "skipped PLAN"
antipattern -- the agent jumps to coding without articulating the
approach, then the design has to be reverse-engineered from diffs.

Phase tracking:
  - The agent declares phase transitions via ASCII markers in text:
      OBSERVE | phase: observe
      THINK   | phase: think
      PLAN    | phase: plan
      BUILD   | phase: build
      EXECUTE | phase: execute
      VERIFY  | phase: verify
      LEARN   | phase: learn
  - Each transition is appended to src/output/metrics/phase_transitions.jsonl
    for cross-session timeline analysis.
  - The detector reads ALL events (current turn) and finds the phase
    most recently declared. If no phase was declared and Edit/Write
    happened, that's a violation (jumping to BUILD without phasing).

Verdicts:
  ok              tier < E3, no edits this turn, OR edits happened
                  inside an explicit BUILD/EXECUTE phase
  phase_skipped   E3+ tier with Edit/Write/MultiEdit but no preceding
                  BUILD or EXECUTE phase marker

The detector ONLY fires at tier E3+ (Algorithm work). Lower tiers can
edit freely without phase ceremony.

Usage: phase_gate.py <transcript_path>
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import _parse_all, event_content, iter_tool_uses, is_user  # noqa: E402

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_METRICS_DIR = Path(os.environ.get("HME_METRICS_DIR") or (_PROJECT / "tools" / "HME" / "runtime" / "metrics"))
_MODE_LOG = _METRICS_DIR / "mode-classifier.jsonl"
_PHASE_LOG = _METRICS_DIR / "phase_transitions.jsonl"

_PHASES = ("OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN")

# Phase-marker regexes. Match either <PHASE> banner or `phase: <p>`.
_PHASE_RE = re.compile(
    r"(?:^\s*(?:={3,}\s*)?(OBSERVE|THINK|PLAN|BUILD|EXECUTE|VERIFY|LEARN)(?:\s*={3,})?\s*$|"
    r"\bphase\s*:\s*(observe|think|plan|build|execute|verify|learn)\b)",
    re.IGNORECASE | re.MULTILINE,
)

_BUILD_OR_EXECUTE = {"BUILD", "EXECUTE"}
_EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
# E5 only -- E3 (multi-file) and E4 (deep) are too routine to demand the
_TRIGGER_TIERS = {"E5"}

# Open-ended prompt markers. A specific directive ("fix the broken refs",
_OPEN_ENDED_RES = (
    re.compile(r"\b(do all|anything missing|what.?s missing|push further|"
               r"keep going|next steps|design (the|a)|what should|"
               r"how should|figure out|investigate)\b", re.IGNORECASE),
)


def _read_tier() -> str | None:
    if os.environ.get("PHASE_GATE_TIER"):
        return os.environ["PHASE_GATE_TIER"]
    if not _MODE_LOG.is_file():
        return None
    try:
        last = None
        with open(_MODE_LOG, encoding="utf-8") as f:
            for line in f:
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    continue
        if not last:
            return None
        ts = last.get("ts")
        max_age = float(os.environ.get("PHASE_GATE_TIER_MAX_AGE_SECS", "3600"))
        if isinstance(ts, (int, float)) and (time.time() - ts) > max_age:
            return None
        return last.get("tier")
    except OSError:
        return None


def _load_current_turn(events: list) -> list:
    """Slice from the last REAL user prompt onward."""
    last_real_user_idx = -1
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if isinstance(content, str):
            last_real_user_idx = i
    if last_real_user_idx == -1:
        return events
    return events[last_real_user_idx:]


def _phase_transitions_in_order(events: list) -> list[str]:
    """Walk the turn's assistant text events in chronological order and
    return the sequence of declared phases (uppercased)."""
    out: list[str] = []
    for ev in events:
        if ev.get("type") != "assistant" and ev.get("role") != "assistant":
            continue
        for block in event_content(ev):
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            t = block.get("text", "")
            if not isinstance(t, str):
                continue
            for m in _PHASE_RE.finditer(t):
                phase = (m.group(1) or m.group(2) or "").upper()
                if phase in _PHASES:
                    out.append(phase)
    return out


def _edits_before_build_phase(events: list) -> bool:
    """True if Edit/Write/MultiEdit/NotebookEdit happened in this turn
    and no BUILD or EXECUTE phase was declared at any point. We don't
    enforce strict ordering of the 7 phases (PAI doesn't either) -- just
    that some BUILD/EXECUTE marker exists if edits happen."""
    has_edit = False
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") in _EDIT_TOOLS:
                has_edit = True
                break
        if has_edit:
            break
    if not has_edit:
        return False
    phases = set(_phase_transitions_in_order(events))
    return not (phases & _BUILD_OR_EXECUTE)


# Stop-hook deny payloads come through the transcript as user-shaped
_DENY_PAYLOAD_MARKERS = (
    "Stop hook feedback:",
    "Stop hook blocking error from command:",
    "AUTO-COMPLETENESS INJECT",
    "PreToolUse:",
    "PostToolUse:",
)


def _user_prompt_is_open_ended(events: list) -> bool:
    """Inspect the most recent REAL user prompt (skipping hook-injected
    payloads). Specific directives don't need a separate PLAN phase --
    the directive IS the plan."""
    last_text = ""
    for ev in events:
        if not is_user(ev):
            continue
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        text = ""
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    t = block.get("text", "")
                    if isinstance(t, str):
                        text = t
        if not text:
            continue
        if any(m in text for m in _DENY_PAYLOAD_MARKERS):
            continue  # hook-injected, not a real user prompt
        last_text = text
    if not last_text:
        return False
    return any(pat.search(last_text) for pat in _OPEN_ENDED_RES)


def _append_transitions(phases: list[str]) -> None:
    """Append observed phase transitions to the JSONL log. Best-effort."""
    if not phases:
        return
    try:
        _PHASE_LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(_PHASE_LOG, "a", encoding="utf-8") as f:
            for phase in phases:
                f.write(json.dumps({"ts": ts, "phase": phase}) + "\n")
    except OSError:
        pass  # silent-ok: best-effort fs op


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0

    tier = _read_tier()
    if tier not in _TRIGGER_TIERS:
        print("ok")
        return 0

    events = _load_current_turn(_parse_all(sys.argv[1]))
    phases = _phase_transitions_in_order(events)

    # Best-effort telemetry for cross-session phase analysis.
    _append_transitions(phases)

    # Only fire on genuinely open-ended prompts where PLAN articulation
    if _edits_before_build_phase(events) and _user_prompt_is_open_ended(events):
        print("phase_skipped")
        return 0

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
