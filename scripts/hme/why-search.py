#!/usr/bin/env python3
"""i/why <free-text> — Tier-2 retrieval catch-all.

Fires when the question doesn't match a known mode or invariant ID.
Performs deterministic retrieval (no LLM): grep over source for
keywords from the question, KB search via i/learn, recent activity
events, current i/state. Assembles a citation packet the agent can
read and synthesize from.

Per the design argument: retrieval should be deterministic +
LLM-augmented (not LLM-only). LLMs hallucinate citations; grep doesn't.
The agent does the synthesis from the assembled packet.
"""
from __future__ import annotations
import os
import re
import subprocess
import sys

from _common import PROJECT_ROOT


_STOPWORDS = {
    "the", "a", "an", "is", "was", "are", "be", "of", "in", "on", "at",
    "to", "for", "with", "by", "from", "this", "that", "it", "i", "we",
    "you", "what", "why", "how", "when", "where", "did", "do", "does",
    "and", "or", "but", "not", "no", "yes", "any", "some", "all",
}


def _keywords(q: str) -> list[str]:
    """Extract content words from the question."""
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", q.lower())
    return [t for t in tokens if t not in _STOPWORDS][:8]


def _grep_source(keywords: list[str]) -> list[tuple[str, int, str]]:
    """Grep each keyword across source roots. Return (file, line, snippet)
    tuples, capped per-keyword."""
    if not keywords:
        return []
    roots = [
        os.path.join(PROJECT_ROOT, "tools", "HME"),
        os.path.join(PROJECT_ROOT, "scripts"),
        os.path.join(PROJECT_ROOT, "src"),
        os.path.join(PROJECT_ROOT, "doc"),
    ]
    out = []
    for kw in keywords[:3]:  # only first 3 keywords — too many → noise
        for root in roots:
            if not os.path.isdir(root):
                continue
            try:
                rc = subprocess.run(
                    ["grep", "-rn", "--include=*.py", "--include=*.js",
                     "--include=*.sh", "--include=*.md",
                     "--exclude-dir=__pycache__", "--exclude-dir=node_modules",
                     "-w", kw, root],
                    capture_output=True, text=True, timeout=10,
                )
            except (subprocess.SubprocessError, OSError):
                continue
            for line in rc.stdout.splitlines()[:5]:
                m = re.match(r"^([^:]+):(\d+):(.*)$", line)
                if m:
                    rel = os.path.relpath(m.group(1), PROJECT_ROOT)
                    out.append((rel, int(m.group(2)), m.group(3).strip()[:100]))
            if len(out) >= 12:
                break
    return out[:12]


def _kb_hits(question: str) -> str:
    """Use i/learn query=… to surface KB matches."""
    learn = os.path.join(PROJECT_ROOT, "i", "learn")
    if not os.path.isfile(learn):
        return ""
    try:
        rc = subprocess.run(
            [learn, f"query={question}"],
            capture_output=True, text=True, timeout=15,
            cwd=PROJECT_ROOT,
        )
        return rc.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return ""


def _recent_activity() -> list[str]:
    import json
    p = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if not os.path.isfile(p):
        return []
    try:
        with open(p) as f:
            lines = f.readlines()[-15:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            e = json.loads(ln)
            ev = e.get("event", "?")
            src = e.get("source", e.get("session", ""))
            out.append(f"  {ev:30}  {src}")
        except ValueError:
            continue
    return out


def main(argv):
    question = " ".join(argv[1:]).strip()
    if not question:
        print("Usage: i/why <question>", file=sys.stderr)
        return 2

    print(f"# i/why search — '{question}'")
    print()
    print("(Tier-2 retrieval. No LLM in the loop — the citations below are")
    print("from grep, KB search, and the activity log. Synthesize from them.)")
    print()

    keywords = _keywords(question)
    if keywords:
        print(f"  keywords extracted: {', '.join(keywords[:5])}")
        print()

    grep_hits = _grep_source(keywords)
    if grep_hits:
        print(f"## Source matches ({len(grep_hits)}):")
        for path, line, snippet in grep_hits:
            print(f"  {path}:{line}  {snippet}")
        print()

    activity = _recent_activity()
    if activity:
        print(f"## Recent activity ({len(activity)} events):")
        for a in activity:
            print(a)
        print()

    kb = _kb_hits(question)
    if kb and "No knowledge entries found" not in kb:
        print(f"## KB hits:")
        for ln in kb.splitlines()[:15]:
            print(f"  {ln}")
        print()

    if not (grep_hits or kb or activity):
        print("(No deterministic retrieval matches — try rephrasing or use")
        print("i/why mode=<block|state|verifier|hci-drop|hook> for narrow questions.)")
        return 0

    print("# Next:")
    print("  Read the citations above. For deeper synthesis (subagent-backed),")
    print("  Tier-3 will land in a future session via the synthesis_reasoning path.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
