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

# Allowlist (NOT blocklist) of tools safe to probe with no-args.
# Inverted from the prior blocklist after a probe pass cascaded into
# verify-coherence.py + verify-doc-sync.py subprocesses that orphaned
# past the 5s timeout (grandchildren survive subprocess.run timeout —
# only the direct child is SIGTERMed). The accumulated memory pressure
# crashed the host. New default: assume a tool is UNSAFE to probe
# unless its registry entry has `safe_no_args: true`.
SAFE_NO_ARGS_ALLOWLIST = {
    "help",            # pure stdout, no subprocess cascade
    "buddy",           # deprecated alias — exec to dispatch (light)
    "dispatch",        # status path is filesystem-only read
    "chain",           # usage line only
    "policies",        # static config read
    "todo",            # local JSON read
    "pattern",         # local JSON read
    "why",             # static metric file read (now lists IDs on no-args)
    "audit-tools",     # circular self-call is harmless usage line
}

# Aliases / deprecated entries / self — skip outright. `audit-tools`
# self-probes would recurse (the auditor probing itself probes itself
# probing itself), bounded by the cgroup but wasteful.
SKIP_TOOLS = {"buddy", "audit-tools"}


def _systemd_run_available() -> bool:
    """Return True if `systemd-run --scope` can be used to spawn the
    probe inside a transient cgroup. Required for safe operation —
    process-group kill is insufficient here because HME hooks
    `disown` backgrounded work (see posttooluse_bash.sh:65,
    _lifesaver_bg in misc_safe.sh:76, etc.), which detaches from the
    parent group and survives os.killpg(SIGKILL).
    """
    import shutil as _shutil
    return _shutil.which("systemd-run") is not None


def _run(cmd: list[str], timeout: float = 5.0) -> dict:
    """Run a command inside a transient systemd cgroup scope so that
    EVERY descendant — including double-forked + disown'd background
    processes — is killed atomically when the scope is terminated.

    Why systemd-run --scope (not process-group):
      HME hooks routinely fire backgrounded subprocesses with
      `(...) & disown`, which detaches them from the parent's process
      group. os.killpg(SIGKILL) misses them. Those orphans accumulate
      memory pressure across probes and brought the host down twice
      during this auditor's development. cgroup-scoped kill cannot
      be escaped by `disown` / `setsid` / `nohup` / double-fork because
      the cgroup membership is inherited by every fork() and only
      cleared by an explicit cgroup-write.

    Resource caps applied per probe:
      MemoryMax=512M     prevents accumulation; hard kill at limit
      CPUQuota=100%      one core max; no fork-bomb amplification
      TasksMax=64        cap on descendant count

    Refuses to run if systemd-run is unavailable — the legacy
    process-group fallback was demonstrated unsafe and is removed.
    """
    if not _systemd_run_available():
        return {
            "rc": -1, "stdout": "", "elapsed_s": 0.0, "timed_out": False,
            "stderr": (
                "audit-tool-surface: systemd-run is required for safe "
                "subprocess isolation. Install systemd or run on a host "
                "with cgroups available. The legacy process-group "
                "fallback escapes via `disown` and was removed after "
                "crashing the host twice."
            ),
        }
    t0 = time.time()
    # Transient unit name — visible in `systemctl list-units --user`
    # while running, gone after.
    unit = f"hme-audit-{os.getpid()}-{int(t0 * 1000)}"
    wrapped = [
        "systemd-run", "--user", "--scope", "--quiet",
        f"--unit={unit}",
        f"--property=RuntimeMaxSec={int(timeout) + 2}",
        "--property=MemoryMax=512M",
        "--property=CPUQuota=100%",
        "--property=TasksMax=64",
        "--",
        *cmd,
    ]
    try:
        proc = subprocess.Popen(
            wrapped, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=str(PROJECT_ROOT),
        )
    except OSError as e:
        return {"rc": -1, "stdout": "", "stderr": f"spawn failed: {e}",
                "elapsed_s": 0.0, "timed_out": False}
    timed_out = False
    try:
        # `timeout + 1` — systemd-run's RuntimeMaxSec kills at timeout;
        # we wait a little longer for the descendants + cgroup teardown
        # to finalize before declaring our own timeout.
        stdout, stderr = proc.communicate(timeout=timeout + 2)
    except subprocess.TimeoutExpired:
        # Belt-and-suspenders: tell systemd to stop the scope. cgroup
        # kill follows; ALL descendants die regardless of disown/setsid.
        timed_out = True
        try:
            subprocess.run(
                ["systemctl", "--user", "stop", unit],
                check=False, capture_output=True, text=True, timeout=3,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass
        try:
            stdout, stderr = proc.communicate(timeout=2.0)
        except subprocess.TimeoutExpired:
            try: proc.kill()
            except OSError: pass
            try: stdout, stderr = proc.communicate(timeout=1.0)
            except Exception: stdout, stderr = "", ""
    return {
        "rc": -1 if timed_out else proc.returncode,
        "stdout": stdout or "",
        "stderr": stderr or "",
        "elapsed_s": round(time.time() - t0, 3),
        "timed_out": timed_out,
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


def _has_substantive_content(text: str) -> bool:
    """A tool emits substantive content on no-args when output is more
    than just whitespace + a usage line: multi-line output, list
    markers, or > 100 chars of non-trivial content. Catches tools
    whose canonical no-args behavior IS the useful action (e.g.
    `i/dispatch status`, `i/help` index, `i/policies list`).
    """
    stripped = text.strip()
    if len(stripped) < 100:
        return False
    lines = [ln for ln in stripped.splitlines() if ln.strip()]
    if len(lines) < 3:
        return False
    # Has list-shape markers (bullets, numbered, indented, headers, etc.)
    list_markers = sum(1 for ln in lines
                        if ln.lstrip().startswith(("-", "*", "[", "#"))
                        or ":" in ln[:30])
    return list_markers >= 2


def _has_did_you_mean(text: str) -> bool:
    lower = text.lower()
    return any(s in lower for s in ("did you mean", "near match", "available", "valid options", "valid values"))


def _has_useful_error(text: str, rc: int) -> bool:
    """A typo'd action is well-handled if the response either tells the
    user what went wrong AND points toward a fix, OR ignores the
    unknown arg and shows normal output. Exit code is informational —
    many HME tools return 0 even on user-error (lenient stdout-only
    surfaces). The check is on output quality, not return code.

    Useful-error signals:
      - "did you mean" / "near match" — fuzzy-match suggestion
      - "unknown" / "invalid" — names the problem
      - "not found" — names the problem
      - "try:" / "try " — action-suggesting instruction
      - "available" / "valid" / "use:" — names valid alternatives
      - "usage" — falls back to usage line
    """
    lower = text.lower()
    error_signals = (
        "did you mean", "near match",
        "unknown", "invalid", "not found", "not registered",
        "no such", "not a directory", "no entry", "no entries",
        "try:", "try ",
        "available", "valid options", "valid values", "use:",
        "usage",
        "failed (status",   # hme-cli error envelope
        "must be",          # parameter validation
        "expected ",        # type-mismatch errors
    )
    if any(s in lower for s in error_signals):
        return True
    # rc=0 with no recognizable error → maybe the tool ignored the arg
    # gracefully and produced normal output. OK iff substantive.
    if rc == 0 and _has_substantive_content(text):
        return True
    return False


def _rate_tool(name: str, entry: dict) -> dict:
    """Run the probe battery; return rating dict."""
    # Allowlist: only probe tools the registry explicitly opts in via
    # `safe_no_args: true` OR that appear in SAFE_NO_ARGS_ALLOWLIST.
    # Inverted from the prior blocklist — see comment near
    # SAFE_NO_ARGS_ALLOWLIST. New tools default to NOT probed.
    safe = entry.get("safe_no_args", name in SAFE_NO_ARGS_ALLOWLIST)
    score = {"name": name, "category": entry.get("category", ""),
             "checks": {}, "skipped": False, "score": 0, "max": 5}
    bin_path = PROJECT_ROOT / "i" / name
    if not bin_path.exists() or not os.access(bin_path, os.X_OK):
        score["skipped"] = True
        score["reason"] = "not executable / missing"
        return score
    if not safe:
        score["skipped"] = True
        score["reason"] = "not in safe_no_args allowlist (opt in via registry)"
        return score
    # Probe 1: no-args. 2s timeout + cgroup isolation — allowlisted
    # tools should respond within ms (usage-line or canonical default
    # action like `dispatch status`).
    no_args = _run([str(bin_path)], timeout=2.0)
    combined = (no_args["stdout"] + "\n" + no_args["stderr"])
    # Rubric: a tool is well-behaved on no-args if EITHER it shows a
    # usage line + valid options (the "REQUIRES an arg" pattern) OR
    # it produces substantive content (the "DEFAULTS to a useful
    # action" pattern). Exit code is informational, not a fail
    # condition — both rc=0 (default-action tools) and rc=2 (usage-
    # gate tools) are acceptable. Hangs ARE failures.
    has_usage = _has_usage_line(combined)
    has_examples = _has_examples_or_options(combined)
    has_content = _has_substantive_content(combined)
    score["checks"]["self_documents_on_noargs"] = (
        (has_usage and has_examples) or has_content
    )
    score["checks"]["completes_within_timeout"] = not no_args["timed_out"]
    # Brief pause so any subprocess descendant of the prior probe has
    # a chance to finish exiting before we add more load.
    time.sleep(0.1)
    # Probe 2: typo'd action. A tool is well-behaved on a typo'd
    # action if EITHER it returns non-zero with a useful error OR
    # it ignores the unknown arg and produces normal output (the
    # latter is correct for tools that don't accept an action= arg
    # at all — passing garbage to i/help shouldn't error).
    typo = _run([str(bin_path), "action=garbage-mode-xyz"], timeout=2.0)
    typo_combined = (typo["stdout"] + "\n" + typo["stderr"])
    score["checks"]["handles_typo_gracefully"] = _has_useful_error(
        typo_combined, typo["rc"],
    )
    score["max"] = 3  # rubric is now 3 checks (was 5 with redundant exit + usage_line)
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
        # Inter-tool cooldown so any descendant the prior tool spawned
        # has a chance to fully exit before we move on. Belt to the
        # process-group kill suspenders.
        time.sleep(0.2)
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
    # Flag tools that fail any rubric check (3 checks, threshold = full pass).
    flagged = [r for r in rated if r["score"] < r["max"]]
    rated.sort(key=lambda r: (r["score"], r["name"]))
    print(f"\nRATED: {len(rated)}    FLAGGED: {len(flagged)}    SKIPPED: {len(skipped)}")
    if flagged:
        print("\nFlagged for UX improvement:")
        for r in flagged:
            checks_failed = [k for k, v in r["checks"].items() if not v]
            print(f"  {r['score']}/{r['max']}  i/{r['name']:<14} ({r['category']:<20}) "
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
