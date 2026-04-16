#!/usr/bin/env python3
"""Render metrics/hme-generalizations.json → doc/hme-discoveries.md.

Runs as POST_COMPOSITION pipeline step. Produces a human-editable markdown
document containing DRAFT generalization templates derived from crystallized
multi-round patterns. Each entry needs human polish to strip Polychron-specific
terms and rewrite as a universal structural claim.
"""
import json
import os
import sys
from datetime import datetime

PROJECT = os.environ.get("PROJECT_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(PROJECT, "metrics", "hme-generalizations.json")
DST = os.path.join(PROJECT, "doc", "hme-discoveries.md")


def main():
    if not os.path.isfile(SRC):
        print(f"render-generalizations: {SRC} not found, skipping")
        return

    with open(SRC) as f:
        data = json.load(f)

    meta = data.get("meta", {})
    patterns = data.get("patterns", [])
    candidates = [p for p in patterns if p.get("is_generalization_candidate")]

    if not candidates:
        print("render-generalizations: no generalization candidates, skipping")
        return

    lines = [
        "# HME Discoveries",
        "",
        "Generalizable patterns extracted from Polychron's evolution history.",
        "Each was observed across multiple rounds and scored below the specificity",
        f"threshold ({meta.get('specificity_threshold', '?')}), indicating potential",
        "applicability beyond this project.",
        "",
        f"*Auto-generated from {len(candidates)} candidates across "
        f"{meta.get('patterns_scanned', '?')} crystallized patterns.*",
        f"*Last updated: {datetime.now().strftime('%Y-%m-%d')}*",
        "",
        "---",
        "",
    ]

    # Sort by specificity (most general first), then by round count (most evidence)
    candidates.sort(key=lambda c: (c.get("specificity", 1), -len(c.get("rounds", []))))

    for i, c in enumerate(candidates, 1):
        pid = c["pattern_id"]
        spec = c.get("specificity", 0)
        rounds = c.get("rounds", [])
        members = c.get("member_count", 0)
        tags = c.get("shared_tags", [])
        template = c.get("template", "")

        lines.append(f"### {i}. {pid}")
        lines.append("")
        lines.append(f"**Specificity:** {spec:.2f} | **Rounds:** {len(rounds)} | **Members:** {members}")
        if tags:
            lines.append(f"**Tags:** {', '.join(tags)}")
        lines.append(f"**Evidence:** {', '.join(rounds[:12])}{'...' if len(rounds) > 12 else ''}")
        lines.append("")
        lines.append(f"> {template}")
        lines.append("")
        lines.append("---")
        lines.append("")

    with open(DST, "w") as f:
        f.write("\n".join(lines))

    print(f"render-generalizations: wrote {len(candidates)} entries to {DST}")


if __name__ == "__main__":
    main()
