"""HME pattern crystallization — Phase 3.5 of openshell_features_to_mimic.md.

Scans the KB for multi-round patterns the Evolver has to rediscover each
session. The promotion rule is deliberately simple in v1:

  1. Group KB entries by overlapping tags (Jaccard ≥ 0.5 pairwise).
  2. Within each group, collect every round reference (R\\d+) found in the
     entries' content.
  3. If a group has ≥3 entries AND references ≥3 distinct rounds, it
     qualifies as a crystallized pattern.

Output: `metrics/hme-crystallized.json` — a list of crystallized patterns
with their constituent KB entry ids, shared tags, round set, and a
one-line synthesis (first non-stopword sentence from the most recent
member). Surfaced via `status(mode='crystallized')`.

Exposed via `learn(action='crystallize')` to trigger on demand and via the
POST_COMPOSITION pipeline step `build-crystallized-patterns.js` for
periodic regeneration.

v1 is rule-based (no LLM synthesis). The next version will call the local
arbiter to produce higher-quality canonical descriptions.
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from server import context as ctx
from . import _track
from hme_env import ENV

OUT_REL = os.path.join("metrics", "hme-crystallized.json")
MIN_ENTRIES = ENV.require_int("HME_CRYSTALLIZE_MIN_ENTRIES")
MIN_ROUNDS = ENV.require_int("HME_CRYSTALLIZE_MIN_ROUNDS")
# Tags that are purely metadata / status and shouldn't seed a crystallized
# pattern by themselves (they group too much unrelated stuff).
META_TAG_BLACKLIST = {
    "legendary", "stable", "evolved", "drifted", "confirmed", "refuted",
    "bugfix", "pattern", "decision", "architecture", "general", "hme_tool",
}

_ROUND_RE = re.compile(r"\bR(\d+)\b")


def _load_kb_entries() -> list[dict]:
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        return []
    try:
        db = lancedb.connect(os.path.join(ctx.PROJECT_ROOT, ".claude", "mcp", "HME"))
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception as _e:  # noqa: BLE001
        import logging as _l
        _l.getLogger("HME").debug(f"crystallizer KB read failed: {_e}")
        return []
    out: list[dict] = []
    for _, row in df.iterrows():
        tags_raw = str(row.get("tags", "") or "")
        tag_set = {t.strip() for t in tags_raw.split(",") if t.strip()}
        content = str(row.get("content", "") or "")
        rounds = {f"R{m}" for m in _ROUND_RE.findall(content)}
        # Also extract rounds from title
        rounds |= {f"R{m}" for m in _ROUND_RE.findall(str(row.get("title", "") or ""))}
        out.append({
            "id": str(row.get("id", "")),
            "title": str(row.get("title", "")),
            "content": content,
            "tags": tag_set,
            "rounds": rounds,
            "timestamp": float(row.get("timestamp", 0) or 0),
        })
    return out


def _cluster_by_tag_membership(entries: list[dict]) -> dict[str, list[int]]:
    """Group entries by each substantive tag they carry. An entry with tags
    {A, B, C} participates in three groups. Metadata tags on the blacklist
    are skipped because they span too many unrelated entries.

    Returns {tag → [entry_index, ...]}.
    """
    groups: dict[str, list[int]] = {}
    for idx, e in enumerate(entries):
        for tag in e.get("tags") or set():
            tl = tag.lower()
            if tl in META_TAG_BLACKLIST:
                continue
            # Round references (R\d+) are useful for evidence pooling but
            # shouldn't be the clustering key.
            if re.fullmatch(r"r\d+", tl):
                continue
            groups.setdefault(tag, []).append(idx)
    return groups


def _pick_synthesis(members: list[dict]) -> str:
    """One-line synthesis: first sentence of the most recent member's content."""
    if not members:
        return ""
    latest = max(members, key=lambda m: m.get("timestamp", 0))
    content = latest.get("content", "") or latest.get("title", "")
    # First sentence up to period / newline
    m = re.split(r"(?<=[.!?])\s+|\n", content.strip())
    if m and m[0]:
        return m[0][:200]
    return content[:200]


def crystallize(save: bool = True) -> dict:
    """Run the crystallization rule once. Returns the report dict and
    optionally writes it to metrics/hme-crystallized.json."""
    _track("crystallize")
    entries = _load_kb_entries()
    if not entries:
        report = {
            "meta": {
                "script": "crystallizer.py",
                "timestamp": int(time.time()),
                "kb_entries": 0,
                "patterns": 0,
                "reason": "KB empty or unreadable",
            },
            "patterns": [],
        }
        if save:
            _write(report)
        return report

    groups_by_tag = _cluster_by_tag_membership(entries)
    patterns: list[dict] = []
    seen_signatures: set[str] = set()
    for seed_tag, idx_list in groups_by_tag.items():
        if len(idx_list) < MIN_ENTRIES:
            continue
        members = [entries[i] for i in idx_list]
        # Pool rounds across all members
        pooled_rounds: set[str] = set()
        for m in members:
            pooled_rounds |= m["rounds"]
        if len(pooled_rounds) < MIN_ROUNDS:
            continue
        # Deduplicate: a cluster identical in membership to a previous one
        # (different seed tag, same entries) is already covered.
        member_sig = ",".join(sorted(m["id"] for m in members))
        if member_sig in seen_signatures:
            continue
        seen_signatures.add(member_sig)
        # Shared tags: tags that every member carries
        shared_tags: set[str] = set(members[0]["tags"])
        for m in members[1:]:
            shared_tags &= m["tags"]
        shared_tags -= META_TAG_BLACKLIST
        if not shared_tags:
            shared_tags = {seed_tag}
        patterns.append({
            "id": f"cryst_{seed_tag}_{len(members)}",
            "seed_tag": seed_tag,
            "member_ids": [m["id"] for m in members],
            "member_titles": [m["title"] for m in members][:10],
            "shared_tags": sorted(shared_tags),
            "rounds": sorted(pooled_rounds, key=lambda r: int(r[1:]) if r[1:].isdigit() else 0),
            "synthesis": _pick_synthesis(members),
            "crystallized_ts": int(time.time()),
        })
    # Sort by evidence strength: more rounds first, then more members
    patterns.sort(key=lambda p: (-len(p["rounds"]), -len(p["member_ids"])))

    report = {
        "meta": {
            "script": "crystallizer.py",
            "timestamp": int(time.time()),
            "kb_entries": len(entries),
            "patterns": len(patterns),
            "min_entries": MIN_ENTRIES,
            "min_rounds": MIN_ROUNDS,
            "meta_tag_blacklist": sorted(META_TAG_BLACKLIST),
        },
        "patterns": patterns,
    }
    if save:
        _write(report)
    return report


def _write(report: dict) -> None:
    path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")


def crystallize_cli() -> str:
    """learn(action='crystallize') entry point."""
    report = crystallize(save=True)
    n = report["meta"]["patterns"]
    if n == 0:
        return (
            "# Crystallizer\n\n"
            f"Scanned {report['meta']['kb_entries']} KB entries — no patterns "
            f"qualified (need ≥{MIN_ENTRIES} entries across ≥{MIN_ROUNDS} distinct "
            "rounds with shared tags)."
        )
    lines = [
        "# Crystallized Patterns",
        "",
        f"Promoted {n} pattern(s) from {report['meta']['kb_entries']} KB entries.",
        "",
    ]
    for p in report["patterns"][:10]:
        lines.append(f"## `{p['id']}`")
        lines.append(f"  shared tags: {', '.join(p['shared_tags']) or '(none)'}")
        lines.append(f"  rounds:      {', '.join(p['rounds'])}")
        lines.append(f"  members:     {len(p['member_ids'])}")
        lines.append(f"  synthesis:   {p['synthesis']}")
        lines.append("")
    return "\n".join(lines)


def crystallized_report() -> str:
    """status(mode='crystallized') — render the current report file."""
    _track("crystallized_report")
    path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    if not os.path.exists(path):
        return (
            "# Crystallized Patterns\n\n"
            "metrics/hme-crystallized.json not found.\n"
            "Run: `learn(action='crystallize')` or wait for next pipeline."
        )
    try:
        with open(path, encoding="utf-8") as f:
            report = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Crystallized Patterns\n\nCould not read: {type(_e).__name__}: {_e}"
    patterns = report.get("patterns") or []
    meta = report.get("meta") or {}
    if not patterns:
        return (
            "# Crystallized Patterns\n\n"
            f"None promoted yet (scanned {meta.get('kb_entries', '?')} entries).\n"
            "Add more multi-round KB entries with shared tags, then rerun."
        )
    lines = [
        "# Crystallized Patterns",
        "",
        f"{len(patterns)} multi-round pattern(s) crystallized from "
        f"{meta.get('kb_entries', '?')} KB entries",
        "",
    ]
    for p in patterns[:15]:
        lines.append(f"## `{p.get('id', '?')}`")
        lines.append(f"  shared tags: {', '.join(p.get('shared_tags') or []) or '(none)'}")
        lines.append(f"  rounds:      {', '.join(p.get('rounds') or [])}")
        lines.append(f"  members:     {len(p.get('member_ids') or [])}")
        lines.append(f"  synthesis:   {p.get('synthesis', '(none)')}")
        lines.append("")
    return "\n".join(lines)
