"""Phase 6.4 (R97) — discovery draft → human-curated markdown promotion.

Drafts live in `output/metrics/hme-discoveries-draft.jsonl` (auto-generated
by `scripts/pipeline/hme/synthesize-generalizations.py`, gitignored).
Confirmed discoveries live in `doc/hme-discoveries.md` (human-curated,
permanent).

A draft becomes eligible for promotion only when its synthesized invariant
has been stable across ≥3 consecutive pipeline runs. The stability counter
is maintained by the synthesize step and persists in the jsonl.

The agent cannot promote drafts — only humans can, via
`learn(action='promote_discovery', remove=<draft_id>)`. This keeps the
auto-generated sludge strictly out of the claims file.
"""
from __future__ import annotations

import json
import os
import re
import time
from server import context as ctx
from . import _track


def _paths() -> tuple[str, str]:
    metrics = os.path.join(ctx.PROJECT_ROOT, "output", "metrics")
    draft = os.path.join(metrics, "hme-discoveries-draft.jsonl")
    curated = os.path.join(ctx.PROJECT_ROOT, "doc", "hme-discoveries.md")
    return draft, curated


def _load_drafts(draft_path: str) -> list[dict]:
    if not os.path.isfile(draft_path):
        return []
    out: list[dict] = []
    with open(draft_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def list_discoveries() -> str:
    """Render the draft queue: pattern id, stability, promotable flag."""
    _track("list_discoveries")
    draft_path, curated_path = _paths()
    drafts = _load_drafts(draft_path)
    if not drafts:
        return (
            "No discovery drafts yet.\n\n"
            "Drafts are produced by `scripts/pipeline/hme/synthesize-generalizations.py` "
            "on each `npm run main` that finds a low-specificity crystallized pattern. "
            "Run the pipeline a few times, then call this again."
        )
    drafts.sort(key=lambda d: (not d.get("promotable"), -d.get("stable_runs", 0)))
    lines = [
        f"# Discovery Drafts ({len(drafts)})",
        "",
        f"Promote a ready entry: `learn(action='promote_discovery', remove=<id>, listening_notes=<annotation>)`",
        "",
    ]
    for d in drafts:
        stable = d.get("stable_runs", 0)
        ready = "READY" if d.get("promotable") else f"stable={stable}/3"
        lines.append(f"## [{d.get('id', '?')}] — {ready}")
        lines.append(f"  pattern: {d.get('pattern_id', '?')}")
        lines.append(f"  specificity: {d.get('specificity', 0):.2f}")
        lines.append(f"  rounds: {', '.join(d.get('rounds', [])[:6])}")
        inv = (d.get("invariant") or "").strip().replace("\n", " ")
        lines.append(f"  invariant: {inv[:180]}")
        lines.append("")
    return "\n".join(lines)


def promote_discovery(draft_id: str, annotation: str = "") -> str:
    """Append a stable draft to doc/hme-discoveries.md and remove it from
    the draft stream. Requires the draft to have promotable=true."""
    _track("promote_discovery")
    # Single-writer guard — same pattern kb mutations use.
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("kb", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
    if not draft_id or not str(draft_id).strip():
        return "Error: draft_id (pass as `remove=<id>`) is required."
    draft_id = str(draft_id).strip()
    draft_path, curated_path = _paths()
    drafts = _load_drafts(draft_path)
    target = next((d for d in drafts if d.get("id") == draft_id), None)
    if target is None:
        return (
            f"Error: no draft with id='{draft_id}'. "
            f"Use `learn(action='discoveries')` to list drafts."
        )
    if not target.get("promotable"):
        return (
            f"Error: draft '{draft_id}' is not promotable yet "
            f"(stable_runs={target.get('stable_runs', 0)}/3). "
            f"Pipeline must produce the same invariant ≥3 times before promotion."
        )

    # Append to curated doc. First promotion strips the "No entries yet"
    # seed line; subsequent promotions append under the previous entry.
    try:
        with open(curated_path) as f:
            current = f.read()
    except OSError:
        current = ""
    marker = "*No entries yet. The first promoted claim will appear below this line.*"
    timestamp = time.strftime("%Y-%m-%d")
    entry_title = target.get("tags", ["(untagged)"])[0] if target.get("tags") else "(untagged)"
    rounds_s = ", ".join(target.get("rounds", [])[:8])
    entry = [
        f"## {entry_title} — promoted {timestamp}",
        "",
        f"**Source:** crystallized pattern `{target.get('pattern_id', '?')}`  ",
        f"**Evidence:** {len(target.get('rounds', []))} rounds ({rounds_s})  ",
        f"**Members:** {target.get('member_count', 0)}  ",
        f"**Specificity:** {target.get('specificity', 0):.2f}/1.00  ",
        f"**Draft ID:** `{draft_id}` (stable across {target.get('stable_runs', '?')} pipeline runs)",
        "",
        "### Invariant",
        "",
        target.get("invariant", "(missing)"),
        "",
        "### Falsifiable prediction",
        "",
        target.get("prediction", "(missing)"),
        "",
        "### Counterexample that would disprove it",
        "",
        target.get("counterexample", "(missing)"),
        "",
    ]
    if annotation:
        entry.append("### Human annotation")
        entry.append("")
        entry.append(annotation)
        entry.append("")
    entry.append("---")
    entry.append("")
    entry_text = "\n".join(entry)

    if marker in current:
        new_content = current.replace(marker, entry_text)
    else:
        new_content = current.rstrip() + "\n\n" + entry_text
    with open(curated_path, "w") as f:
        f.write(new_content)

    # Remove the promoted draft from the stream.
    remaining = [d for d in drafts if d.get("id") != draft_id]
    with open(draft_path, "w") as f:
        for d in remaining:
            f.write(json.dumps(d) + "\n")

    return (
        f"Promoted draft '{draft_id}' → {os.path.relpath(curated_path, ctx.PROJECT_ROOT)}\n"
        f"  pattern: {target.get('pattern_id', '?')}\n"
        f"  invariant: {(target.get('invariant') or '').strip()[:180]}\n"
        f"Remaining drafts: {len(remaining)}"
    )
