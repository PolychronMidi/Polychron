#!/usr/bin/env python3
"""Static audit of silent-fail patterns in tools/HME/hooks/.

Classifies each `2>/dev/null`, `|| true`, `|| echo ''`, `|| :` site by
surrounding context to identify the highest-priority audit candidates.

Categories:
  - SUSPICIOUS: result-suppression patterns where a critical operation's
    failure could go unnoticed (curl/wget without explicit logging,
    process spawns, write operations to alert channels)
  - FALLBACK_MASKING: patterns where a fallback value is supplied that
    could mask a real error (e.g. `|| echo 0` after a count operation)
  - LEGITIMATE_TOLERANT: patterns where suppression is correct behavior
    (e.g. `mkdir -p ... 2>/dev/null` -- already-exists is fine)
  - UNCLASSIFIED: needs manual review

Usage: python3 scripts/audit-silent-fails.py
Output: ranked list, suspicious + fallback-masking first.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).parent.parent
HOOKS = ROOT / "tools" / "HME" / "hooks"

# Patterns that classify a hit as legitimate-tolerant (low priority).
LEGITIMATE_PATTERNS = [
    re.compile(r"mkdir\s+-p[^|]*?2>/dev/null"),
    re.compile(r"rm\s+-f[^|]*?2>/dev/null"),
    re.compile(r"chmod[^|]*?2>/dev/null"),
    re.compile(r"\[\s*-f\s+[^\]]+\][^|]*?2>/dev/null"),  # file-existence test
    re.compile(r"date\b[^|]*?2>/dev/null"),
    # `|| echo 0` after numeric reads is usually fallback for missing file
    re.compile(r"cat\s+\"?\$\{?[A-Z_]+\}?\"?\s*2>/dev/null\s*\|\|\s*echo\s+0"),
]

# Patterns that classify a hit as suspicious (high priority).
SUSPICIOUS_PATTERNS = [
    (re.compile(r"curl\b[^|]{0,80}2>/dev/null(?!\s*\|\|\s*[A-Z_]+_record_failure)"),
     "curl with stderr suppressed and no _record_failure callback"),
    (re.compile(r"jq\b[^|]{0,80}2>/dev/null"),
     "jq error suppressed -- malformed JSON could silently produce empty result"),
    (re.compile(r">>\s*[^|]+/log/[^|]+\.log[^|]*?2>/dev/null"),
     "log-write stderr suppressed -- failure to log alerts goes silent"),
    (re.compile(r"timeout\s+\d+\s+[^|]{0,80}\|\|\s*true"),
     "timeout with || true masks both timeout AND command failure"),
    (re.compile(r"python3\b[^|]{0,80}2>/dev/null"),
     "python3 error suppressed -- crashes invisible"),
    (re.compile(r"node\b[^|]{0,80}2>/dev/null"),
     "node error suppressed -- crashes invisible"),
]

# Walk hooks/, classify each line.
hits = {"SUSPICIOUS": [], "FALLBACK_MASKING": [], "LEGITIMATE_TOLERANT": [], "UNCLASSIFIED": []}

trigger = re.compile(r"(2>/dev/null|\|\| true|\|\| :|\|\| echo )")

for sh in HOOKS.rglob("*.sh"):
    try:
        text = sh.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        continue
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not trigger.search(line):
            continue
        # Try suspicious first
        flagged = None
        for re_, reason in SUSPICIOUS_PATTERNS:
            if re_.search(line):
                flagged = ("SUSPICIOUS", reason)
                break
        if flagged is None:
            for re_ in LEGITIMATE_PATTERNS:
                if re_.search(line):
                    flagged = ("LEGITIMATE_TOLERANT", "matches legitimate-tolerant pattern")
                    break
        if flagged is None:
            # Fallback-masking: any `|| echo` after a non-mkdir/rm context
            if "|| echo" in line and "echo 0" not in line:
                flagged = ("FALLBACK_MASKING", "|| echo fallback may mask real error")
            else:
                flagged = ("UNCLASSIFIED", "needs manual review")
        cat, reason = flagged
        hits[cat].append({
            "file": str(sh.relative_to(ROOT)),
            "line": lineno,
            "snippet": line.strip()[:120],
            "reason": reason,
        })

# Report. Suspicious first, then fallback-masking, then unclassified, then legitimate.
print(f"=== AUDIT: tools/HME/hooks/ silent-fail patterns ===\n")
for cat in ["SUSPICIOUS", "FALLBACK_MASKING", "UNCLASSIFIED", "LEGITIMATE_TOLERANT"]:
    print(f"\n{cat}: {len(hits[cat])} hits")
    if cat == "LEGITIMATE_TOLERANT":
        # Don't flood -- summarize.
        files = Counter(h["file"] for h in hits[cat])
        print(f"  (summary: top 5 files by count)")
        for f, n in files.most_common(5):
            print(f"    {n:4d}  {f}")
    else:
        # Show top 20 hits by category
        for h in hits[cat][:20]:
            print(f"  {h['file']}:{h['line']}  {h['reason']}")
            print(f"    {h['snippet']}")
        if len(hits[cat]) > 20:
            print(f"  ...+{len(hits[cat]) - 20} more")

print(f"\n=== TOTALS ===")
for cat in ["SUSPICIOUS", "FALLBACK_MASKING", "UNCLASSIFIED", "LEGITIMATE_TOLERANT"]:
    print(f"  {cat}: {len(hits[cat])}")
