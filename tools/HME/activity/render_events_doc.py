#!/usr/bin/env python3
"""Render EVENTS.md from event_registry.json."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from event_registry import events, registry_path


OUT_PATH = Path(__file__).with_name("EVENTS.md")


def _stream_label(record: dict) -> str:
    return ", ".join(record["streams"])


def render() -> str:
    by_category: dict[str, list[dict]] = defaultdict(list)
    for record in events():
        by_category[record["category"]].append(record)

    lines = [
        "# HME Telemetry Events",
        "",
        "Generated from `event_registry.json`; edit the registry, then run:",
        "",
        "```bash",
        "python3 tools/HME/activity/render_events_doc.py",
        "```",
        "",
        "Reference for events emitted to `src/output/metrics/hme-activity.jsonl` "
        "(`activity`) and `src/output/metrics/hme-signals.jsonl` (`signal`).",
        "",
    ]
    for category, records in by_category.items():
        lines.append(f"## {category}")
        lines.append("")
        for record in records:
            lines.append(
                f"- **`{record['name']}`** [{_stream_label(record)}] -- {record['summary']}"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    registry_path()
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"rendered {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
