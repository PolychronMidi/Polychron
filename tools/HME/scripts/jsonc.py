"""Small JSONC loader shared by HME scripts.

Only `//` and `/* ... */` comments are stripped; trailing commas are still
invalid. Keeping this tiny helper central avoids each script carrying its own
comment-stripping parser.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def strip_jsonc_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    in_str = False
    esc = False
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and nxt == "/":
            j = text.find("\n", i)
            if j < 0:
                break
            out.append("\n")
            i = j + 1
            continue
        if ch == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            if j < 0:
                raise ValueError("unterminated block comment in JSONC")
            out.append("\n" * text[i:j + 2].count("\n"))
            i = j + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def loads_jsonc(text: str) -> Any:
    return json.loads(strip_jsonc_comments(text))


def load_jsonc(path: str | Path) -> Any:
    return loads_jsonc(Path(path).read_text(encoding="utf-8"))
