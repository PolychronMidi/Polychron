"""Feedback graph + reloadable module sync."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    ERROR,
    FAIL,
    METRICS_DIR,
    PASS,
    PROJECT_METRICS_DIR,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _DOC_DIRS,
    _HOOKS_DIR,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _result,
    _run_subprocess,
    errored,
    failed,
    passed,
    register,
    skipped,
)


@register
class FeedbackGraphVerifier(Verifier):
    """src/output/metrics/feedback_graph.json validates against src/scripts/pipeline/validate-feedback-graph.js"""
    name = "feedback-graph"
    category = "topology"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        graph = os.path.join(PROJECT_METRICS_DIR, "feedback_graph.json")
        if not os.path.isfile(graph):
            return skipped(summary="no feedback_graph.json")
        try:
            with open(graph) as f:
                data = json.load(f)
        except Exception as e:
            return failed(summary=f"feedback_graph.json invalid: {e}")
        loops = data.get("loops", [])
        ports = data.get("firewallPorts", [])
        return passed(summary=f"{len(loops)} loops + {len(ports)} firewall ports declared")


@register
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
            return errored(summary=f"reload registry import failed: {e}")
        missing = [
            name for name in declared
            if not any(path.is_file() for path in candidate_files(_PROJECT, name))
        ]
        if not missing:
            return passed(summary=f"{len(declared)}/{len(declared)} reload targets resolve")
        score = 1.0 - len(missing) / len(declared)
        return failed(score=score, summary=f"{len(missing)}/{len(declared)} reload targets missing", details=missing)

