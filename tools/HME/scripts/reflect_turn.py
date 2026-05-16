#!/usr/bin/env python3
"""Per-turn reflection writer -- appends one structured line to
output/metrics/reflections.jsonl summarising the turn just completed.

Schema (every line):
    {
      "ts": <unix>,
      "turn_id": <session_id or transcript hash>,
      "tier": "E1|E2|E3|E4|E5|MINIMAL|NATIVE",
      "tier_source": "heuristic|classifier|fail-safe|explicit",
      "isa_path": "<path to ISA used this turn, if any>",
      "criteria_count":  <int>,
      "criteria_passed": <int>,
      "criteria_failed": <int>,   # done with [DEFERRED-VERIFY] or unverified
      "doctrine_fired": {
          "advisor":              <bool>,  # legacy advisor invoked this turn
          "cato":                 <bool>,  # cross-vendor audit invoked (E4/E5 only)
          "conflict":             <bool>,  # advisor re-called after conflict
          "thinking_floor_met":   <bool>,  # tier thinking floor satisfied (E2+)
          "completeness_gate_met":<bool>,  # ISA tier-required sections all populated
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
    python3 tools/HME/scripts/reflect_turn.py \
        --tier E3 --isa-path tmp/isa/foo/ISA.md
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
_REFLECTIONS = _PROJECT / "output" / "metrics" / "reflections.jsonl"
_DETECTOR_VERDICTS = _PROJECT / "runtime" / "hme" / "stop-detector-verdicts.env"
_MODE_CLASSIFIER_LOG = _PROJECT / "output" / "metrics" / "mode-classifier.jsonl"


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


def _read_isa_progress(isa_path: Path | None) -> dict:
    """If --isa-path was given, parse it and surface ISC counts +
    completeness verdict. Empty dict otherwise."""
    if isa_path is None:
        return {}
    if not isa_path.is_file():
        return {"error": f"isa_path not a file: {isa_path}"}
    sys.path.insert(0, str(_PROJECT / "tools" / "HME" / "scripts" / "isa"))
    from isa_lib import (  # noqa: E402
        parse_isa, check_completeness, unverified_iscs,
    )
    d = parse_isa(isa_path)
    tier = d.frontmatter.get("tier")
    out: dict = {
        "isa_path": str(isa_path.relative_to(_PROJECT) if
                        _PROJECT in isa_path.parents else isa_path),
        "criteria_count": len(d.iscs),
        "criteria_passed": sum(1 for i in d.iscs if i.status == "[x]"
                                and not i.is_tombstone),
        "criteria_failed": len(unverified_iscs(d)),
        "completeness_missing": check_completeness(d, tier) if tier else None,
    }
    return out


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


def derive_doctrine_fired(detector_verdicts: dict, isa_progress: dict) -> dict:
    """Best-effort heuristic:  fired if any ISCs got verified
    this turn (criteria_passed > 0); 'advisor' fired if any advisor
    pattern shows up in detector verdicts; 'cato' / 'conflict' default
    False unless explicit signals exist (TODO: wire to actual cross-
    vendor verdicts when those land)."""
    return {
        "advisor": detector_verdicts.get("ADVISOR_INVOKED") == "yes",
        "cato": detector_verdicts.get("CATO_INVOKED") == "yes",
        "conflict": detector_verdicts.get("ADVISOR_CONFLICT") == "yes",
        "thinking_floor_met": detector_verdicts.get("THINKING_FLOOR_MET") != "no",
        "completeness_gate_met": (
            isa_progress.get("completeness_missing") == [] if
            isa_progress.get("completeness_missing") is not None else False
        ),
    }


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--turn-id", default=os.environ.get("SESSION_ID", ""))
    p.add_argument("--tier", default=None,
                   help="explicit tier; default: read from mode-classifier.jsonl")
    p.add_argument("--isa-path", default=None,
                   help="path to ISA used this turn (optional)")
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

    isa_path = Path(args.isa_path) if args.isa_path else None
    isa_progress = _read_isa_progress(isa_path)
    detector_verdicts = _read_detector_verdicts()

    doctrine_fired = derive_doctrine_fired(detector_verdicts, isa_progress)
    audit_panel = None if args.no_audit_panel else _try_audit_panel()

    line = {
        "ts": time.time(),
        "turn_id": args.turn_id or None,
        "tier": tier,
        "tier_source": tier_source,
        "isa_path": isa_progress.get("isa_path"),
        "criteria_count":  isa_progress.get("criteria_count"),
        "criteria_passed": isa_progress.get("criteria_passed"),
        "criteria_failed": isa_progress.get("criteria_failed"),
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
