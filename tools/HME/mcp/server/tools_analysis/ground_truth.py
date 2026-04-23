"""HME human ground truth — Phase 5.5 of openshell_features_to_mimic.md.

Everything in HME ultimately grounds out in its own outputs — a circular
self-model that can drift into self-consistent but musically empty
equilibrium. The one signal that isn't automated is a human listener
finding the composition genuinely moving. This module makes that signal
a first-class HME input.

Interface: `learn(action='ground_truth', ...)` accepts a structured
feedback record from a human listener:

  section          which section the feedback applies to (S0..S6, or 'all')
  moment_type      convergence | divergence | climax | breath | misfire | ...
  sentiment        compelling | flat | surprising | mechanical | empty
  comment          free-form natural-language note
  round_tag        which round this was assessed against (R...)

Stored in two places:
  1. `metrics/hme-ground-truth.jsonl` — append-only stream for history
  2. The KB, via learn() with tag `human_ground_truth` and category
     `decision` — queryable via normal KB search

Ground-truth KB entries always inherit trust tier HIGH regardless of the
normal trust weight formula. When an HME prediction conflicts with a
ground-truth entry, the ground-truth wins and the conflict is surfaced.

Read via `status(mode='ground_truth')`.
"""
from __future__ import annotations

import json
import os
import time

from server import context as ctx
from . import _track

GROUND_TRUTH_LOG_REL = os.path.join("output", "metrics", "hme-ground-truth.jsonl")
OUT_REL = os.path.join("output", "metrics", "hme-ground-truth-index.json")

VALID_SENTIMENTS = {
    "compelling", "surprising", "moving", "mechanical", "flat",
    "empty", "confusing", "over-referenced", "resolved",
    "unfinished",
}
VALID_MOMENT_TYPES = {
    "convergence", "divergence", "climax", "breath", "cadence",
    "arrival", "misfire", "sustain", "release", "transition",
}


def record_ground_truth(
    section: str,
    moment_type: str,
    sentiment: str,
    comment: str,
    round_tag: str = "",
) -> str:
    """Record a structured human feedback entry and write it into the KB
    with an unconditional high-trust flag."""
    _track("ground_truth_record")
    section_n = (section or "").strip()
    moment_n = (moment_type or "").strip().lower()
    sentiment_n = (sentiment or "").strip().lower()
    if not section_n:
        return "Error: section is required (e.g. S3, or 'all')."
    if not moment_n:
        return (
            f"Error: moment_type is required. Suggested: {sorted(VALID_MOMENT_TYPES)}."
        )
    if not sentiment_n:
        return (
            f"Error: sentiment is required. Suggested: {sorted(VALID_SENTIMENTS)}."
        )
    if moment_n not in VALID_MOMENT_TYPES:
        # Don't reject — just flag non-canonical types
        pass
    if sentiment_n not in VALID_SENTIMENTS:
        pass

    ts = int(time.time())
    record = {
        "ts": ts,
        "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "section": section_n,
        "moment_type": moment_n,
        "sentiment": sentiment_n,
        "comment": comment or "",
        "round_tag": round_tag,
        "provenance": "human_ground_truth",
    }

    # 1) Append to the streaming log
    log_path = os.path.join(ctx.PROJECT_ROOT, GROUND_TRUTH_LOG_REL)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, separators=(",", ":")) + "\n")

    # 2) Mirror into the KB with a dedicated tag. The `learn_unified.add`
    #    path wants (title, content, category, tags). Use the add path to
    #    get embedding + full KB integration.
    kb_title = f"[GROUND TRUTH {round_tag or '?'} {section_n}] {moment_n} / {sentiment_n}"
    kb_content = (
        f"Human feedback on {section_n} ({moment_n}): {sentiment_n}.\n"
        f"{comment or '(no additional comment)'}"
    )
    kb_tags = [
        "human_ground_truth",
        f"section:{section_n}",
        f"moment:{moment_n}",
        f"sentiment:{sentiment_n}",
    ]
    if round_tag:
        kb_tags.append(round_tag)

    try:
        from server.tools_knowledge import add_knowledge as _ak
        kb_result = _ak(
            title=kb_title,
            content=kb_content,
            category="decision",
            tags=kb_tags,
            scope="project",
        )
    except Exception as _e:  # noqa: BLE001
        import logging
        logging.getLogger("HME").debug(f"ground_truth KB mirror failed: {_e}")
        kb_result = f"(KB mirror failed: {type(_e).__name__})"

    return (
        f"# Ground Truth Recorded\n\n"
        f"**Section:**    {section_n}\n"
        f"**Moment:**     {moment_n}\n"
        f"**Sentiment:**  {sentiment_n}\n"
        f"**Round:**      {round_tag or '(unspecified)'}\n\n"
        f"**Comment:**\n{comment or '(none)'}\n\n"
        f"Written to `metrics/hme-ground-truth.jsonl` and mirrored into the "
        f"KB with tag `human_ground_truth`. Trust tier: unconditionally HIGH.\n\n"
        f"KB: {kb_result[:200]}"
    )


def load_ground_truth_stream(limit: int = 200) -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, GROUND_TRUTH_LOG_REL)
    if not os.path.exists(path):
        return []
    out: list[dict] = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f.readlines()[-limit:]:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def ground_truth_report() -> str:
    _track("ground_truth_report")
    records = load_ground_truth_stream()
    if not records:
        return (
            "# Human Ground Truth\n\n"
            "No human ground-truth entries recorded yet.\n\n"
            "Record one with:\n"
            "  `learn(action='ground_truth', title=SECTION, content=COMMENT, "
            "tags=[MOMENT_TYPE, SENTIMENT], query=ROUND)`\n\n"
            "where title is the section (S0..S6 or 'all'), tags[0] is the "
            "moment type (convergence, climax, misfire, etc.), and tags[1] "
            "is the sentiment (compelling, flat, surprising, ...)."
        )
    lines = [
        "# Human Ground Truth",
        "",
        f"**Entries recorded:** {len(records)}",
        "",
    ]
    # Distribution by sentiment / moment type. Records stored from
    # malformed CLI calls have stub values like "c" or "[" — bucketing
    # those as "(unparsed)" stops the distribution from looking like
    # legitimate sentiments. Recognized vocabulary lives in the help
    # text; anything outside it is suspect input.
    from collections import Counter
    _RECOGNIZED_SENTIMENTS = {
        "compelling", "flat", "surprising", "legendary", "transcendent",
        "boring", "musical", "stale", "off", "clipped", "punchy",
        "emergent", "convincing", "uncanny", "?",
    }
    _RECOGNIZED_MOMENTS = {
        "convergence", "climax", "misfire", "arrival", "transcendent",
        "calibration", "whole-run", "collapse", "release", "pivot", "?",
    }

    def _bucket(val: str, recognized: set) -> str:
        v = (val or "").strip()
        if not v:
            return "(empty)"
        if v.lower() in recognized:
            return v.lower()
        return "(unparsed)"

    sent_count = Counter(_bucket(r.get("sentiment", "?"), _RECOGNIZED_SENTIMENTS) for r in records)
    moment_count = Counter(_bucket(r.get("moment_type", "?"), _RECOGNIZED_MOMENTS) for r in records)
    lines.append("## Sentiment distribution")
    for s, n in sent_count.most_common(10):
        lines.append(f"  {s:<20} {n}")
    if sent_count.get("(unparsed)"):
        lines.append(f"  (unparsed entries are CLI calls that didn't pass tags[1]=<sentiment>)")
    lines.append("")
    lines.append("## Moment type distribution")
    for m, n in moment_count.most_common(10):
        lines.append(f"  {m:<20} {n}")
    if moment_count.get("(unparsed)"):
        lines.append(f"  (unparsed entries are CLI calls that didn't pass tags[0]=<moment_type>)")
    lines.append("")
    lines.append("## Recent entries")
    for r in records[-10:]:
        lines.append(
            f"  {r.get('ts_iso', '?')}  [{r.get('round_tag', '?')}]  "
            f"{r.get('section', '?'):<5}  {r.get('moment_type', '?'):<15}  "
            f"{r.get('sentiment', '?'):<12}  {r.get('comment', '')[:60]}"
        )
    return "\n".join(lines)
