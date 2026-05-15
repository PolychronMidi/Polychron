#!/usr/bin/env python3
"""Render the state ownership registry section in doc/hme_full.md."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

from state_registry import registry_doc_summary  # noqa: E402

START = "<!-- BEGIN GENERATED STATE REGISTRY -->"
END = "<!-- END GENERATED STATE REGISTRY -->"


def render_doc(text: str) -> str:
    generated = registry_doc_summary(ROOT)
    start = text.find(START)
    end = text.find(END)
    if start == -1 or end == -1 or end < start:
        raise RuntimeError("doc/hme_full.md missing generated state registry markers")
    end += len(END)
    return text[:start] + generated + text[end:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    doc = ROOT / "doc" / "hme_full.md"
    current = doc.read_text(encoding="utf-8")
    rendered = render_doc(current)
    if args.check:
        if rendered != current:
            print("doc/hme_full.md state registry section is stale")
            return 1
        print("doc/hme_full.md state registry section is current")
        return 0
    if args.write:
        doc.write_text(rendered, encoding="utf-8")
        print("doc/hme_full.md state registry section updated")
        return 0
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
