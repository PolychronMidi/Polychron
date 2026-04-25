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
    # TODO/FIXME/XXX in a SELF-REFERENTIAL position (this code says it
    # is itself unfinished). Excludes lines that DETECT or DESCRIBE
    # those tokens (regex matchers, comment patterns, audit logic).
    # Heuristic: the marker must be in a comment, not in a string
    # literal that's a regex or detection pattern.
    "TODO_FIXME": re.compile(r"\b(TODO|FIXME|XXX)\b"),
    # MVP/placeholder claims about THIS file. "placeholder" inside a
    # block-error message ("ellipsis-stub placeholder") is detection
    # not deferral; filter via context.
    "MVP_SCOPE": re.compile(r"\bMVP scope\b|\bMVP\s+(?:only|intent|scope)\b|\bfor\s+now\s+(?:we|let's|ignore|skip|trust)\b", re.IGNORECASE),
    # Self-referential unwired claims. Must NOT match when the text is
    # describing handling/blocking/detecting those concepts (e.g. a
    # `stub blocker` middleware mentions "stub" repeatedly without
    # itself being unimplemented).
    "UNWIRED": re.compile(
        r"\b(never wired|not yet wired|never connected|never built|"
        r"never implement(ed)?|currently unimplemented|"
        r"this is dead code|leaving as stub|left as a stub|"
        r"is a stub\b)",
        re.IGNORECASE,
    ),
    # Phase deferrals — only matches "Phase N" when the surrounding text
    # claims phase N is incomplete or aspirational (not when phase N is
    # being delivered or referenced as historical context).
    "PHASE_DEFERRAL": re.compile(
        r"\bPhase[- ]?\d+\.?\d*\b.*\b(later|TODO|not yet|never|aspirational|future|deferred)\b"
        r"|\b(later|future|aspirational|deferred|TODO)\b.*\bPhase[- ]?\d+\.?\d*\b",
        re.IGNORECASE,
    ),
    # Genuine deferral language.
    "DEFERRED": re.compile(
        r"\b(deferred to|left for later|come back to (this|it|that)|"
        r"will revisit|will wire (later|up later)|aspirational|"
        r"defer (this|it|until))",
        re.IGNORECASE,
    ),
    # Subjunctive-design markers — speculative future improvements.
    "SUBJUNCTIVE_DESIGN": re.compile(
        r"\b(should be wired|would be useful|could be extended|"
        r"TODO when|TODO once|TODO if|once .* lands|once .* is built)",
        re.IGNORECASE,
    ),
}

# Filter — line is NOT a real deferral if it matches one of these
# (it's describing/detecting deferral patterns, not BEING one).
DETECTION_CONTEXT = re.compile(
    r"_emit_block|grep|regex|re\.compile|re\.findall|re\.search|"
    r"_RE\s*=|_pattern\b|_re_\w+|"
    r"audit-|detector|detect_|scan_for|matches?\b|"
    r'BLOCKED:|"BLOCKED|"# .*regex|'
    r"ANTIPATTERN:|antipattern\.|"
    r"\.includes\([\"']|\.match\(|\.test\(|"
    r"# .*tokens? that\b|# .*marker|# .*phrases?",
    re.IGNORECASE,
)


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
                # Filter out lines that are DESCRIBING deferral patterns
                # (regex matchers, audit logic, block-message literals)
                # rather than admitting deferral in this file's own work.
                if DETECTION_CONTEXT.search(line):
                    continue
                # Skip lines inside obvious comment-block descriptions
                # of antipatterns, e.g. "Block stub/placeholder writes"
                if re.search(r"#\s*(Block|BLOCKED|Detect|Scan)\b", line):
                    continue
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
