#!/usr/bin/env python3
"""Python equivalent of ESLint rule `no-non-ascii`.

Disallow characters outside US-ASCII in HME Python source. Motivation: the JS
rule exists because copy-pasted content from chat clients / web pages
silently introduced characters like `’` (curly apostrophe), `—` (em-dash),
` ` (non-breaking space), and invisible control chars that broke regex
matching or produced diff noise. Same problem class in Python.

Allowed: ASCII (0x20–0x7e) + tab + newline + CR. Everything else is a hit.
Strings genuinely needing unicode should use `\\uXXXX` escapes so they're
visible in diffs.

Exits 0 + empty stdout when clean. One-per-line `path:line:col: char` format
on hits.
"""
from __future__ import annotations
import pathlib
import sys

ALLOWED = {0x09, 0x0a, 0x0d}  # tab, LF, CR

# Typography we consider "intentional prose" — heavily used in HME docstrings
# and comments. The JS equivalent bans these because JS developer conventions
# tend toward pure ASCII; Python/docs conventions accept them. Distinguish
# intentional Unicode from copy-paste weirdness.
INTENTIONAL_UNICODE = {
    0x2014,  # — em-dash (heavily used in prose)
    0x2013,  # – en-dash
    0x2192,  # → right arrow
    0x2190,  # ← left arrow
    0x00b7,  # · middle dot
    0x2026,  # … ellipsis
    0x03c3,  # σ sigma (used in drift-score z-score prose)
    0x00b1,  # ± plus-minus
    0x00a7,  # § section sign
    0x2264,  # ≤ less-or-equal
    0x2265,  # ≥ greater-or-equal
    0x2260,  # ≠ not-equal
    0x221e,  # ∞ infinity
    0x00d7,  # × multiplication
    0x00f7,  # ÷ division
    # Box-drawing (used in tree/topology output)
    0x2500, 0x2502, 0x250c, 0x2510, 0x2514, 0x2518, 0x251c, 0x2524, 0x252c, 0x2534, 0x253c,
    # Greek letters used in math prose
    0x03b1, 0x03b2, 0x03b3, 0x03b4, 0x03b5, 0x03bc, 0x03c0,
    # Arrows used in dispatch/map prose
    0x21d2, 0x21d0,  # ⇒ ⇐
    0x2022,  # • bullet
    0x2713, 0x2717,  # ✓ ✗ check/cross
    0x26a0,  # ⚠ warning (some diagnostics use this)
    0x1f525, 0x1f6a8,  # 🔥 🚨 alarm emojis (LIFESAVER banners)
    0x2248,  # ≈ approximately
    0x2194,  # ↔ bidirectional arrow
    0x00b2, 0x00b3,  # ² ³ superscript
    0x0394, 0x03a3, 0x03a9,  # Δ Σ Ω
    # Accented latin (proper nouns — e.g. Möbius)
    0x00e4, 0x00eb, 0x00ef, 0x00f6, 0x00fc, 0x00ff,
    0x00e1, 0x00e9, 0x00ed, 0x00f3, 0x00fa,
    # Block-drawing characters (used in progress bars / histograms / sparklines)
    0x2580, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587,
    0x2588, 0x2589, 0x258a, 0x258b, 0x258c, 0x258d, 0x258e, 0x258f,
    0x2590, 0x2591, 0x2592, 0x2593, 0x2594, 0x2595,
    # Geometric (up/down triangles for indicators)
    0x25b2, 0x25bc, 0x25ba, 0x25c4, 0x25cf, 0x25cb,
    # Corner/turn arrows
    0x21b3, 0x21b2,  # ↳ ↲
    # Status/review emoji indicators (deliberate UI elements in digest output)
    0x26a1,  # ⚡ zap
    0x1f4e1, 0x1f47b, 0x1f532, 0x1f309, 0x1f4c9,  # 📡 👻 🔲 🌉 📉
    0x1f4c8,  # 📈
    # Traffic-light indicator emojis (used in status output)
    0x1f534, 0x1f7e1, 0x1f7e2,  # 🔴 🟡 🟢
}

# Actively-suspect chars — tend to come from copy-paste and break regex/diff.
SUSPECT = {
    0x00a0,  # NBSP non-breaking space (invisible but not space)
    0x2018, 0x2019,  # ' ' curly single quotes
    0x201c, 0x201d,  # " " curly double quotes
    0x200b, 0x200c, 0x200d,  # zero-width space, non-joiner, joiner
    0xfeff,  # BOM
}


def _scan_file(f: pathlib.Path) -> list[str]:
    hits = []
    try:
        text = f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return hits
    for lineno, line in enumerate(text.splitlines(), 1):
        for col, ch in enumerate(line, 1):
            c = ord(ch)
            if c in ALLOWED:
                continue
            if 0x20 <= c <= 0x7e:
                continue
            if c in INTENTIONAL_UNICODE:
                continue
            # Non-ASCII / control — report. Tag known-suspect chars explicitly.
            tag = " SUSPECT" if c in SUSPECT else ""
            hits.append(f"{f}:{lineno}:{col}: {ch!r} (U+{c:04X}){tag}")
    return hits


def main() -> int:
    paths = sys.argv[1:] or ["tools/HME/service"]
    all_hits = []
    for p in paths:
        path = pathlib.Path(p)
        files = [path] if path.is_file() else list(path.rglob("*.py"))
        for f in files:
            all_hits.extend(_scan_file(f))
    if all_hits:
        # Limit output to first 30 hits to avoid flooding the battery report
        for h in all_hits[:30]:
            print(h)
        if len(all_hits) > 30:
            print(f"... and {len(all_hits) - 30} more")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
