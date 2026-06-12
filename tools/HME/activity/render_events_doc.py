#!/usr/bin/env python3
"""Render the telemetry-events section into doc/self-coherence-full.md.

The events catalog is registry-first: event_registry.json is the source.
This regenerates the marked block in the canonical full doc in place, so
there is no separate stray EVENTS.md to drift or circumvent the doc rule.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from event_registry import events, registry_path

CANONICAL_DOC = Path(__file__).resolve().parents[3] / "doc" / "self-coherence-full.md"
BEGIN = "<!-- BEGIN_TELEMETRY_EVENTS -->"
END = "<!-- END_TELEMETRY_EVENTS -->"


def _stream_label(record: dict) -> str:
    return ", ".join(record["streams"])


def render_block() -> str:
    by_category: dict[str, list[dict]] = defaultdict(list)
    for record in events():
        by_category[record["category"]].append(record)
    lines = [
        BEGIN,
        "## HME Telemetry Events",
        "",
        "Generated from `tools/HME/activity/event_registry.json`; edit the registry, then run:",
        "",
        "```bash",
        "python3 tools/HME/activity/render_events_doc.py",
        "```",
        "",
        "Reference for events emitted to `tools/HME/runtime/metrics/hme-activity.jsonl` "
        "(`activity`) and `tools/HME/runtime/metrics/hme-signals.jsonl` (`signal`).",
        "",
    ]
    for category, records in by_category.items():
        lines.append(f"### {category}")
        lines.append("")
        for record in records:
            lines.append(
                f"- **`{record['name']}`** [{_stream_label(record)}] -- {record['summary']}"
            )
        lines.append("")
    lines.append(END)
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    registry_path()
    block = render_block()
    doc = CANONICAL_DOC.read_text(encoding="utf-8")
    if BEGIN in doc and END in doc:
        head = doc[: doc.index(BEGIN)]
        tail = doc[doc.index(END) + len(END):]
        doc = head.rstrip() + "\n\n" + block + tail.lstrip("\n")
    else:
        doc = doc.rstrip() + "\n\n" + block
    CANONICAL_DOC.write_text(doc if doc.endswith("\n") else doc + "\n", encoding="utf-8")
    print(f"rendered telemetry-events block into {CANONICAL_DOC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
