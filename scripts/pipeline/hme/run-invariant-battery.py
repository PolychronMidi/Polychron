#!/usr/bin/env python3
"""Run the HME declarative invariant battery from the pipeline.

Wraps check_invariants() so fail_streaks in metrics/hme-invariant-history.json
update every pipeline run — agent-independent. Without this, streaks only
refresh when an agent calls evolve(focus='invariants'), leaving chronic-failing
invariants stale for long stretches.

Exits 0 always (non-fatal, diagnostic only).
"""
import os
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "mcp"))

try:
    from server import context as _ctx
    _ctx.PROJECT_ROOT = _PROJECT
    # Stub mcp so @ctx.mcp.tool decorators in importers don't crash.
    if _ctx.mcp is None:
        class _StubMcp:
            def tool(self, *a, **k):
                def deco(f): return f
                return deco
        _ctx.mcp = _StubMcp()
    from server.tools_analysis.evolution.evolution_invariants import check_invariants
    out = check_invariants(verbose=False)
    first_line = out.split("\n", 1)[0]
    print(f"run-invariant-battery: {first_line.lstrip('# ').strip()}")
except Exception as e:
    print(f"run-invariant-battery: skipped — {type(e).__name__}: {e}")

sys.exit(0)
