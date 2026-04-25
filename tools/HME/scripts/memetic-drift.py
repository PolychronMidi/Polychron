#!/usr/bin/env python3
"""H16: Memetic drift detection.

Parses CLAUDE.md and extracts imperative rules (sentences starting with
"Never", "Always", "Must", etc.) and short imperatives. Then checks
log/hme-errors.log and git log for evidence that any rule has been violated
recently. Rules that are frequently violated are either too buried (need
to move up) or poorly worded (need to be rewritten).

Output: metrics/hme-memetic-drift.json — per-rule violation counts and a
recommendation to adjust document structure.

The goal is to make CLAUDE.md adapt to what agents actually read, not what
humans think agents read.

Usage:
    python3 tools/HME/scripts/memetic-drift.py
    python3 tools/HME/scripts/memetic-drift.py --suggest-reorder
"""
import json
import os
import re
import subprocess
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR") or os.path.join(_PROJECT, "output", "metrics")
_CLAUDE_MD = os.path.join(_PROJECT, "CLAUDE.md")
_OUTPUT = os.path.join(METRICS_DIR, "hme-memetic-drift.json")

# Violation signals — phrases in error log or commit messages that indicate
# a rule was broken. Each rule gets paired with one or more signal regexes.
_VIOLATION_SIGNALS = {
    "never delete unused code": [r"deleted unused", r"deleted.*dead code"],
    "never remove tmp/run.lock": [r"removed.*run\.lock", r"rm.*run\.lock"],
    "fail fast": [r"silent.*return", r"\|\|\s*0\b", r"\|\|\s*\[\]"],
    "comments terse": [r"essay comment", r"verbose jsdoc"],
    "review = read-only": [r"review.*edit", r"review.*change"],
    "auto-commit after STABLE": [r"stable.*no commit", r"evolved.*no commit"],
    "hypermeta-first": [r"hand[- ]tun", r"specialcaps"],
    "coupling matrix firewall": [r"couplingMatrix.*outside", r"direct.*coupling.*read"],
    "never abandon plan": [r"abandon.*plan", r"pivot.*mid[- ]execution"],
    "lifesaver no dilution": [r"cooldown.*critical_failure", r"register_critical.*cooldown"],
}


def _extract_rules() -> list:
    """Extract imperative lines from CLAUDE.md. Each rule gets its line
    number (for reorder suggestions) and the sentence text."""
    if not os.path.isfile(_CLAUDE_MD):
        return []
    rules = []
    try:
        with open(_CLAUDE_MD) as f:
            for i, line in enumerate(f, start=1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # Bullet items with imperative verbs
                if re.match(r"^[-*]\s+\*?\*?(Never|Always|Must|Do not|Don't|Only|Use|Prefer)", line, re.IGNORECASE):
                    # Extract rule stem (first sentence)
                    clean = re.sub(r'[*_`]', '', line).lstrip('-* ').strip()
                    stem = clean.split('.')[0][:100]
                    rules.append({"line": i, "text": stem, "full": clean[:200]})
    except Exception:
        pass
    return rules


def _violation_count() -> dict:
    """Count violation signals in error log + git log (last 200 commits)."""
    counts = {rule: 0 for rule in _VIOLATION_SIGNALS}
    # Error log
    err_log = os.path.join(_PROJECT, "log", "hme-errors.log")
    if os.path.isfile(err_log):
        try:
            with open(err_log) as f:
                text = f.read().lower()
            for rule, patterns in _VIOLATION_SIGNALS.items():
                for pat in patterns:
                    counts[rule] += len(re.findall(pat, text, re.IGNORECASE))
        except Exception:
            pass
    # Git log (commit messages)
    try:
        rc = subprocess.run(
            ["git", "-C", _PROJECT, "log", "--oneline", "-200"],
            capture_output=True, text=True, timeout=5,
        )
        git_text = rc.stdout.lower()
        for rule, patterns in _VIOLATION_SIGNALS.items():
            for pat in patterns:
                counts[rule] += len(re.findall(pat, git_text, re.IGNORECASE))
    except Exception:
        pass
    return counts


def analyze() -> dict:
    rules = _extract_rules()
    violations = _violation_count()
    most_violated = sorted(violations.items(), key=lambda x: -x[1])[:10]

    reorder_suggestions = []
    for rule_name, count in most_violated:
        if count >= 2:
            reorder_suggestions.append({
                "rule": rule_name,
                "violation_count": count,
                "recommendation": (
                    f"Rule '{rule_name}' violated {count} times in recent history. "
                    "Move it to the top of the Hard Rules section or rewrite for salience."
                ),
            })

    return {
        "generated_at": time.time(),
        "claude_md_rule_count": len(rules),
        "rules_sample": rules[:10],
        "violation_counts": violations,
        "most_violated": dict(most_violated),
        "reorder_suggestions": reorder_suggestions,
    }


def main(argv: list) -> int:
    data = analyze()
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Memetic drift report: {_OUTPUT}")
    print(f"  CLAUDE.md rules parsed: {data['claude_md_rule_count']}")
    violated = sum(1 for v in data["violation_counts"].values() if v > 0)
    print(f"  rules with violation evidence: {violated}")
    if data["reorder_suggestions"]:
        print()
        print("  Top violations:")
        for s in data["reorder_suggestions"][:5]:
            print(f"    {s['rule']}: {s['violation_count']} occurrences")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
