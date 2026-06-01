#!/usr/bin/env python3
"""Generate a mermaid graph of the repo structure + dir_intent summaries.

Walks tracked + non-ignored directories (via git ls-files), reads each
dir's README.md dir_intent summary, and emits a sectioned block of
mermaid diagrams: one overview (root + immediate children) followed
by one full-depth subtree diagram per top-level dir. Splitting the
content this way keeps each individual diagram small enough to render
at a useful size; GitHub's mermaid renderer also supports click-to-
expand / pan / zoom on each diagram independently.

The whole section is replaced between the marker comments in README.md:

  <!-- BEGIN_REPO_MERMAID -->
  ...auto-generated section...
  <!-- END_REPO_MERMAID -->

Run: python3 tools/HME/scripts/generate-repo-mermaid.py
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
README = REPO_ROOT / "README.md"
BEGIN = "<!-- BEGIN_REPO_MERMAID -->"
END = "<!-- END_REPO_MERMAID -->"


def tracked_files(root: Path) -> list[Path]:
    rc = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True, text=True, check=True,
    )
    return [Path(line) for line in rc.stdout.splitlines() if line.strip()]


def dir_intent(abs_path: Path) -> str:
    readme = abs_path / "README.md"
    if not readme.is_file():
        return ""
    try:
        text = readme.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    # Stop before the auto-generated block so the root README's
    # dir_intent stays stable across regenerations.
    if BEGIN in text:
        text = text.split(BEGIN, 1)[0]
    for line in text.splitlines():
        stripped = line.strip()
        if (not stripped
                or stripped.startswith("#")
                or stripped.startswith("<!--")
                or stripped.startswith("```")):
            continue
        if len(stripped) > 80:
            stripped = stripped[:77] + "..."
        return stripped
    return ""


def safe_id(rel: str) -> str:
    if rel == ".":
        return "root"
    return re.sub(r"[^A-Za-z0-9_]", "_", rel.replace("/", "__"))


def safe_label(text: str) -> str:
    return text.replace('"', "'").replace("\n", " ")


def _node_line(root: Path, d: Path, indent: str = "    ",
               relative_to: Path | None = None) -> str:
    """Emit a mermaid node declaration.

    `relative_to` is the subtree root for which the label should be
    rendered. When set, the label is the path of `d` relative to
    `relative_to` -- so within the `src/` subtree, `src/composers/utils`
    renders as `composers/utils/`, disambiguating it from
    `src/scripts/utils` (which would render as `scripts/utils/`).
    Without `relative_to`, the label is the basename only.
    """
    node_id = safe_id(str(d))
    if d == Path("."):
        label_main = "Polychron"
    elif relative_to is not None and d != relative_to:
        try:
            rel = d.relative_to(relative_to)
            label_main = str(rel).replace(os.sep, "/") + "/"
        except ValueError:
            label_main = d.name + "/"
    else:
        label_main = d.name + "/"
    intent = dir_intent(root / d)
    label = f"{label_main}<br/><i>{safe_label(intent)}</i>" if intent else label_main
    return f'{indent}{node_id}["{safe_label(label)}"]'


def _all_dirs(root: Path) -> set[Path]:
    """Every tracked directory (root + every ancestor of every file)."""
    dirs: set[Path] = {Path(".")}
    for f in tracked_files(root):
        for parent in f.parents:
            if str(parent) == ".":
                continue
            dirs.add(parent)
    return dirs


def _top_levels(dirs: set[Path]) -> list[Path]:
    return sorted(
        (d for d in dirs if d != Path(".") and len(d.parts) == 1),
        key=lambda p: str(p),
    )


def build_overview(root: Path, orient: str = "LR") -> str:
    """Root + immediate top-level dirs, as a one-glance index."""
    dirs = _all_dirs(root)
    lines = [f"flowchart {orient}", _node_line(root, Path("."))]
    for top in _top_levels(dirs):
        lines.append(_node_line(root, top))
        lines.append(f"    root --> {safe_id(str(top))}")
    return "\n".join(lines)


def build_subtree(root: Path, top: Path, orient: str = "LR") -> str:
    """Full-depth map of the subtree rooted at `top`."""
    dirs = _all_dirs(root)
    top_str = str(top) + "/"
    in_subtree: set[Path] = {top}
    for d in dirs:
        s = str(d)
        if s == str(top) or s.startswith(top_str):
            in_subtree.add(d)

    parents: dict[Path, Path] = {}
    for d in in_subtree:
        if d == top:
            continue
        parents[d] = Path(*d.parts[:-1])

    lines = [f"flowchart {orient}"]
    for d in sorted(in_subtree, key=lambda p: (len(p.parts), str(p))):
        lines.append(_node_line(root, d, relative_to=top))
    for d in sorted(parents.keys(), key=lambda p: (len(p.parts), str(p))):
        lines.append(f"    {safe_id(str(parents[d]))} --> {safe_id(str(d))}")
    return "\n".join(lines)


def render_section(root: Path, orient: str = "LR") -> str:
    """Build the full BEGIN..END section: overview + per-subtree blocks."""
    dirs = _all_dirs(root)
    top_level = _top_levels(dirs)
    parts: list[str] = []
    parts.append(BEGIN)
    parts.append(
        "<!-- auto-generated by tools/HME/scripts/generate-repo-mermaid.py; "
        "do not edit by hand. GitHub's mermaid renderer supports click-to-"
        "expand and pan/zoom on each diagram below. -->"
    )
    parts.append("")
    parts.append("### Overview")
    parts.append("")
    parts.append("```mermaid")
    parts.append(build_overview(root, orient=orient))
    parts.append("```")
    for top in top_level:
        # Skip subtrees that have no children -- the lone-node diagram
        # duplicates what the Overview already shows.
        if not any(
            d != top and (str(d) == str(top) or str(d).startswith(str(top) + "/"))
            for d in dirs
        ):
            continue
        parts.append("")
        parts.append(f"### `{top}/`")
        parts.append("")
        parts.append("```mermaid")
        parts.append(build_subtree(root, top, orient=orient))
        parts.append("```")
    parts.append(END)
    parts.append("")
    return "\n".join(parts)


def update_readme(section: str) -> bool:
    text = README.read_text(encoding="utf-8")
    if BEGIN in text and END in text:
        pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.DOTALL)
        new = pattern.sub(section, text)
    else:
        new = text.rstrip() + "\n\n## Repo Map\n\n" + section
    if new == text:
        return False
    README.write_text(new, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--orient", choices=("LR", "TB", "TD"), default="LR",
                    help="mermaid flowchart orientation (default LR)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the section to stdout instead of writing")
    args = ap.parse_args()

    section = render_section(REPO_ROOT, orient=args.orient)
    if args.dry_run:
        sys.stdout.write(section)
        return 0
    changed = update_readme(section)
    print("README.md updated" if changed else "README.md already current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
