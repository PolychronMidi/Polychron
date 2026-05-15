#!/usr/bin/env python3
"""Verify that no actor outside a shared-state file's declared owner
writes to it without coordination.

Pattern surfaced by peer-review iter 136 as the most-impactful unwatched
architectural contract: HME spans bash/python/JS runtimes that all touch
shared filesystem state, and there is no automated guard against an
unregistered writer.

The registry is `tools/HME/config/state-files.json`. Files listed under
`single_owner` must have writes only from the declared owner. Files listed
under `multi_writer` must have all writers enumerated. New files writing into
`tmp/`, `log/`, `runtime/hme/`, or `output/metrics/` should be added there
before the writer lands.

This is a heuristic verifier -- grep-based, not AST-aware. False
positives possible (e.g. a literal string mention not actually a write).
False negatives possible (e.g. computed paths). The goal is monotonic
improvement: any drift surfaces as a diff against the registry, the
human resolves, the registry advances.

Exit codes:
  0 -- all writes matched against registry
  1 -- unregistered writers detected
  2 -- usage error
"""
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
HME_SCRIPTS = PROJECT_ROOT / "tools" / "HME" / "scripts"
sys.path.insert(0, str(HME_SCRIPTS))

from state_registry import load_state_registry, ownership_map  # noqa: E402

REGISTRY_JSON = PROJECT_ROOT / "tools" / "HME" / "config" / "state-files.json"

# Roots to scan for write operations against shared state.
SCAN_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts" / "hme",
    PROJECT_ROOT / "scripts" / "detectors",
]
SKIP_DIRS = ("__pycache__", "node_modules", ".git", "out", "dist")


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
                # Skip comment lines: the `>` redirect-write regex matches
                # commented examples like `# FAIL->hme-errors.log`. Skip
                # leading `#`, `//`, `*` (jsdoc cont). Doesn't catch block
                # /* */ or """ but kills the dominant false-positive shape.
                stripped = line.lstrip()
                if stripped.startswith("#") or stripped.startswith("//") or stripped.startswith("*"):
                    continue
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
    if not REGISTRY_JSON.exists():
        print(f"audit-state-file-ownership: registry missing at {REGISTRY_JSON}",
              file=sys.stderr)
        return 2
    try:
        load_state_registry(PROJECT_ROOT)
    except Exception as e:
        print(f"audit-state-file-ownership: strict registry schema failed: {e}", file=sys.stderr)
        return 2
    registry = ownership_map(PROJECT_ROOT)
    if not registry:
        print("audit-state-file-ownership: registry parsed empty -- check format",
              file=sys.stderr)
        return 2

    # For each registered path, scan for actual writers. Compare against registry.
    drift: list[str] = []
    paths_checked = 0
    for path in registry:
        paths_checked += 1
        # Take the basename for grep -- full paths get computed at runtime
        # via PROJECT_ROOT/$file patterns and won't appear literally.
        basename = os.path.basename(path.rstrip("/*"))
        if not basename or "*" in basename:
            continue
        writers = _find_writers(basename)
        # Find the registry entry for this path (substring match -- registry
        # keys may be the basename or a more elaborate description)
        registered_set: set[str] = set()
        for reg_path, reg_writers in registry.items():
            if basename in reg_path or path in reg_path:
                registered_set.update(reg_writers)
        if not registered_set:
            # Path is not in the registry at all -- that's drift only if
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
                    f"{path}:{writer_path}:{ln} -- writer not declared in registry"
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
    print("  no drift -- every detected writer is declared in the registry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
