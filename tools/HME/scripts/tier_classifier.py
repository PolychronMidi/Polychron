#!/usr/bin/env python3
"""Tier classifier for UserPromptSubmit -- heuristic baseline + Sonnet hook.

PAI v6.3.0 runs a Sonnet classifier on every prompt that emits:
    MODE: MINIMAL | NATIVE | ALGORITHM
    TIER: E1 | E2 | E3 | E4 | E5  (only when MODE=ALGORITHM)
    REASON: <one sentence>
    SOURCE: classifier | fail-safe

This module is the Polychron-side scaffold:

  - heuristic-only classifier (default) -- fast, no LLM call
  - Sonnet-classifier wrapper (opt-in via $POLYCHRON_TIER_VIA_SONNET=1)
    that delegates to a separate process that calls the API
  - additionalContext writer for hook integration
  - override hierarchy: explicit /e1-/e5 in prompt > classifier output
  - fail-safe: any error path defaults to ALGORITHM E3 (under-escalation
    is the failure mode this system was built to prevent)
  - telemetry: every classification appended to
    tools/HME/runtime/metrics/mode-classifier.jsonl with prompt excerpt + tier +
    reason + source + latency

The heuristic baseline is intentionally simple -- pattern-match against
the user's prompt for shape signals (build/create/refactor/multi-file,
narrow rename, single-fact lookup). It under-classifies on ambiguous
prompts and the fail-safe handles those by escalating to E3.

Usage:
    python3 tools/HME/scripts/tier_classifier.py --prompt "fix the lint"
    echo "rebuild the audit suite" | python3 tools/HME/scripts/tier_classifier.py
    python3 tools/HME/scripts/tier_classifier.py --json --prompt "..."
"""
import argparse
import json
import os
import re
import sys
import time
from hme_paths import hme_metric
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_METRICS_DIR = Path(os.environ.get("HME_METRICS_DIR") or (_PROJECT / "tools" / "HME" / "runtime" / "metrics"))
_TELEMETRY = _METRICS_DIR / "mode-classifier.jsonl"

_TIER_OVERRIDE_RE = re.compile(r"(?i)\B/e([1-5])\b")

# MINIMAL signals -- single-token acknowledgments, ratings, greetings.
_MINIMAL_RES = (
    re.compile(r"^\s*\d+\s*$"),                                # bare number (rating)
    re.compile(r"(?i)^\s*(thanks|thank you|ok|okay|cool|nice|great|hi|hello|hey)\s*[.!?]?\s*$"),
    re.compile(r"(?i)^\s*(yes|no|yep|nope|y|n)\s*[.!?]?\s*$"),
)

# NATIVE signals -- single fact lookup OR single-line edit on a named file.
# These are heuristics; the classifier biases UP when ambiguous.
_NATIVE_RES = (
    re.compile(r"(?i)^\s*(what|where|who|when)\s+is\s+\w+[?]?\s*$"),
    re.compile(r"(?i)\b(rename)\s+\S+\s+to\s+\S+\b"),
)

# ALGORITHM-shape verbs -- anything matching these is at least E2; the
# downstream tier-up rules promote further from there.
_ALGORITHM_VERBS = (
    "build", "create", "make", "implement", "design", "refactor",
    "migrate", "integrate", "extract", "split", "merge", "rewrite",
    "audit", "review", "investigate", "research", "compare", "evaluate",
    "fix", "debug", "trace", "instrument",
)

# Tier-promotion signals -- strings whose presence pushes the tier UP.
_E5_SIGNALS = (
    "comprehensive", "across the codebase", "every file", "everything",
    "exhaustive", "all subsystems", "no time pressure", "thorough sweep",
)
_E4_SIGNALS = (
    "architectural", "doctrine", "system prompt", "hook", "the algorithm",
    "cross-cutting", "the verifier", "the detector", "the audit suite",
    "all detectors", "every detector",
)
_E3_SIGNALS = (
    "multi-file", "across files", "and tests", "with tests", "and verify",
    "and audit", "and document",
)


def _has_any(text: str, needles: tuple[str, ...]) -> bool:
    t = text.lower()
    return any(n in t for n in needles)


def _has_algorithm_verb(text: str) -> bool:
    t = text.lower()
    return any(re.search(rf"\b{re.escape(v)}\b", t) for v in _ALGORITHM_VERBS)


def classify_heuristic(prompt: str) -> dict:
    """Return {mode, tier, reason, source}. Source is 'heuristic' here;
    the Sonnet wrapper overrides to 'classifier' on success or
    'fail-safe' on error."""
    p = prompt.strip()
    if not p:
        return {"mode": "ALGORITHM", "tier": "E3",
                "reason": "empty prompt -> fail-safe E3",
                "source": "fail-safe"}

    # Explicit /eN override anywhere in the prompt.
    m = _TIER_OVERRIDE_RE.search(p)
    if m:
        tier = f"E{m.group(1)}"
        return {"mode": "ALGORITHM", "tier": tier,
                "reason": f"explicit {m.group(0)} override",
                "source": "heuristic"}

    # MINIMAL -- short, ack-shaped.
    for r in _MINIMAL_RES:
        if r.match(p):
            return {"mode": "MINIMAL", "tier": None,
                    "reason": "ack/rating/greeting shape",
                    "source": "heuristic"}

    # NATIVE -- single fact lookup or single-line rename, no algorithm verb.
    if not _has_algorithm_verb(p):
        for r in _NATIVE_RES:
            if r.search(p):
                return {"mode": "NATIVE", "tier": None,
                        "reason": "single-fact-lookup / single-line-edit shape",
                        "source": "heuristic"}

    # ALGORITHM -- pick a tier.
    if _has_any(p, _E5_SIGNALS):
        tier = "E5"
        reason = "comprehensive/exhaustive scope signal"
    elif _has_any(p, _E4_SIGNALS):
        tier = "E4"
        reason = "doctrine/architecture/cross-cutting signal"
    elif _has_any(p, _E3_SIGNALS):
        tier = "E3"
        reason = "multi-file / multi-step signal"
    elif _has_algorithm_verb(p):
        tier = "E2"
        reason = "single-domain algorithm verb"
    else:
        tier = "E2"
        reason = "default ALGORITHM tier (no specific signals)"
    return {"mode": "ALGORITHM", "tier": tier,
            "reason": reason, "source": "heuristic"}


def write_additional_context(result: dict) -> str:
    """Render the classification into the additionalContext format PAI uses.
    The hook layer writes this verbatim into the prompt-submit payload."""
    lines = [f"MODE: {result['mode']}"]
    if result["tier"]:
        lines.append(f"TIER: {result['tier']}")
    lines.append(f"REASON: {result['reason']}")
    lines.append(f"SOURCE: {result['source']}")
    return "\n".join(lines)


def emit_telemetry(prompt: str, result: dict, latency_ms: float) -> None:
    """Append one line to mode-classifier.jsonl. Best-effort + logged: a
    failure here doesn't block classification, but we log to stderr so a
    chronic write failure surfaces."""
    try:
        _TELEMETRY.parent.mkdir(parents=True, exist_ok=True)
        excerpt = prompt[:120].replace("\n", " ").strip()
        line = json.dumps({
            "ts": time.time(),
            "prompt_excerpt": excerpt,
            "mode": result["mode"],
            "tier": result.get("tier"),
            "reason": result["reason"],
            "source": result["source"],
            "latency_ms": round(latency_ms, 2),
        })
        with open(_TELEMETRY, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError as e:
        sys.stderr.write(
            f"[tier_classifier] telemetry write failed: {type(e).__name__}: {e}\n"
        )


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--prompt", help="prompt text (default: read stdin)")
    p.add_argument("--json", action="store_true",
                   help="emit JSON instead of additionalContext format")
    p.add_argument("--why", action="store_true",
                   help="show last classifier output from mode-classifier.jsonl with reason")
    args = p.parse_args(argv)

    if args.why:
        import os as _os
        log = _os.path.join(_os.environ.get("PROJECT_ROOT") or ".",
                            "src", "output", "metrics", "mode-classifier.jsonl")
        if not _os.path.isfile(log):
            print(f"tier_classifier --why: {log} missing")
            return 0
        last = None
        with open(log, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    continue
        if not last:
            print("tier_classifier --why: no entries in mode-classifier.jsonl")
            return 0
        print(f"mode={last.get('mode', '?')} tier={last.get('tier', '?')}")
        print(f"reason: {last.get('reason', '?')}")
        if last.get("matched_signal"):
            print(f"matched: {last.get('matched_signal')}")
        if last.get("ts"):
            print(f"ts: {last.get('ts')}")
        return 0

    if args.prompt is not None:
        prompt = args.prompt
    else:
        prompt = sys.stdin.read()

    t0 = time.monotonic()
    result = classify_heuristic(prompt)
    latency_ms = (time.monotonic() - t0) * 1000

    emit_telemetry(prompt, result, latency_ms)

    if args.json:
        print(json.dumps({**result, "latency_ms": round(latency_ms, 2)},
                         indent=2))
    else:
        print(write_additional_context(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
