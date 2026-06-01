"""Layer 19: intent classification."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import re

from . import _shared
from ._shared import (
    _HEARTBEAT_INTERVAL, _MONITOR_CHECK_INTERVAL, _CORRELATION_WINDOW,
    _NARRATION_INTERVAL, _MAX_NARRATIVE_LINES, _ENV_CHECK_INTERVAL,
    _ENTANGLE_INTERVAL, _COUNTERFACTUAL_FILE_SUFFIX, _SYNTHESIS_WINDOW,
    _SYNTHESIS_PATTERN_INTERVAL, _INTENT_INTERVAL, _ARCHAEOLOGY_INTERVAL,
    ENV,
)

logger = logging.getLogger("HME.meta")


_shared._current_intent: dict = {}
_INTENT_SIGNALS = {
    "debugging": {"error", "bug", "crash", "fix", "broken", "fail", "traceback",
                  "stack", "exception", "not working", "why is"},
    "design": {"architecture", "design", "should we", "approach", "boundary",
               "coupling", "how should", "what if", "propose", "strategy"},
    "implementation": {"implement", "add", "create", "write", "extend", "wire",
                       "modify", "change", "update", "refactor"},
    "stress_testing": {"evolve", "stress", "contradict", "invariant", "probe",
                       "enforcement", "validate", "verify", "test"},
    "lab": {"sketch", "postboot", "lab", "verdict", "experiment", "trial",
            "prototype", "monkey-patch"},
}


def _classify_intent() -> dict:
    """Classify current conversation mode from recent transcript entries.

    Five modes: debugging, design, implementation, stress_testing, lab.
    Returns {mode, confidence, hints} based on keyword density in last 20 transcript entries.
    """

    try:
        transcript_path = os.path.join(
            ENV.optional("PROJECT_ROOT", ""),
            "log", "session-transcript.jsonl"
        )
        if not os.path.exists(transcript_path):
            return _shared._current_intent

        recent_text = ""
        with open(transcript_path) as f:
            lines = f.readlines()
        for line in lines[-20:]:
            try:
                entry = json.loads(line.strip())
                recent_text += " " + json.dumps(entry).lower()
            except (json.JSONDecodeError, ValueError):
                continue

        if not recent_text:
            return _shared._current_intent

        scores: dict[str, int] = {}
        hints: dict[str, list[str]] = {}
        for mode, signals in _INTENT_SIGNALS.items():
            hits = []
            for s in signals:
                if s in recent_text:
                    hits.append(s)
            scores[mode] = len(hits)
            hints[mode] = hits

        if not any(scores.values()):
            _shared._current_intent = {"mode": None, "confidence": 0.0}
            return _shared._current_intent

        best_mode = max(scores, key=scores.get)
        total_signals = sum(scores.values())
        confidence = scores[best_mode] / max(total_signals, 1)

        _shared._current_intent = {
            "mode": best_mode if confidence > 0.3 else None,
            "confidence": round(confidence, 2),
            "scores": scores,
            "hints": hints.get(best_mode, []),
        }
        return _shared._current_intent
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1274: {type(_err).__name__}: {_err}")
        return _shared._current_intent


def get_current_intent() -> dict:
    """Public accessor for L26 morphogenetic pre-loading in synthesis_llamacpp."""
    return _shared._current_intent


# Layer 33: Cross-Session Archaeology
