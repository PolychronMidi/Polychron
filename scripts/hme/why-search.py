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
    # Strip flags from positional args
    deep = False
    pos = []
    for a in argv[1:]:
        if a == "--deep" or a == "deep=true":
            deep = True
        elif a.startswith("mode="):
            continue  # mode dispatch markers don't belong in the question
        else:
            pos.append(a)
    question = " ".join(pos).strip()
    if not question:
        print("Usage: i/why <question> [--deep]", file=sys.stderr)
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

    # Tier 3 — opt-in subagent synthesis. Writes a queue entry containing
    # the packet + question; emits the [[HME_AGENT_TASK ...]] sentinel that
    # subagent_bridge.js looks for. The agent that runs i/why sees the
    # sentinel in its tool result, fires Agent(...) on its next turn, and
    # the bridge captures the result into tmp/hme-subagent-results/<id>.json.
    if deep:
        _emit_subagent_task(question, grep_hits, kb, activity)
        return 0

    print("# Next:")
    print("  Read the citations above. For subagent-backed synthesis on this")
    print("  question, re-run with --deep:")
    print(f"    i/why \"{question}\" --deep")
    return 0


def _emit_subagent_task(question, grep_hits, kb, activity):
    import json as _json
    import secrets as _secrets
    import time as _time

    queue_dir = os.path.join(PROJECT_ROOT, "tmp", "hme-subagent-queue")
    bridge_present = os.path.isfile(os.path.join(
        PROJECT_ROOT, "tools", "HME", "proxy", "middleware", "subagent_bridge.js"
    ))
    if not bridge_present:
        print()
        print("# --deep skipped: subagent_bridge.js not present at expected path.")
        print("  Tier 3 requires the proxy middleware to be active.")
        return

    os.makedirs(queue_dir, exist_ok=True)
    req_id = _secrets.token_hex(6)

    # Build the prompt: the same packet shown to the user, plus the question.
    pkt = [f"User question: {question}", "",
           "RETRIEVED EVIDENCE (deterministic grep + KB + activity):", ""]
    if grep_hits:
        pkt.append("## Source matches:")
        for path, line, snippet in grep_hits:
            pkt.append(f"  {path}:{line}  {snippet}")
        pkt.append("")
    if activity:
        pkt.append("## Recent activity:")
        pkt.extend(activity)
        pkt.append("")
    if kb and "No knowledge entries found" not in kb:
        pkt.append("## KB hits:")
        for ln in kb.splitlines()[:20]:
            pkt.append(f"  {ln}")
        pkt.append("")
    pkt.extend([
        "TASK:",
        "Synthesize a terse answer to the user's question using the cited",
        "evidence. Cite specific files/lines. If the evidence is insufficient,",
        "say so explicitly — do not invent citations. 3-6 sentences max.",
    ])

    entry = {
        "req_id": req_id,
        "prompt": "\n".join(pkt),
        "system": "",
        "max_tokens": 1024,
        "subagent_type": "general-purpose",
        "created_at": _time.time(),
    }
    queue_path = os.path.join(queue_dir, f"{req_id}.json")
    tmp = queue_path + ".tmp"
    with open(tmp, "w") as f:
        _json.dump(entry, f)
    os.replace(tmp, queue_path)

    print()
    print("# --deep: subagent task queued.")
    print(f"  req_id={req_id}  queue=tmp/hme-subagent-queue/{req_id}.json")
    print()
    print("# Sentinel for subagent_bridge.js (the agent fires Agent on next turn):")
    print(f"  [[HME_AGENT_TASK req_id={req_id} "
          f"prompt_file=tmp/hme-subagent-queue/{req_id}.json "
          f"subagent_type=general-purpose]]")
    print()
    print("# Poll result:")
    print(f"  cat tmp/hme-subagent-results/{req_id}.json   # appears once Agent completes")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
