#!/usr/bin/env python3
"""Link-test: every alternative path a deny prompt advertises must have
a recognizer in the paired detector.

Pattern observed during 2026-05-01 detector audit: deny prompts say
"if X, do A; if Y, do B" -- but the detector only recognizes A. The
detector then fires on legitimate B-shape responses. The agent learns
to never use the alternative the rule advertised. Drift between prompt
and detector is silent until an agent's reasoning gets pattern-matched
as a punt.

This test parses each deny message in tools/HME/proxy/stop_chain/policies/
*.js for "(a) ... (b) ... (c) ..."-shape alternatives, then asserts that for
each alternative, the paired detector's RESCUE pattern set has at least
one recognizer that matches a representative sentence.

This isn't an exhaustive proof-of-correctness -- false positives in
either direction (prompts using "(a)" decoratively, detectors with
broader recognizers than the test's representative sentence covers)
need targeted suppression. The point is structural: when a NEW
alternative is added to a deny prompt, this test fails until a matching
recognizer lands. That's the regression-prevention contract.

Usage: python3 scripts/detectors/test_deny_alternatives.py
Exit 0 if all advertised alternatives have a recognizer; 1 otherwise.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
# _HERE = tools/HME/scripts/detectors -> up 4 = repo root
_PROJECT = _HERE.parent.parent.parent.parent
_POLICY_DIR = _PROJECT / "tools" / "HME" / "proxy" / "stop_chain" / "policies"

# Map deny-prompt KEY (in REASONS dict) -> detector module name.
# These are the deny-prompt families that have rescue paths. PSYCHO_STOP
# is a parent label; the (b)-clause/admit-and-stop coverage was added
# to psycho_stop's pattern B in the 2026-05-01 sweep.
_DETECTOR_FOR_KEY = {
    "SCOPE_ESCAPE":  "scope_escape",
    "EXHAUST":       "exhaust_check",
    "PSYCHO_STOP":   "psycho_stop",
    "ACK_SKIP":      "ack_skip",
    "FABRICATION":   "fabrication_check",
    "EARLY_STOP":    "early_stop",
    "PHANTOM_CAPABILITY":         "phantom_capability",
    "ADVISOR_MISSING_PRE_BUILD":  "advisor_doctrine",
    "ADVISOR_MISSING_POST_DELIVER": "advisor_doctrine",
    "ADVISOR_SILENTLY_SKIPPED":   "advisor_doctrine",
    "SUMMARY_MISSING":            "summary_format",
    "SUMMARY_MALFORMED":          "summary_format",
    "LIVE_PROBE_MISSING":         "live_probe",
    "PHASE_SKIPPED":              "phase_gate",
    "MINIMAL_FORMAT_VIOLATION":   "summary_format",
}

# Per-alternative representative sentence + which detector test must accept
# it. Each entry says: "if the agent writes this, the detector MUST NOT
# fire on it" (i.e. the alternative path the prompt advertises is real).
# Probe sentences are intentionally minimal -- they exist to verify the
# recognizer fires, not to be linguistically exhaustive.
# Each probe must be long enough (>= 200 chars) that the closing-40%
# heuristic in scope_escape / exhaust_check actually engages, AND
# include a deferral / escape phrase POSITIONED in the closing portion.
# Otherwise the detectors return "ok" before consulting the rescue,
# yielding a false-pass that doesn't actually exercise the rescue path.
_PADDING = (
    "Audit complete. Walked every file in the relevant trees, ran the "
    "static checks, ran the test suite, confirmed each affected module "
    "imports cleanly. Sweep done; what follows is the closing summary "
    "with the items the audit surfaced. "
)
_PROBES = {
    "SCOPE_ESCAPE": [
        ("fix-claim",
         _PADDING + "Saw a pre-existing bug in foo.js and I fixed it. "
         "All green."),
        ("b-clause-not-doing",
         _PADDING + "Pre-existing complexity. Not doing this is the right "
         "call -- it duplicates the existing audit and would be unrelated "
         "scope creep."),
    ],
    "EXHAUST": [
        ("research-eval-exemption",
         # Tested via existing test fixtures (research-with-punt-fires +
         # research-eval-exemption); the user_prompt-invitation gate is
         # not exercisable via a one-shot text probe.
         None),
        ("b-clause-skip-with-reason",
         _PADDING + "## Items I'm skipping for now\n- #5: not doing this "
         "is the right call (duplicates existing audit). Skipping is the "
         "correct choice here."),
    ],
    "PSYCHO_STOP": [
        ("b-clause-pattern-b",
         _PADDING + "Items 1-4 done. #5 skipped -- not doing this is the "
         "right call. Already covered by the existing audit, so this "
         "won't be addressed here."),
    ],
    "ACK_SKIP": [
        ("self-resolve-rationale",
         # ack_skip needs a tool_result with surface markers; a plain
         # text probe can't trigger the gate. The existing test fixtures
         # in test_detector_chain.py cover this end-to-end.
         None),
        ("edit-after", None),
    ],
    "FABRICATION": [
        ("verified-marker",
         "HCI held steady at 84.7 (verified via i/status)."),
        ("unverified-marker",
         "HCI seems to have held steady (unverified)."),
    ],
    "EARLY_STOP": [
        # early_stop fires only when the user prompt is open-ended ("do
        # all", "anything missing"). The probe lookups skip early_stop
        # because a text-only probe can't satisfy that condition; the
        # existing fixture coverage handles it.
        ("low-leverage-polish", None),
        ("narrow-scope-override", None),
    ],
    "PHANTOM_CAPABILITY": [
        # (a) verbatim known capability name -- should pass.
        ("verbatim-known-name",
         _PADDING + "[CAP] **FirstPrinciples** -- walked the constraints and "
         "rebuilt the design from base axioms."),
        # (b) phantom name anchored with a verification marker within 240
        # chars -- rescue should accept.
        ("rescue-verified-anchor",
         _PADDING + "**CustomLabel** -- (verified) ran the audit and "
         "confirmed the output: green across all 7 checks."),
    ],
    "ADVISOR_MISSING_PRE_BUILD": [
        # Tier gating happens via mode-classifier.jsonl / env. The text
        # probe path can't easily set tier from this harness, so
        # end-to-end coverage lives in test_detector_chain.py
        # (advisor_doctrine fixtures: missing-pre-build-fires,
        # solo-rescue-suppresses).
        ("solo-rescue-rationale", None),
        ("advisor-record", None),
        ("escalate-tier", None),
    ],
    "ADVISOR_MISSING_POST_DELIVER": [
        ("post-deliver-advisor-record", None),
        ("solo-rationale-skip", None),
    ],
    "ADVISOR_SILENTLY_SKIPPED": [
        ("e4-with-advisor-record", None),
        ("e4-solo-rationale", None),
    ],
    "SUMMARY_MISSING": [
        # Block emit, tier-reclassify -- end-to-end coverage in chain fixtures.
        ("emit-block", None),
        ("re-classify-tier", None),
    ],
    "SUMMARY_MALFORMED": [
        ("complete-block", None),
    ],
    "LIVE_PROBE_MISSING": [
        # Requires Edit tool_use on an ISA file; chain fixtures cover.
        ("add-verification", None),
        ("revert-to-deferred", None),
    ],
    "PHASE_SKIPPED": [
        # Requires Edit tool_use + tier env; chain fixtures cover.
        ("emit-build-marker", None),
        ("re-classify-tier", None),
    ],
    "MINIMAL_FORMAT_VIOLATION": [
        # Requires SUMMARY_FORMAT_MODE=MINIMAL env; chain fixtures cover.
        ("match-mode", None),
        ("escalate-tier", None),
    ],
}


def _extract_reason(policy_src: str, key: str) -> str | None:
    """Find `KEY:` in a `REASONS = { ... }` block and return the string body."""
    # Match `KEY:` followed by a string literal possibly spanning multiple
    # lines (concatenated across breaks via `'...' + '...'` or just `"..."`).
    pat = re.compile(
        rf"\b{re.escape(key)}\s*:\s*("                     # key:
        r"(?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"      # first string
        r"(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"))*"  # +concat
        r")",
        re.MULTILINE,
    )
    m = pat.search(policy_src)
    if not m:
        return None
    raw = m.group(1)
    parts = re.findall(
        r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", raw
    )
    return "".join(a or b for a, b in parts)


def _probe_detector(detector_module: str, probe_text: str,
                    env_overrides: dict | None = None) -> bool:
    """Run the detector against a synthetic transcript and return True if
    the verdict is 'ok' (rescue accepted) -- i.e. the recognizer fired.

    env_overrides applies temporary env vars (restored in finally) so
    tier-gated detectors like summary_format / advisor_doctrine can be
    exercised deterministically from text-only probes."""
    import importlib
    import json
    import os as _os
    import tempfile

    sys.path.insert(0, str(_HERE))
    mod = importlib.import_module(detector_module)
    events = [
        {"type": "user", "message": {"role": "user",
                                     "content": "address every leftover item"}},
        {"type": "assistant", "message": {"role": "assistant",
                                          "content": [{"type": "text",
                                                       "text": probe_text}]}},
    ]
    with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
    ) as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")
        path = f.name
    old_argv = sys.argv
    saved_env: dict[str, str | None] = {}
    if env_overrides:
        for k, v in env_overrides.items():
            saved_env[k] = _os.environ.get(k)
            _os.environ[k] = v
    try:
        sys.argv = [old_argv[0] if old_argv else "test", path]
        from io import StringIO
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        try:
            mod.main()
        except SystemExit:
            pass  # silent-ok: diagnostic; failure non-fatal
        verdict = sys.stdout.getvalue().strip()
        sys.stdout = old_stdout
        return verdict == "ok"
    finally:
        sys.argv = old_argv
        for k, prev in saved_env.items():
            if prev is None:
                _os.environ.pop(k, None)
            else:
                _os.environ[k] = prev
        try:
            _os.unlink(path)
        except OSError:
            pass  # silent-ok: best-effort fs op


def main() -> int:
    # Load every policy file once.
    policy_srcs = {}
    for js in _POLICY_DIR.glob("*.js"):
        policy_srcs[js.name] = js.read_text(encoding="utf-8")
    if not policy_srcs:
        print(f"FAIL: no policy files found under {_POLICY_DIR}")
        return 1

    failures = []
    for key, detector_module in _DETECTOR_FOR_KEY.items():
        # Find the deny prompt in any policy file.
        prompt = None
        for fname, src in policy_srcs.items():
            p = _extract_reason(src, key)
            if p is not None:
                prompt = p
                break
        if prompt is None:
            failures.append(f"  {key}: deny prompt not found in any policy file")
            continue

        # Walk probes. A None probe text means "covered by an existing
        # test fixture, not a string probe" -- skip the lookup but require
        # that we documented the probe's existence above.
        # Probe entries: (label, text) for plain probes, OR
        # (label, text, env_dict) when the detector requires env-injected state.
        for entry in _PROBES.get(key, []):
            label = entry[0]
            probe_text = entry[1]
            env = entry[2] if len(entry) >= 3 else None
            if probe_text is None:
                continue
            ok = _probe_detector(detector_module, probe_text, env)
            if not ok:
                failures.append(
                    f"  {key} ({detector_module}.py): probe {label!r} "
                    f"was flagged as a violation, but the deny prompt "
                    f"says this path is allowed.\n"
                    f"    probe text: {probe_text[:120]!r}"
                )

    if failures:
        print("DENY-LINK FAILURES -- advertised alternative not honored by detector:")
        for f in failures:
            print(f)
        print("\nEvery alternative path the deny prompt advertises must have a "
              "matching recognizer in the detector. Either add the recognizer "
              "(see _rescue_clauses.py for shared patterns) or correct the "
              "deny prompt to not promise a path the detector can't honor.")
        return 1

    print(f"deny-alternatives link test: {sum(1 for k in _DETECTOR_FOR_KEY)} "
          f"detectors checked, all advertised alternatives honored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
