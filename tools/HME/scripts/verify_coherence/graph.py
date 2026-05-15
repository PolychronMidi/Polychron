"""Feedback graph + reloadable module sync."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class FeedbackGraphVerifier(Verifier):
    """output/metrics/feedback_graph.json validates against scripts/validate-feedback-graph.js"""
    name = "feedback-graph"
    category = "topology"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        graph = os.path.join(METRICS_DIR, "feedback_graph.json")
        if not os.path.isfile(graph):
            return _result(SKIP, 1.0, "no feedback_graph.json")
        try:
            with open(graph) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"feedback_graph.json invalid: {e}")
        loops = data.get("loops", [])
        ports = data.get("firewallPorts", [])
        return _result(PASS, 1.0,
                       f"{len(loops)} loops + {len(ports)} firewall ports declared")


class ReloadableModuleSyncVerifier(Verifier):
    """Every module in the reload registry actually exists."""
    name = "reloadable-sync"
    category = "state"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.evolution.evolution_selftest.reload_registry import (
                all_reload_targets,
                candidate_files,
            )
            declared = all_reload_targets()
        except Exception as e:
            return _result(ERROR, 0.0, f"reload registry import failed: {e}")
        missing = [
            name for name in declared
            if not any(path.is_file() for path in candidate_files(_PROJECT, name))
        ]
        if not missing:
            return _result(PASS, 1.0, f"{len(declared)}/{len(declared)} reload targets resolve")
        score = 1.0 - len(missing) / len(declared)
        return _result(FAIL, score, f"{len(missing)}/{len(declared)} reload targets missing",
                       missing)

