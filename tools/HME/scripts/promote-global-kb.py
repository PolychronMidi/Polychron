#!/usr/bin/env python3
"""H12: Global KB promotion — cross-project learning.

Scans the project KB (.claude/mcp/HME) for entries that look domain-independent
(antipatterns, meta-rules, process lessons) and proposes promoting them to
the global KB (~/.claude/mcp/HME/global_kb). Domain-specific entries (music
composition, Polychron-specific modules) stay in the project KB.

Heuristic for "domain-independent":
  1. Category ∈ {"antipattern", "decision", "pattern"} AND
  2. Content doesn't mention project-specific identifiers (Polychron,
     crossLayer, conductor, stutter, binaural, etc.) AND
  3. Contains process/meta keywords (always, never, rule, principle,
     workflow, antipattern, debugging, verify, regression)

Writes proposals to metrics/hme-global-kb-promotions.json. User reviews and
approves. On approval, entries are copied via the /rag endpoint to the
global store.

Usage:
    python3 tools/HME/scripts/promote-global-kb.py               # scan + propose
    python3 tools/HME/scripts/promote-global-kb.py --approve     # copy to global_kb
    python3 tools/HME/scripts/promote-global-kb.py --list-global # show global KB
"""
import json
import os
import re
import sys
import time
import urllib.request

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_OUTPUT = os.path.join(_PROJECT, "metrics", "hme-global-kb-promotions.json")
_SHIM_URL = "http://127.0.0.1:9098/rag"

# Project-specific terms — presence indicates domain-bound entry
_DOMAIN_TERMS = {
    "polychron", "crosslayer", "conductor", "stutter", "binaural",
    "rhythm", "composer", "composition", "lab/sketches", "beat",
    "coupling", "axis", "hypermeta", "phrase", "trust", "regime",
    "flicker", "tension", "density", "climax", "spbeat", "l0_channels",
    "feedbackregistry", "playProb", "signalReader", "stutterVariants",
}

# Meta/process keywords — presence supports generalizability
_META_TERMS = {
    "always", "never", "rule", "principle", "workflow", "antipattern",
    "debug", "regression", "lifesaver", "drift", "verifier", "hook",
    "refactor", "commit", "retry", "timeout", "agent", "prompt",
    "synthesis", "fallback", "guard", "subversion", "dedup", "cooldown",
    "load-bearing", "dormant",
}


def _query_kb(method: str, engine: str = "project", **kwargs) -> list:
    payload = json.dumps({
        "engine": engine,
        "method": method,
        "kwargs": kwargs,
    }).encode()
    try:
        req = urllib.request.Request(_SHIM_URL, data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return data.get("result", []) or []
    except Exception as e:
        sys.stderr.write(f"shim error: {e}\n")
        return []


def _score_generalizability(entry: dict) -> tuple:
    """Return (domain_hits, meta_hits, score) for a KB entry."""
    text = f"{entry.get('title', '')} {entry.get('content', '')}".lower()
    domain_hits = sum(1 for term in _DOMAIN_TERMS if term in text)
    meta_hits = sum(1 for term in _META_TERMS if term in text)
    # Score: high meta, low domain = generalizable
    score = meta_hits - domain_hits * 2
    return domain_hits, meta_hits, score


def scan_for_promotion() -> dict:
    # Use list_knowledge to get all entries
    entries = _query_kb("list_knowledge")
    if not entries:
        return {
            "generated_at": time.time(),
            "_warning": "could not fetch project KB (shim down?)",
            "proposals": [],
        }
    proposals = []
    for e in entries:
        cat = e.get("category", "").lower()
        if cat not in ("antipattern", "decision", "pattern", "rule"):
            continue
        domain, meta, score = _score_generalizability(e)
        if meta >= 2 and domain == 0 and score >= 2:
            proposals.append({
                "id": e.get("id", ""),
                "title": e.get("title", ""),
                "category": cat,
                "domain_hits": domain,
                "meta_hits": meta,
                "score": score,
                "content_preview": e.get("content", "")[:200],
            })
    proposals.sort(key=lambda x: -x["score"])
    return {
        "generated_at": time.time(),
        "project_kb_total": len(entries),
        "proposals": proposals[:20],  # top 20
    }


def approve_and_promote(proposals: list) -> dict:
    """Copy approved entries to global_kb via the shim."""
    copied = 0
    failed = 0
    for p in proposals:
        # Fetch the full entry
        entries = _query_kb("search_knowledge", query=p["title"], top_k=1)
        if not entries:
            failed += 1
            continue
        entry = entries[0]
        # Add to global
        try:
            _query_kb(
                "add_knowledge",
                engine="global",
                title=entry.get("title", ""),
                content=entry.get("content", ""),
                category=entry.get("category", "pattern"),
                tags=entry.get("tags", []) or [],
            )
            copied += 1
        except Exception:
            failed += 1
    return {"copied": copied, "failed": failed}


def main(argv: list) -> int:
    if "--list-global" in argv:
        entries = _query_kb("list_knowledge", engine="global")
        print(f"Global KB has {len(entries)} entries")
        for e in entries[:20]:
            print(f"  [{e.get('category', '?'):12}] {e.get('title', '')[:80]}")
        return 0

    if "--approve" in argv:
        if not os.path.isfile(_OUTPUT):
            sys.stderr.write("no proposals file — run without --approve first\n")
            return 2
        with open(_OUTPUT) as f:
            data = json.load(f)
        proposals = data.get("proposals", [])
        if not proposals:
            print("no proposals to approve")
            return 0
        print(f"Promoting {len(proposals)} entries to global_kb...")
        result = approve_and_promote(proposals)
        print(f"  copied: {result['copied']}")
        print(f"  failed: {result['failed']}")
        return 0 if result["failed"] == 0 else 1

    data = scan_for_promotion()
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Proposals written: {_OUTPUT}")
    if data.get("_warning"):
        print(f"  WARN: {data['_warning']}")
        return 2
    print(f"  project KB entries: {data.get('project_kb_total', 0)}")
    print(f"  promotion candidates: {len(data.get('proposals', []))}")
    for p in data.get("proposals", [])[:5]:
        print(f"    [{p['score']:+d}] {p['title'][:80]}")
    print()
    print("Review the proposals file, then run with --approve to promote.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
