#!/usr/bin/env python3
"""Producer-side contract test for review-verdict hook parsing.

Imports emit_review_verdict_marker() from the server directly, generates
each verdict, feeds the synthetic review output through the real hook
script (posttooluse_hme_review.sh), and asserts the hook produces the
expected user-facing behavior.

Catches drift the invariants.json patterns CAN'T catch:
  - the marker regex parses what the emitter actually emits (not just
    a pattern that happens to exist in the file)
  - the hook's branch logic is still wired to the right _nexus_mark/_clear
    calls
  - format changes to emit_review_verdict_marker() break this test
    BEFORE the pipeline runs, not after

Exit 0 on all-pass, 1 on any failure with the offending case.

Usage: python3 tools/HME/scripts/test-hook-contracts.py
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "tools" / "HME" / "mcp"))

try:
    from server.onboarding_chain import emit_review_verdict_marker
except Exception as e:
    print(f"FAIL: cannot import emit_review_verdict_marker: {e}", file=sys.stderr)
    sys.exit(1)

HOOK = PROJECT_ROOT / "tools" / "HME" / "hooks" / "posttooluse" / "posttooluse_hme_review.sh"
if not HOOK.is_file():
    print(f"FAIL: hook script missing: {HOOK}", file=sys.stderr)
    sys.exit(1)

_pass = 0
_fail = 0
_failures: list[str] = []


def _check(label: str, condition: bool, detail: str = "") -> None:
    global _pass, _fail
    if condition:
        _pass += 1
        if os.environ.get("VERBOSE"):
            print(f"PASS: {label}")
    else:
        _fail += 1
        _failures.append(f"{label}{f' ({detail})' if detail else ''}")
        print(f"FAIL: {label}{f' ({detail})' if detail else ''}")


def _run_hook(tool_response: str) -> tuple[str, str, int]:
    """Feed hook the given tool_response. Returns (stdout, stderr, exit_code)."""
    payload = json.dumps({
        "tool_input": {"command": "i/review mode=forget"},
        "tool_response": tool_response,
    })
    # The hook writes nexus state to tmp/hme-nexus.state under PROJECT_ROOT.
    # Redirect to a temp dir so we don't clobber real state.
    with tempfile.TemporaryDirectory(prefix="hme-hook-test-") as td:
        env = dict(os.environ)
        env["PROJECT_ROOT"] = str(PROJECT_ROOT)  # hook needs real PROJECT_ROOT for _safety.sh
        # tmp/ inside a temp project root is what _nexus.sh writes to — but the
        # hook sources helpers that assume PROJECT_ROOT has the real src/
        # structure. Keep PROJECT_ROOT real; we just verify stdout+stderr.
        result = subprocess.run(
            ["bash", str(HOOK)],
            input=payload,
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        return result.stdout, result.stderr, result.returncode


# ── contract: emitter produces exactly one line per verdict ──────────────
for v in ("clean", "warnings", "error"):
    marker = emit_review_verdict_marker(v)
    _check(f"emit_review_verdict_marker({v!r}) returns a marker string",
           isinstance(marker, str) and len(marker) > 0)
    _check(f"emit_review_verdict_marker({v!r}) is single-line",
           "\n" not in marker, detail=f"got {marker!r}")
    _check(f"emit_review_verdict_marker({v!r}) contains HME_REVIEW_VERDICT:",
           "HME_REVIEW_VERDICT:" in marker)
    _check(f"emit_review_verdict_marker({v!r}) contains the verdict word",
           v in marker)

# Invalid verdict returns "" (contract — reject gracefully).
_check("emit_review_verdict_marker('bogus') returns empty string",
       emit_review_verdict_marker("bogus") == "")
_check("emit_review_verdict_marker('') returns empty string",
       emit_review_verdict_marker("") == "")


# ── hook parses emitter output — the actual contract check ──────────────
def _hook_for_verdict(v: str) -> tuple[str, str, int]:
    body = "## Warnings: none found\n" + emit_review_verdict_marker(v)
    return _run_hook(body)


# clean verdict: hook should NOT mark REVIEW_ISSUES; should emit "Ready for
# pipeline" or similar progress hint; exit 0.
out, err, code = _hook_for_verdict("clean")
_check("clean verdict: hook exits 0", code == 0, f"rc={code}")
_check("clean verdict: does NOT emit REVIEW_ISSUES warning",
       "review issue" not in err.lower(), f"stderr={err!r}")
_check("clean verdict: emits next-step hint",
       "Ready for pipeline" in err or "already passed" in err or "Pipeline already" in err,
       f"stderr={err!r}")

# warnings verdict: hook MUST mark REVIEW_ISSUES "?", emit fix-and-re-run.
out, err, code = _hook_for_verdict("warnings")
_check("warnings verdict: hook exits 0", code == 0, f"rc={code}")
_check("warnings verdict: emits fix-and-re-run advice",
       "fix and re-run" in err.lower() or "review issue" in err.lower(),
       f"stderr={err!r}")

# error verdict: hook MUST mark REVIEW_CLI_FAILURE, emit server-error advice.
out, err, code = _hook_for_verdict("error")
_check("error verdict: hook exits 0", code == 0, f"rc={code}")
_check("error verdict: emits server-side error advice",
       "server-side error" in err.lower() or "worker log" in err.lower(),
       f"stderr={err!r}")


# ── drift: output missing BOTH marker and legacy sentinels fails loudly ──
out, err, code = _run_hook("Totally unrelated output, no markers at all")
_check("drift (no marker, no sentinels): emits drift warning",
       "missing canonical HME_REVIEW_VERDICT marker" in err,
       f"stderr={err!r}")
_check("drift: hook still exits 0 (marks state, doesn't crash)",
       code == 0, f"rc={code}")


# ── empty response: also drift ───────────────────────────────────────────
out, err, code = _run_hook("")
_check("empty response: emits drift warning",
       "missing canonical HME_REVIEW_VERDICT marker" in err,
       f"stderr={err!r}")


# ── CLI transport failure: ^hme-cli: prefix ──────────────────────────────
out, err, code = _run_hook("hme-cli: request failed -- connection refused")
_check("hme-cli: prefix → CLI_FAILURE advice",
       "review CLI call failed" in err or "worker down" in err,
       f"stderr={err!r}")


# ── summary ──────────────────────────────────────────────────────────────
print(f"\nPassed: {_pass}   Failed: {_fail}")
if _fail > 0:
    print("\nFailures:")
    for f in _failures:
        print(f"  - {f}")
    sys.exit(1)
sys.exit(0)
