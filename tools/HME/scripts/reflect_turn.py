#!/usr/bin/env python3
"""Per-turn reflection writer -- appends one structured line to
tools/HME/runtime/metrics/reflections.jsonl summarising the turn just completed.

Schema (every line):
    {
      "ts": <unix>,
      "turn_id": <session_id or transcript hash>,
      "tier": "E1|E2|E3|E4|E5|MINIMAL|NATIVE",
      "tier_source": "heuristic|classifier|fail-safe|explicit",
      "doctrine_fired": {
          "advisor":              <bool>,  # legacy advisor invoked this turn
          "cato":                 <bool>,  # cross-vendor audit invoked (E4/E5 only)
          "conflict":             <bool>,  # advisor re-called after conflict
          "thinking_floor_met":   <bool>,  # tier thinking floor satisfied (E2+)
      },
      "detectors_fired": {<detector_name>: <verdict>, ...},
      "edits_count":     <int>,   # tool_use Edit/Write/MultiEdit count
      "tool_uses_total": <int>,
      "implied_sentiment":      <int 1-10 or null>,
      "satisfaction_prediction":<int 1-10 or null>,
      "within_budget":          <bool or null>,
      "audit_panel": {  # optional snapshot from holograph capture_audit_state
          "loc_critical": ..., "loc_warn": ...,
          "py_undefined": ..., "boundary_findings": ...
      },
    }

Why this shape: PAI v6.3.0 emits the same line per Algorithm run
(MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl). Every later
analysis ("which doctrine rules predict criteria_passed?", "what's the
recall of the advisor when criteria_failed > 0?") is one query against
this stream.

Usage (most fields auto-derived from existing project state):

    python3 tools/HME/scripts/reflect_turn.py --turn-id $SESSION_ID
    python3 tools/HME/scripts/reflect_turn.py --json --dry-run
    python3 tools/HME/scripts/reflect_turn.py --tier E3
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_METRICS_DIR = Path(os.environ.get("HME_METRICS_DIR") or (_PROJECT / "tools" / "HME" / "runtime" / "metrics"))
_REFLECTIONS = _METRICS_DIR / "reflections.jsonl"
_DETECTOR_VERDICTS = _PROJECT / "tools" / "HME" / "runtime" / "stop-detector-verdicts.env"
_MODE_CLASSIFIER_LOG = _METRICS_DIR / "mode-classifier.jsonl"


def _read_detector_verdicts() -> dict:
    """Read tools/HME/runtime/stop-detector-verdicts.env (the file work_checks.js
    consumes). Returns dict of detector_name -> verdict."""
    out: dict = {}
    if not _DETECTOR_VERDICTS.is_file():
        return out
    try:
        for line in _DETECTOR_VERDICTS.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    except OSError as e:
        sys.stderr.write(
            f"[reflect_turn] detector verdicts read failed: {e}\n"
        )
    return out


def _read_last_classifier_line() -> dict | None:
    """The last line of mode-classifier.jsonl is this turn's tier
    decision (assuming UserPromptSubmit fired tier_classifier.py).
    Returns None if no classifier ran this turn."""
    if not _MODE_CLASSIFIER_LOG.is_file():
        return None
    try:
        with open(_MODE_CLASSIFIER_LOG, encoding="utf-8") as f:
            last = None
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    continue
        return last
    except OSError:
        return None



def _try_audit_panel() -> dict | None:
    """If audit-loc + audit-import-boundaries are runnable, capture their
    panel into the reflection. Best-effort: a missing audit doesn't
    block reflection."""
    import subprocess
    panel = {}
    audits = [
        ("loc_critical", "loc_warn", "loc",
         ["python3", str(_PROJECT / "scripts" / "audit-loc.py"), "--json"]),
        ("py_undefined", None, "python_undefined",
         ["python3", str(_PROJECT / "scripts" / "audit-python-undefined-names.py"),
          "--json"]),
        ("boundary_findings", None, "import_boundaries",
         ["python3", str(_PROJECT / "scripts" / "audit-import-boundaries.py"),
          "--json"]),
    ]
    for crit_key, warn_key, _label, cmd in audits:
        try:
            rc = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=15,
                                env={**os.environ, "PROJECT_ROOT": str(_PROJECT)})
            data = json.loads(rc.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            continue
        if "critical" in data and crit_key == "loc_critical":
            panel[crit_key] = len(data.get("critical", []))
            if warn_key:
                panel[warn_key] = len(data.get("warn", []))
        elif "count" in data:
            panel[crit_key] = data["count"]
    return panel if panel else None


def derive_doctrine_fired(detector_verdicts: dict) -> dict:
    """Best-effort heuristic: advisor/cato/conflict flags come from detector verdicts."""
    return {
        "advisor": detector_verdicts.get("ADVISOR_INVOKED") == "yes",
        "cato": detector_verdicts.get("CATO_INVOKED") == "yes",
        "conflict": detector_verdicts.get("ADVISOR_CONFLICT") == "yes",
        "thinking_floor_met": detector_verdicts.get("THINKING_FLOOR_MET") != "no",
    }


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--turn-id", default=os.environ.get("SESSION_ID", ""))
    p.add_argument("--tier", default=None,
                   help="explicit tier; default: read from mode-classifier.jsonl")
    p.add_argument("--implied-sentiment", type=int, default=None)
    p.add_argument("--satisfaction-prediction", type=int, default=None)
    p.add_argument("--no-audit-panel", action="store_true",
                   help="skip running audit-loc / boundary audits to fill panel")
    p.add_argument("--dry-run", action="store_true",
                   help="print the reflection line, don't append it")
    p.add_argument("--json", action="store_true",
                   help="pretty-print the reflection (otherwise compact JSONL)")
    args = p.parse_args(argv)

    classifier = _read_last_classifier_line()
    tier = args.tier
    tier_source = "explicit" if args.tier else None
    if not tier and classifier:
        tier = classifier.get("tier") or classifier.get("mode")
        tier_source = classifier.get("source")

    detector_verdicts = _read_detector_verdicts()

    doctrine_fired = derive_doctrine_fired(detector_verdicts)
    audit_panel = None if args.no_audit_panel else _try_audit_panel()

    line = {
        "ts": time.time(),
        "turn_id": args.turn_id or None,
        "tier": tier,
        "tier_source": tier_source,
        "doctrine_fired":  doctrine_fired,
        "detectors_fired": detector_verdicts,
        "implied_sentiment":       args.implied_sentiment,
        "satisfaction_prediction": args.satisfaction_prediction,
        "audit_panel": audit_panel,
    }

    if args.json:
        print(json.dumps(line, indent=2))
    else:
        compact = json.dumps(line)
        if args.dry_run:
            print(compact)
        else:
            _REFLECTIONS.parent.mkdir(parents=True, exist_ok=True)
            with open(_REFLECTIONS, "a", encoding="utf-8") as f:
                f.write(compact + "\n")
            print(f"reflect_turn: appended -> {_REFLECTIONS}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
