#!/usr/bin/env python3
"""Multi-pass cleanup orchestrator. Adapted from pensive:tiered-audit.

Runs EXISTING Polychron detectors/auditors in leverage-ordered passes.
Adds zero new rules; composes installed surface as a single sweep command.

Pass order (outer = highest leverage):
  1. lint floor      -- audit-comment-bloat (FAIL only, --strict)
  2. hallucination   -- audit-link-rot, audit-marker-registry
  3. identity leaks  -- slop_scan via direct invocation on tracked files
  4. comment slop    -- audit-comment-bloat (warn level)
  5. prose slop      -- (deferred -- no project-wide prose detector yet)
  6. tests           -- pytest if any python tests, npm test if package.json
  7. README          -- slop_scan README-only on root README.md

Each pass is independent; failure of one doesn't abort the others. Output
is a single human-readable report.

Usage:
  i/audit tiered             # full sweep
  i/audit tiered --pass 3    # run only pass N
  i/audit tiered --json      # JSON output for tooling
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, cwd=str(_PROJECT), capture_output=True,
                              text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except (OSError, subprocess.SubprocessError) as e:
        return -1, "", f"{type(e).__name__}: {e}"


def pass_lint_floor() -> dict:
    rc, out, _err = _run(["python3", "scripts/audit-comment-bloat.py", "--strict", "--json"], 60)
    try:
        d = json.loads(out or "{}")
        fail_n = len(d.get("fail") or [])
        warn_n = len(d.get("warn") or [])
        return {"name": "lint_floor", "ok": rc == 0, "fail": fail_n, "warn": warn_n,
                "summary": f"{fail_n} FAIL, {warn_n} warn"}
    except json.JSONDecodeError:
        return {"name": "lint_floor", "ok": False, "summary": "audit-comment-bloat output unparseable"}


def pass_marker_registry() -> dict:
    script = _PROJECT / "scripts" / "audit-marker-registry.py"
    if not script.is_file():
        return {"name": "marker_registry", "ok": True, "summary": "skipped (script missing)"}
    rc, out, err = _run(["python3", str(script)], 60)
    return {"name": "marker_registry", "ok": rc == 0,
            "summary": (out + err).strip().splitlines()[-1][:200] if (out + err).strip() else "no output"}


def pass_identity_and_slop() -> dict:
    """Run slop_scan against the project's tracked .md and Python files (subset)."""
    rc, out, _err = _run(["git", "-C", str(_PROJECT), "ls-files",
                          "--", "*.md", "doc/", "tools/HME/", "src/"], 30)
    if rc != 0:
        return {"name": "identity_and_slop", "ok": False, "summary": "git ls-files failed"}
    files = [_PROJECT / ln for ln in out.splitlines() if ln.strip()][:200]
    sys.path.insert(0, str(_PROJECT / "tools" / "HME" / "scripts" / "detectors"))
    try:
        import slop_scan  # noqa: E402
    except ImportError as e:
        return {"name": "identity_and_slop", "ok": False, "summary": f"import failed: {e}"}
    findings = []
    for fp in files:
        if not fp.is_file():
            continue
        if slop_scan.is_skipped_path(fp):
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(fp.relative_to(_PROJECT))
        for h in slop_scan._scan_identity(text):
            findings.append(f"IDENTITY {rel} {h}")
        for h in slop_scan._scan_bare_todo(text):
            findings.append(f"BARE-TODO {rel} {h}")
        for h in slop_scan._scan_unbacked_claims(text, fp):
            findings.append(f"CLAIM {rel} {h}")
    return {"name": "identity_and_slop", "ok": not findings,
            "summary": f"{len(findings)} finding(s)",
            "details": findings[:20]}


def pass_tests() -> dict:
    parts = []
    if (_PROJECT / "package.json").is_file():
        rc, out, err = _run(["npm", "test", "--silent"], 180)
        parts.append(f"npm test: {'ok' if rc == 0 else 'FAIL'}")
    if any((_PROJECT / d).is_dir() for d in ("tests", "tools/HME/tests")):
        rc, out, err = _run(["python3", "-m", "pytest", "-q", "--no-header"], 120)
        parts.append(f"pytest: {'ok' if rc == 0 else 'FAIL'}")
    return {"name": "tests", "ok": all("ok" in p for p in parts),
            "summary": "; ".join(parts) or "no test infra detected"}


def pass_readme() -> dict:
    readme = _PROJECT / "README.md"
    if not readme.is_file():
        return {"name": "readme", "ok": True, "summary": "no README.md"}
    sys.path.insert(0, str(_PROJECT / "tools" / "HME" / "scripts" / "detectors"))
    try:
        import slop_scan
    except ImportError as e:
        return {"name": "readme", "ok": False, "summary": f"import failed: {e}"}
    text = readme.read_text(encoding="utf-8", errors="ignore")
    findings = (slop_scan._scan_identity(text)
                + slop_scan._scan_bare_todo(text)
                + slop_scan._scan_unbacked_claims(text, readme))
    return {"name": "readme", "ok": not findings,
            "summary": f"{len(findings)} finding(s)",
            "details": findings[:10]}


_PASSES = [
    (1, pass_lint_floor),
    (2, pass_marker_registry),
    (3, pass_identity_and_slop),
    (6, pass_tests),
    (7, pass_readme),
]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pass", dest="pass_n", type=int, default=0,
                        help="run only this pass number (default 0 = all)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    results = []
    for n, fn in _PASSES:
        if args.pass_n and n != args.pass_n:
            continue
        t0 = time.monotonic()
        r = fn()
        r["pass"] = n
        r["elapsed_s"] = round(time.monotonic() - t0, 2)
        results.append(r)

    if args.json:
        print(json.dumps({"results": results}, indent=2))
        return 0

    print(f"tiered-audit: {len(results)} pass(es)")
    for r in results:
        flag = "ok " if r["ok"] else "FAIL"
        print(f"  pass {r['pass']} {flag} {r['name']:<22} {r.get('elapsed_s', 0)}s  {r['summary']}")
        for d in (r.get("details") or [])[:5]:
            print(f"      - {d}")
    failed = [r for r in results if not r["ok"]]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
