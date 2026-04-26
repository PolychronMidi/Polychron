#!/usr/bin/env python3
"""i/audit-tools — stress-test the i/* CLI surface for UX failures.

For each tool registered in tools/HME/i_registry.json, runs a battery
of edge cases and rates the response shape against a UX rubric. Tools
that score below threshold get listed as candidates for fix. Designed
to run once per session (or on-demand) so UX bugs surface without each
needing to be discovered the hard way.

Edge cases run per tool:
  1. No-args invocation — what does `i/<name>` (zero args) emit?
  2. --help / help action (when supported) — does the tool self-describe?
  3. Typo'd action name — `i/<name> action=garbage-mode` — does the
     error message surface valid options or just say "unknown"?

UX rubric (each yields 0 or 1; tool scored / 5):
  - usage line present (helps user understand shape) [no-args]
  - example or list-of-valid-options surfaced (not just bare usage) [no-args]
  - exit code is non-zero when invocation is incomplete [no-args]
  - typo'd-action error names valid alternatives or did-you-mean [typo]
  - completes within 5s (no hang, no I/O dependency for help text) [no-args]

Tools scoring < 4/5 are flagged. Output:
  - stdout: human-readable summary
  - tools/HME/KB/devlog/<ts>-tool-surface-audit.json — machine-readable
    rating per tool, suitable for tracking improvements over time

Skips destructive tools (those whose no-args invocation would mutate
state) — the registry's `safe_no_args: false` flag opts a tool out.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or
                    Path(__file__).resolve().parents[2])
REGISTRY = PROJECT_ROOT / "tools" / "HME" / "i_registry.json"
DEVLOG = PROJECT_ROOT / "tools" / "HME" / "KB" / "devlog"

# Tools whose no-args invocation would mutate state — skip the no-args
# probe. Add `safe_no_args: false` to a tool's registry entry to opt
# out instead of editing this list.
DESTRUCTIVE_NO_ARGS_DEFAULT = {
    "evolve",          # writes to lab/, kicks off a sketch
    "extract-spec",    # writes to output/
    "freeze",          # mutates lab state
    "substrate",       # mutates substrate state
    "prove",           # potentially long-running compile
}

# Aliases / deprecated entries — skip outright (they delegate elsewhere
# and rating them double-counts).
SKIP_TOOLS = {"buddy"}  # deprecated alias for i/dispatch


def _run(cmd: list[str], timeout: float = 5.0) -> dict:
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, cwd=str(PROJECT_ROOT),
        )
        return {
            "rc": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "elapsed_s": round(time.time() - t0, 3),
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "rc": -1,
            "stdout": (e.stdout.decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")),
            "stderr": (e.stderr.decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or "")),
            "elapsed_s": round(time.time() - t0, 3),
            "timed_out": True,
        }


def _has_usage_line(text: str) -> bool:
    return any(s in text.lower() for s in ("usage:", "usage ", "syntax:"))


def _has_examples_or_options(text: str) -> bool:
    """Detect surfaces that go BEYOND a bare usage line — listing valid
    options, examples, sub-commands, etc. The bar this catches: 'Usage:
    i/why <invariant-id>' alone is NOT enough; user has no way to discover
    valid IDs. 'Available invariants: ...' or 'Examples: ...' IS enough."""
    lower = text.lower()
    signals = [
        "example", "available", "valid", "options:", "actions:", "modes:",
        "subcommand", "did you mean", "  i/", "see ", "try ",
    ]
    return any(s in lower for s in signals)


def _has_did_you_mean(text: str) -> bool:
    lower = text.lower()
    return any(s in lower for s in ("did you mean", "near match", "available", "valid options", "valid values"))


def _rate_tool(name: str, entry: dict) -> dict:
    """Run the probe battery; return rating dict."""
    safe = entry.get("safe_no_args", name not in DESTRUCTIVE_NO_ARGS_DEFAULT)
    score = {"name": name, "category": entry.get("category", ""),
             "checks": {}, "skipped": False, "score": 0, "max": 5}
    bin_path = PROJECT_ROOT / "i" / name
    if not bin_path.exists() or not os.access(bin_path, os.X_OK):
        score["skipped"] = True
        score["reason"] = "not executable / missing"
        return score
    if not safe:
        score["skipped"] = True
        score["reason"] = "destructive no-args (opted out)"
        return score
    # Probe 1: no-args
    no_args = _run([str(bin_path)])
    combined = (no_args["stdout"] + "\n" + no_args["stderr"])
    score["checks"]["usage_line"] = _has_usage_line(combined)
    score["checks"]["examples_or_options"] = _has_examples_or_options(combined)
    score["checks"]["nonzero_exit"] = no_args["rc"] != 0
    score["checks"]["completes_under_5s"] = not no_args["timed_out"]
    # Probe 2: typo'd action — only meaningful when the tool accepts an
    # action arg. Best-effort: try `action=garbage-mode`. If the tool
    # ignores it (no-action tools), check stays neutral; if the tool
    # errors with a useful message, +1.
    typo = _run([str(bin_path), "action=garbage-mode-xyz"])
    typo_combined = (typo["stdout"] + "\n" + typo["stderr"])
    score["checks"]["typo_suggests_alternative"] = _has_did_you_mean(typo_combined)
    score["score"] = sum(1 for v in score["checks"].values() if v)
    return score


def main() -> int:
    if not REGISTRY.exists():
        print(f"audit-tools: registry missing at {REGISTRY}", file=sys.stderr)
        return 1
    reg = json.loads(REGISTRY.read_text())
    cmds = reg.get("commands", {})
    results = []
    for name, entry in sorted(cmds.items()):
        if name in SKIP_TOOLS:
            continue
        results.append(_rate_tool(name, entry))
    # Render summary
    print(f"i/audit-tools — surface stress test ({len(results)} tools probed)")
    print("=" * 78)
    flagged = []
    skipped = []
    rated = []
    for r in results:
        if r["skipped"]:
            skipped.append(r)
            continue
        rated.append(r)
        if r["score"] < 4:
            flagged.append(r)
    rated.sort(key=lambda r: (r["score"], r["name"]))
    print(f"\nRATED: {len(rated)}    FLAGGED (score<4): {len(flagged)}    SKIPPED: {len(skipped)}")
    if flagged:
        print("\nFlagged for UX improvement:")
        for r in flagged:
            checks_failed = [k for k, v in r["checks"].items() if not v]
            print(f"  {r['score']}/5  i/{r['name']:<14} ({r['category']:<20}) "
                  f"missing: {', '.join(checks_failed)}")
    if skipped:
        print("\nSkipped:")
        for r in skipped:
            print(f"  i/{r['name']:<14} — {r.get('reason', '?')}")
    # Write machine-readable report
    DEVLOG.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime())
    report_path = DEVLOG / f"{ts}-tool-surface-audit.json"
    report_path.write_text(json.dumps({
        "ts": ts, "tools_probed": len(results),
        "rated": len(rated), "flagged_count": len(flagged),
        "results": results,
    }, indent=2))
    print(f"\nMachine-readable report: {report_path.relative_to(PROJECT_ROOT)}")
    return 0 if not flagged else 1


if __name__ == "__main__":
    sys.exit(main())
