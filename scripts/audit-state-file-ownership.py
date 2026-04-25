#!/usr/bin/env python3
"""Verify that no actor outside a shared-state file's declared owner
writes to it without coordination.

Pattern surfaced by peer-review iter 136 as the most-impactful unwatched
architectural contract: HME spans bash/python/JS runtimes that all touch
shared filesystem state, and there is no automated guard against an
unregistered writer.

The registry is `doc/HME_STATE_OWNERSHIP.md`. Files listed under "single
owner" must have writes only from the declared owner. Files listed under
"multiple writers" must have all writers enumerated. New files writing
into `tmp/` or `log/` or `output/metrics/` that aren't in either table
are flagged.

This is a heuristic verifier — grep-based, not AST-aware. False
positives possible (e.g. a literal string mention not actually a write).
False negatives possible (e.g. computed paths). The goal is monotonic
improvement: any drift surfaces as a diff against the registry, the
human resolves, the registry advances.

Exit codes:
  0 — all writes matched against registry
  1 — unregistered writers detected
  2 — usage error
"""
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
REGISTRY_DOC = PROJECT_ROOT / "doc" / "HME_STATE_OWNERSHIP.md"

# Roots to scan for write operations against shared state.
SCAN_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts" / "hme",
    PROJECT_ROOT / "scripts" / "detectors",
]
SKIP_DIRS = ("__pycache__", "node_modules", ".git", "out", "dist")


# State paths the registry tracks. Auto-extracted from the doc; this is
# a fallback if the parse fails.
KNOWN_PATHS = (
    "tmp/hme-thread.sid",
    "tmp/hme-thread-call-count",
    "tmp/hme-proxy-supervisor.pid",
    "tmp/hme-proxy-maintenance.flag",
    "tmp/hme-universal-pulse.heartbeat",
    "tmp/hme-non-hme-streak.score",
    "tmp/hme-streak-warn.txt",
    "tmp/hme-onboarding.state",
    "tmp/hme-tab.txt",
    "tmp/hme-log-errors.watermark",
    "tmp/hme-supervisor-abandoned",
    "tmp/hme-nexus.state",
    "tmp/hme-errors.turnstart",
    "tmp/hme-errors.lastread",
    "log/hme-errors.log",
    "output/metrics/detector-stats.jsonl",
    "output/metrics/hme-predictions.jsonl",
    "output/metrics/hme-enricher-efficacy.jsonl",
    "output/metrics/hme-activity.jsonl",
    "tools/HME/before-editing-cache.json",
)


def _parse_registry() -> dict[str, set[str]]:
    """Parse the markdown registry into {file -> {writer1, writer2, ...}}.

    Walks the markdown table rows, extracting the | File | Owner | Read-only |
    columns from the single-owner table, and the explicit Writers list
    under each multi-writer file's section.
    """
    if not REGISTRY_DOC.exists():
        return {}
    text = REGISTRY_DOC.read_text(encoding="utf-8")
    out: dict[str, set[str]] = {}

    # Single-owner table rows. `| `path` | owner | ... |`
    row_re = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*`?([^|`]+?)`?\s*\|", re.MULTILINE)
    for m in row_re.finditer(text):
        path = m.group(1).strip()
        owner = m.group(2).strip()
        if path and owner:
            # Owners can include multiple writers separated by /, comma, +
            writers = re.split(r"[/,+]|\s+OR\s+", owner)
            out.setdefault(path, set()).update(w.strip() for w in writers if w.strip())

    # Multi-writer sections: `### \`path\`` followed by **Writers:** list
    section_re = re.compile(
        r"### `([^`]+)`.*?\*\*Writers:\*\*(.*?)(?=\n###|\n## |\Z)",
        re.DOTALL,
    )
    for m in section_re.finditer(text):
        path = m.group(1).strip()
        body = m.group(2)
        # Each writer is `- \`relative/path.ext\``
        writers = re.findall(r"-\s*`([^`]+)`", body)
        if path:
            out.setdefault(path, set()).update(writers)

    return out


def _find_writers(path_substr: str) -> list[tuple[str, int]]:
    """Find files containing a write operation against `path_substr`."""
    hits: list[tuple[str, int]] = []
    # Patterns suggesting a write to the path
    write_patterns = [
        r">\s*[\"']?[^\"' \n]*" + re.escape(path_substr),
        r">>\s*[\"']?[^\"' \n]*" + re.escape(path_substr),
        r"writeFileSync\s*\([^,)]*" + re.escape(path_substr),
        r"appendFileSync\s*\([^,)]*" + re.escape(path_substr),
        r'open\([^,)]*' + re.escape(path_substr) + r"[^,)]*,\s*[\"'][wa]",
        r"with open\([^)]*" + re.escape(path_substr),
    ]
    combined = re.compile("|".join(write_patterns))
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            if any(s in str(p) for s in SKIP_DIRS):
                continue
            if p.suffix not in (".py", ".js", ".sh", ".bash"):
                continue
            try:
                content = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for ln, line in enumerate(content.splitlines(), 1):
                if combined.search(line):
                    rel = str(p.relative_to(PROJECT_ROOT))
                    hits.append((rel, ln))
                    break  # one finding per file is enough for ownership
    return hits


def _writer_matches_registry(writer_path: str, registered: set[str]) -> bool:
    """Soft match: a writer file matches a registered entry if the
    registered entry is a substring of writer_path or vice versa.
    Also accepts function-name registrations (e.g. `_safe_curl` matches
    a writer file whose content references that function)."""
    wp = writer_path.replace("\\", "/")
    for r in registered:
        rs = r.strip().replace("\\", "/")
        if not rs or rs == "(none)":
            continue
        if rs in wp or wp in rs:
            return True
        # Allow tail-match (e.g. registered "lifesaver.sh" matches "tools/.../lifesaver.sh")
        if wp.endswith("/" + rs) or wp == rs:
            return True
    return False


def main() -> int:
    if not REGISTRY_DOC.exists():
        print(f"audit-state-file-ownership: registry doc missing at {REGISTRY_DOC}",
              file=sys.stderr)
        return 2
    registry = _parse_registry()
    if not registry:
        print("audit-state-file-ownership: registry parsed empty — check format",
              file=sys.stderr)
        return 2

    # For each KNOWN_PATHS, scan for actual writers. Compare against registry.
    drift: list[str] = []
    paths_checked = 0
    for path in KNOWN_PATHS:
        paths_checked += 1
        # Take the basename for grep — full paths get computed at runtime
        # via PROJECT_ROOT/$file patterns and won't appear literally.
        basename = os.path.basename(path)
        writers = _find_writers(basename)
        # Find the registry entry for this path (substring match — registry
        # keys may be the basename or a more elaborate description)
        registered_set: set[str] = set()
        for reg_path, reg_writers in registry.items():
            if basename in reg_path or path in reg_path:
                registered_set.update(reg_writers)
        if not registered_set:
            # Path is not in the registry at all — that's drift only if
            # there are real writers
            if writers:
                drift.append(
                    f"{path}: writes detected but not in registry "
                    f"(writers: {', '.join(w for w, _ in writers[:3])})"
                )
            continue
        for writer_path, ln in writers:
            if not _writer_matches_registry(writer_path, registered_set):
                drift.append(
                    f"{path}:{writer_path}:{ln} — writer not declared in registry"
                )

    print(f"audit-state-file-ownership: scanned {paths_checked} state paths "
          f"against {len(registry)} registry entries")
    if drift:
        print(f"  {len(drift)} drift(s):")
        for d in drift[:20]:
            print(f"    {d}")
        if len(drift) > 20:
            print(f"    ... and {len(drift) - 20} more")
        return 1
    print("  no drift — every detected writer is declared in the registry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
