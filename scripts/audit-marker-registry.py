#!/usr/bin/env python3
"""Verify that every entry in tools/HME/proxy/middleware/_markers.js is
actually referenced by its declared producer and consumer files.

Pattern A (from the architectural review): cross-layer convention drift.
Producers and consumers agree on a marker string by convention; a rename
on either side silently breaks the pair. The _markers.js registry was
supposed to fix this but peer-review caught that the registry is only
documentation — python/bash sides cannot import it, and nothing enforces
that its `sentinel` / `pattern` / `reqIdRegex` values actually appear in
the declared producer/consumer source files.

This verifier parses _markers.js, extracts each marker's declared
producer + consumers + marker string, and grep-checks that the string
literally appears in each referenced file. Missing reference = error.

Exit 0 if every marker is coherent with its references. Exit 1 on the
first drift — failing the verifier gates merges.
"""
import json
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
MARKERS_FILE = PROJECT_ROOT / "tools/HME/proxy/middleware/_markers.js"


def _extract_marker_blocks(text: str) -> list[dict]:
    """Parse _markers.js MARKERS object into entries. Regex-based extraction
    — not a full JS parser, tuned to the specific shape of this file. If
    _markers.js is restructured meaningfully, this parser must be updated
    (and THIS verifier's own staleness is Pattern A in miniature)."""
    # Find each top-level key in MARKERS: NAME: { ... },
    entries = []
    # crude split on top-level keys
    m_start = text.find("const MARKERS = {")
    if m_start < 0:
        return entries
    body = text[m_start:]
    # match NAME: { ... }, — brace matching via depth counter
    i = 0
    while i < len(body):
        km = re.match(r"\s+(\w+):\s*\{", body[i:])
        if not km:
            i += 1
            continue
        name = km.group(1)
        start = i + km.end() - 1  # position at opening {
        depth = 0
        j = start
        while j < len(body):
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
                if depth == 0:
                    block = body[start:j + 1]
                    entries.append({"name": name, "block": block})
                    i = j + 1
                    break
            j += 1
        else:
            break
    return entries


def _extract_field(block: str, field: str) -> str | None:
    """Extract a string/regex field value from a marker block."""
    # Match `field: 'value'` or `field: "value"` or `field: /regex/flags`
    patterns = [
        rf"{field}:\s*'([^'\\]*(?:\\.[^'\\]*)*)'",
        rf'{field}:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
        rf"{field}:\s*/([^/\\]*(?:\\.[^/\\]*)*)/\w*",
    ]
    for pat in patterns:
        m = re.search(pat, block)
        if m:
            return m.group(1)
    return None


def _extract_list_field(block: str, field: str) -> list[str]:
    """Extract a list field like `consumers: ['a.js', 'b.sh']`."""
    m = re.search(rf"{field}:\s*\[([^\]]*)\]", block)
    if not m:
        return []
    inner = m.group(1)
    return [s.strip().strip("'\"") for s in inner.split(",") if s.strip()]


def _find_literal(haystack_path: Path, needle: str) -> bool:
    """Check whether `needle` appears literally in the file."""
    if not haystack_path.is_file():
        return False
    try:
        text = haystack_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    # Strip leading/trailing slashes from regex literals so we match the core pattern
    return needle in text


def main() -> int:
    if not MARKERS_FILE.exists():
        print(f"audit-marker-registry: {MARKERS_FILE} missing", file=sys.stderr)
        return 2
    text = MARKERS_FILE.read_text(encoding="utf-8")
    blocks = _extract_marker_blocks(text)
    if not blocks:
        print("audit-marker-registry: no MARKERS entries parsed", file=sys.stderr)
        return 2

    failures: list[str] = []
    checked = 0
    for entry in blocks:
        name = entry["name"]
        block = entry["block"]
        producer = _extract_field(block, "producer")
        consumers = _extract_list_field(block, "consumers")
        # Identify the marker string (sentinel / pattern / reqIdRegex)
        marker_field = None
        for candidate in ("sentinel", "pattern", "reqIdRegex"):
            val = _extract_field(block, candidate)
            if val is not None:
                marker_field = (candidate, val)
                break
        if marker_field is None:
            # Marker with no observable string — advisory entry only
            continue

        field_name, marker_str = marker_field
        # Choose a grep-friendly substring — the first 8+ char run of
        # non-meta literal chars from the marker. This avoids trying to
        # match regex-meta characters as literals.
        literals = re.findall(r"[a-zA-Z0-9_.\-:\[\]/]{8,}", marker_str)
        needle = literals[0] if literals else marker_str
        checked += 1

        # Check producer
        if producer:
            # Allow glob-style producer entries like `pretooluse_{edit,write}.sh`
            if "{" in producer and "}" in producer:
                alts = re.findall(r"\{([^}]*)\}", producer)
                found_any = False
                for alt in alts[0].split(","):
                    p_path = PROJECT_ROOT / producer.replace(
                        "{" + alts[0] + "}", alt.strip())
                    if _find_literal(p_path, needle):
                        found_any = True
                        break
                if not found_any:
                    failures.append(
                        f"{name}: marker needle {needle!r} not found in any "
                        f"expansion of producer {producer}")
            else:
                p_path = PROJECT_ROOT / producer
                if not _find_literal(p_path, needle):
                    failures.append(
                        f"{name}: marker needle {needle!r} not found in "
                        f"producer {producer}")
        # Check each consumer
        for cons in consumers:
            # Skip prose-only consumer entries (wrapped in parens)
            if cons.startswith("(") or "i/thread" in cons:
                continue
            c_path = PROJECT_ROOT / cons
            if not _find_literal(c_path, needle):
                failures.append(
                    f"{name}: marker needle {needle!r} not found in "
                    f"consumer {cons}")

    if failures:
        print(f"audit-marker-registry: {len(failures)} drift(s) across "
              f"{checked} marker(s) with checkable strings", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"audit-marker-registry: {checked} marker(s) coherent across "
          f"{sum(1 for b in blocks)} registry entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
