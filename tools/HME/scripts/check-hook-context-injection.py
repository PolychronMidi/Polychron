#!/usr/bin/env python3
"""Verify hooks that claim to inject context into Claude's next turn
actually use `hookSpecificOutput.additionalContext`, not `systemMessage`
alone. `systemMessage` is user-terminal-only; if a hook emits KB briefing
/ primer / pre-edit context only via systemMessage, Claude never sees it
and the documented "hook-chaining" is silently broken.

The bug caught this session: `_emit_enrich_allow` used systemMessage-only,
so every Edit's pretooluse briefing has been human-facing display for
months. Claude proceeded with Edits without ever receiving the KB
constraints the hook computed.

Scan heuristic: any shell file under tools/HME/hooks that emits
systemMessage containing a BRIEFING_MARKER pattern (KB CONSTRAINTS,
KB CONTEXT, BEFORE EDITING, AGENT PRIMER, WALKTHROUGH, etc.) must ALSO
emit `additionalContext` (or `permissionDecisionReason` for deny-path).
If only systemMessage is present, the briefing is display-only.

Exit codes:
    0 — all briefing-content hooks reach Claude
    non-0 — hook emits briefing text via user-only channel
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


# Patterns that indicate the hook is producing CLAUDE-FACING context,
# not merely user-terminal prose. Extend as new briefing-style outputs land.
BRIEFING_MARKERS = (
    "KB CONSTRAINTS",
    "KB CONTEXT",
    "BEFORE EDITING",
    "AGENT PRIMER",
    "WALKTHROUGH",
    "ANTI-POLLING",
    "PSYCHOPATHIC POLLING",
    "PSYCHOPATHIC-STOP",
    "FAIL FAST VIOLATION",
    "NEXUS:",
)


def scan_file(path: Path) -> list[str]:
    violations: list[str] = []
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return violations
    lines = text.splitlines()
    # Walk line-by-line looking for jq -n invocations that span one or more
    # continuation lines (bash backslash-continuation or embedded `\n` in
    # a single-line heredoc pattern). Terminate each block when we see a
    # line that ENDS in `}'` / `}"` (the trailing jq JSON close) OR the
    # statement appears complete on one line.
    i = 0
    while i < len(lines):
        ln = lines[i]
        # Skip lines that aren't a jq emit
        if "jq -n" not in ln and "jq -c" not in ln and "_emit_enrich_allow" not in ln and "_emit_block" not in ln:
            i += 1
            continue
        # Collect the statement across continuation lines until we hit one
        # that ends without a trailing backslash AND looks statement-complete.
        block_lines = [ln]
        j = i
        while j < len(lines) - 1 and lines[j].rstrip().endswith("\\"):
            j += 1
            block_lines.append(lines[j])
        # Also pick up lines that are clearly continuations of a quoted jq arg
        # (unbalanced quotes). Crude but effective: balance single quotes.
        while j < len(lines) - 1:
            joined = "\n".join(block_lines)
            # Count unescaped single quotes. If odd, continue.
            sq = len(re.findall(r"(?<!\\)'", joined))
            if sq % 2 == 0 and ("}'" in block_lines[-1] or '}"' in block_lines[-1] or block_lines[-1].rstrip().endswith("'")):
                break
            j += 1
            block_lines.append(lines[j])
            if j - i > 40:
                break  # safety cap
        block = "\n".join(block_lines)
        if "systemMessage" in block:
            has_briefing_marker = any(kw in block for kw in BRIEFING_MARKERS)
            reaches_claude = (
                "additionalContext" in block
                or "permissionDecisionReason" in block
            )
            if has_briefing_marker and not reaches_claude:
                first_marker = next((kw for kw in BRIEFING_MARKERS if kw in block), "?")
                violations.append(
                    f"{path}:{i + 1}: hook emits briefing ('{first_marker}') via systemMessage only — "
                    f"add additionalContext or permissionDecisionReason so Claude sees it."
                )
        i = max(j + 1, i + 1)
    return violations


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tools/HME/hooks")
    if not root.is_dir():
        print(f"ERROR: {root} is not a directory", file=sys.stderr)
        return 2
    violations: list[str] = []
    for sh in root.rglob("*.sh"):
        violations.extend(scan_file(sh))
    for v in sorted(violations):
        print(v)
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
