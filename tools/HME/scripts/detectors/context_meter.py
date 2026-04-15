#!/usr/bin/env python3
"""Merge input_tokens/output_tokens from transcript into statusLine context file.

The statusLine hook writes authoritative used_pct/remaining_pct/size from the
Claude API. This script only adds input_tokens/output_tokens from the most
recent assistant event's usage dict — NEVER overwrites used_pct (which would
replace real API data with a fabricated estimate).

Usage: context_meter.py <transcript_path> <ctx_out_path>
  Reads the transcript, finds the last assistant message with a usage dict,
  merges (cache_read_input_tokens + cache_creation_input_tokens + input_tokens)
  as input_tokens, and output_tokens as output_tokens. Leaves all other keys
  in the ctx file untouched.

Failure mode: any error (missing file, parse error, no usage found) is silent
— the statusLine display just shows its existing data without the merge.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        return 0
    transcript_path, ctx_out = sys.argv[1], sys.argv[2]

    try:
        existing = json.loads(Path(ctx_out).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        existing = {}

    try:
        data = Path(transcript_path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return 0

    # Walk in reverse to find the last assistant event with a usage dict.
    for line in reversed(data.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "assistant":
            continue
        usage = obj.get("message", {}).get("usage", {}) or {}
        if not usage:
            continue
        inp = (
            usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
        )
        out = usage.get("output_tokens", 0)
        existing["input_tokens"] = inp
        existing["output_tokens"] = out
        try:
            Path(ctx_out).write_text(json.dumps(existing), encoding="utf-8")
        except OSError:
            pass
        break
    return 0


if __name__ == "__main__":
    sys.exit(main())
