#!/usr/bin/env python3
"""HME activity event emitter — Phase 1 of openshell_features_to_mimic.md.

Appends one JSON line per invocation to metrics/hme-activity.jsonl. Used by
bash hooks and the inference proxy (Phase 2) as the shared write channel for
the native activity bridge — the HME-scoped equivalent of OpenShell's OCSF
event stream.

Usage (from shell):
  python3 tools/HME/activity/emit.py --event=file_written \
      --session="$SESSION_ID" --file="$FILE" --hme_read_prior=1

Fields are free-form — any `--key=value` pair becomes a top-level JSON field.
Value parsing: "true"/"false"/"1"/"0" → bool, integer-ish → int, else str.

ts is injected automatically (unix seconds, int). Writes are atomic via a
single append O_APPEND open; no locking needed (kernel serializes appends
smaller than PIPE_BUF, and our lines are well under that).
"""
from __future__ import annotations

import json
import os
import sys
import time


def _coerce(v: str):
    if v in ("true", "True"):
        return True
    if v in ("false", "False"):
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        f = float(v)
        if f.is_integer():
            return int(f)
        return f
    except ValueError:
        pass
    return v


def main(argv: list[str]) -> int:
    fields: dict = {"ts": int(time.time())}
    skip_append = False
    for arg in argv[1:]:
        if arg == "--skip-append":
            # R17 #1: caller has already appended (e.g. main-pipeline.js for
            # guaranteed emission). Skip append here to avoid duplicates.
            skip_append = True
            continue
        if not arg.startswith("--"):
            continue
        body = arg[2:]
        if "=" not in body:
            continue
        k, v = body.split("=", 1)
        fields[k] = _coerce(v)

    if "event" not in fields:
        sys.stderr.write("emit.py: missing --event=NAME\n")
        return 2

    if skip_append:
        return 0

    project_root = os.environ["PROJECT_ROOT"]  # env-ok: set by caller from .env
    out_path = os.path.join(os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics")), "hme-activity.jsonl")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    line = json.dumps(fields, separators=(",", ":"), sort_keys=True) + "\n"
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
