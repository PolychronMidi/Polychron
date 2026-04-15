#!/usr/bin/env python3
"""Phase 6.3 — living documentation drift detector.

Scope: DETECTION, not generation. Cross-references architectural claims
from the KB against the project's hand-maintained docs and surfaces
mismatches. Never rewrites docs — just flags where they've diverged
from the more-current knowledge in the KB.

Four check classes:

  1. KB module references that no longer exist in src/
  2. Module names mentioned in HME.md / ARCHITECTURE.md / CLAUDE.md
     that no longer have a matching file
  3. Hard rules in CLAUDE.md that have generated productive_incoherence
     events (rule is blocking legitimate exploration — promotion candidate)
  4. Hard rules in CLAUDE.md that have ZERO coherence_violation events
     over the last N closed rounds (rule is being consistently honored —
     constitutional promotion candidate)

Output: metrics/hme-doc-drift.json with per-doc findings + rule
refinement proposals. Surfaced via status(mode='doc_drift').

Runs as POST_COMPOSITION; non-fatal.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
DOCS = [
    "doc/ARCHITECTURE.md",
    "doc/SUBSYSTEMS.md",
    "doc/HME.md",
    "doc/TUNING_MAP.md",
    "CLAUDE.md",
]
OUT_PATH = os.path.join(PROJECT_ROOT, "metrics", "hme-doc-drift.json")
ACTIVITY_PATH = os.path.join(PROJECT_ROOT, "metrics", "hme-activity.jsonl")

_MODULE_TOKEN_RE = re.compile(r"\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]+)+)\b")
_CODE_FENCE_RE = re.compile(r"`([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]+)+)`")


def _existing_module_stems() -> set[str]:
    stems: set[str] = set()
    src = os.path.join(PROJECT_ROOT, "src")
    for root, _dirs, files in os.walk(src):
        for f in files:
            if f.endswith(".js"):
                stems.add(f[:-3])
    return stems


def _find_module_references(text: str) -> set[str]:
    """Return the set of module-name-shaped tokens that appear in the
    document's BACKTICK-FENCED spans. Bare prose mentions produce too
    many false positives (`setupHooks`, `fileSystem`, etc.) — we only
    flag intentional doc claims, which are always fenced."""
    refs: set[str] = set()
    for m in _CODE_FENCE_RE.finditer(text):
        refs.add(m.group(1))
    return refs


def _load_activity_events() -> list[dict]:
    if not os.path.exists(ACTIVITY_PATH):
        return []
    with open(ACTIVITY_PATH, encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()[-2000:]
    out: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _split_into_rounds(events: list[dict]) -> list[list[dict]]:
    rounds: list[list[dict]] = []
    current: list[dict] = []
    for ev in events:
        current.append(ev)
        if ev.get("event") == "round_complete":
            rounds.append(current)
            current = []
    if current:
        rounds.append(current)
    return rounds


def _load_kb_module_refs() -> set[str]:
    """Walk KB entries' title+tags+content, extract module-name tokens."""
    refs: set[str] = set()
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        return refs
    try:
        db = lancedb.connect(os.path.join(PROJECT_ROOT, ".claude", "mcp", "HME"))
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception:  # noqa: BLE001
        return refs
    for _, row in df.iterrows():
        blob = (
            str(row.get("title", "") or "")
            + " "
            + str(row.get("tags", "") or "")
            + " "
            + str(row.get("content", "") or "")
        )
        for m in _MODULE_TOKEN_RE.finditer(blob):
            refs.add(m.group(1))
    return refs


def _analyze_rule_usage(events: list[dict], lookback_rounds: int = 20) -> dict:
    """Per-round counts of coherence_violation and productive_incoherence
    events — the activity stream is our proxy for 'did a hard rule fire
    usefully'."""
    rounds = _split_into_rounds(events)
    closed = [r for r in rounds if r and r[-1].get("event") == "round_complete"]
    window = closed[-lookback_rounds:]
    totals = {
        "rounds_in_window": len(window),
        "coherence_violation": 0,
        "productive_incoherence": 0,
    }
    for r in window:
        for ev in r:
            e = ev.get("event")
            if e == "coherence_violation":
                totals["coherence_violation"] += 1
            elif e == "productive_incoherence":
                totals["productive_incoherence"] += 1
    return totals


def main() -> int:
    existing_stems = _existing_module_stems()
    kb_stems = _load_kb_module_refs()

    # Check 1: KB entries reference modules that no longer exist
    kb_orphans = sorted(kb_stems - existing_stems)

    # Check 2-per-doc: doc-mentioned modules that don't exist
    doc_findings: dict[str, dict] = {}
    for doc_rel in DOCS:
        doc_path = os.path.join(PROJECT_ROOT, doc_rel)
        if not os.path.exists(doc_path):
            continue
        try:
            with open(doc_path, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        mentioned = _find_module_references(text)
        orphans = sorted(mentioned - existing_stems - _BUILTINS)
        doc_findings[doc_rel] = {
            "mentioned": len(mentioned),
            "orphaned_refs": orphans[:25],
            "orphaned_count": len(orphans),
        }

    # Check 3/4: rule usage analysis from activity stream
    events = _load_activity_events()
    rule_stats = _analyze_rule_usage(events)
    rule_notes: list[dict] = []
    if rule_stats["rounds_in_window"] >= 10:
        if rule_stats["coherence_violation"] == 0:
            rule_notes.append({
                "kind": "rule_honored_consistently",
                "message": (
                    f"No coherence_violation events over the last "
                    f"{rule_stats['rounds_in_window']} closed rounds. "
                    "Hard rules in CLAUDE.md are being consistently honored. "
                    "Candidate for promotion to hme-constitution.json."
                ),
            })
        if rule_stats["productive_incoherence"] >= 5:
            rule_notes.append({
                "kind": "rule_blocking_exploration",
                "message": (
                    f"{rule_stats['productive_incoherence']} productive_incoherence "
                    "events — rules may be blocking legitimate exploration in "
                    "uncovered territory. Consider scoping refinement."
                ),
            })

    report = {
        "meta": {
            "script": "detect-doc-drift.py",
            "timestamp": int(time.time()),
            "source_modules": len(existing_stems),
            "kb_referenced_modules": len(kb_stems),
            "kb_orphans": len(kb_orphans),
        },
        "kb_orphaned_module_references": kb_orphans[:30],
        "docs": doc_findings,
        "rule_usage": rule_stats,
        "rule_notes": rule_notes,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    total_orphans = sum(d.get("orphaned_count", 0) for d in doc_findings.values())
    print(
        f"detect-doc-drift: kb_orphans={len(kb_orphans)}  "
        f"doc_orphans={total_orphans}  rule_notes={len(rule_notes)}"
    )
    return 0


# Common CamelCase tokens that look like module names but aren't — don't
# flag these as orphans.
_BUILTINS = {
    "CamelCase", "JavaScript", "TypeScript", "OpenShell", "OpenCSF", "LoRA",
    "GraphQL", "ThreadPool", "GitHub", "TypeScriptTypes", "NodeJS",
}


if __name__ == "__main__":
    sys.exit(main())
