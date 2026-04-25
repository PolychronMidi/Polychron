#!/usr/bin/env python3
"""Audit human-side deferral patterns symmetric to the agent-policing
detector chain.

Pattern surfaced by peer-review iter 145: HME has nine detectors for
agent failure modes (psycho_stop, exhaust_check, abandon_check,
fabrication_check, ack_skip, idle_after_bg, stop_work, early_stop,
poll_count) and zero detectors for the human-side parallel patterns —
unwired remediation arms documented as load-bearing, MVP-scope
admissions left in production for months, "Phase N" deferrals where
phase N never arrived. Same cognitive pattern, scored only on one side.

This audit makes the asymmetry visible. Counts and lists:

  - TODO / FIXME / XXX markers
  - "MVP scope" / "MVP" / "for now" / "placeholder" admissions
  - "never wired" / "not yet wired" / "never connected" / "stub" / "dead code"
  - "Phase N" mentions (unfinished phase markers)
  - "deferred to" / "left for later" / "follow-up"
  - "should be" / "would be" / "could be" (subjunctive design statements
    that often mark unbuilt features)

Output: count + sample lines per category, advisory only — does not
gate. The point is making the human-side deferral surface visible
the way the agent-side one already is, not blocking commits.

Wire as `HumanDeferredAuditVerifier` in verify_coherence with weight
0.5 (advisory). The signal is "is this number trending up or down?",
not "fail at any threshold."
"""
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
SCAN_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts" / "hme",
    PROJECT_ROOT / "scripts" / "detectors",
    PROJECT_ROOT / "src",
    PROJECT_ROOT / "doc",
]
SKIP = ("__pycache__", "node_modules", ".git", "out", "dist", ".lance")
SCAN_EXTS = (".py", ".js", ".ts", ".sh", ".bash", ".md")

CATEGORIES = {
    "TODO_FIXME": re.compile(r"\b(TODO|FIXME|XXX)\b"),
    "MVP_SCOPE": re.compile(r"\b(MVP scope|MVP\b|for now\b|placeholder)", re.IGNORECASE),
    "UNWIRED": re.compile(
        r"\b(never wired|not yet wired|never connected|never built|"
        r"never implement|dead code|stub\b|unimplemented)",
        re.IGNORECASE,
    ),
    "PHASE_DEFERRAL": re.compile(r"\bPhase[- ]?\d+\.?\d*\b"),
    "DEFERRED": re.compile(
        r"\b(deferred to|left for later|follow-up\b|followup\b|come back to|"
        r"will revisit|will wire|aspirational)",
        re.IGNORECASE,
    ),
    "SUBJUNCTIVE_DESIGN": re.compile(
        r"\b(should be wired|would be useful|could be extended|"
        r"future-self|future maintainer|TODO when)",
        re.IGNORECASE,
    ),
}


def main() -> int:
    counts: dict[str, int] = {k: 0 for k in CATEGORIES}
    samples: dict[str, list[str]] = {k: [] for k in CATEGORIES}
    files_scanned = 0
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or any(s in str(p) for s in SKIP):
                continue
            if p.suffix not in SCAN_EXTS:
                continue
            files_scanned += 1
            try:
                lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                continue
            for ln, line in enumerate(lines, 1):
                for cat, regex in CATEGORIES.items():
                    if regex.search(line):
                        counts[cat] += 1
                        if len(samples[cat]) < 8:
                            rel = str(p.relative_to(PROJECT_ROOT))
                            samples[cat].append(f"{rel}:{ln} — {line.strip()[:120]}")

    total = sum(counts.values())
    print(f"audit-human-deferred: scanned {files_scanned} files; "
          f"{total} deferral marker(s) across {sum(1 for c in counts.values() if c > 0)} categories")
    print()
    for cat in sorted(CATEGORIES, key=lambda k: -counts[k]):
        n = counts[cat]
        if n == 0:
            continue
        print(f"  [{n:>4}] {cat}")
        for s in samples[cat][:3]:
            print(f"         {s}")
    print()
    print("Advisory only — these are the human-side parallel of the "
          "agent-policing detectors. Goal is monotonic decrease over time, "
          "not zero. New entries should ideally come with a deadline or "
          "tracking issue. Compare across runs to see if deferral debt is "
          "accumulating or shrinking.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
