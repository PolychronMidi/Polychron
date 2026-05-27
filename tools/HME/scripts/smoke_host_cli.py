#!/usr/bin/env python3
"""CLI smoke test framework for HME's three hosts (claude, codex, opencode).

Drives each host's non-interactive CLI with a prompt that exercises the
TodoWrite + Read + Write + Edit tool surface, then measures:

  - did the host complete without hitting a timeout
  - did any todowrite call produce a schema error (loop signal)
  - how many tool calls were issued (excessive count = looping)
  - did the smoke artifact end up with the expected content (Edit success)

Usage:
    python3 tools/HME/scripts/smoke_host_cli.py --host claude
    python3 tools/HME/scripts/smoke_host_cli.py --host codex
    python3 tools/HME/scripts/smoke_host_cli.py --host opencode
    python3 tools/HME/scripts/smoke_host_cli.py --all
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
SMOKE_DIR = PROJECT_ROOT / "tools" / "HME" / "runtime" / "smoke"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"
RELAY_LOG = PROJECT_ROOT / "tools" / "HME" / "runtime" / "opencode-plugin-relay.jsonl"


def smoke_prompt(artifact_path: Path) -> str:
    rel = artifact_path.relative_to(PROJECT_ROOT)
    return (
        f"Smoke test the tool surface in this exact order, then summarize. "
        f"Use the TodoWrite tool to record progress. "
        f"(1) Create two todos: 'smoke read' and 'smoke write-edit'. "
        f"(2) Use the Read tool to read README.md and quote its first line. "
        f"(3) Mark 'smoke read' completed. "
        f"(4) Use the Write tool to create {rel} with the single line "
        f"'smoke test passed'. "
        f"(5) Use the Edit tool to replace 'passed' with 'verified' in "
        f"that same file. "
        f"(6) Mark 'smoke write-edit' completed. "
        f"Do not exceed two todowrite calls per todo state transition."
    )


def cli_argv(host: str, prompt: str) -> list[str]:
    if host == "claude":
        return ["claude", "-p", prompt, "--allow-dangerously-skip-permissions"]
    if host == "codex":
        return ["codex", "exec", prompt]
    if host == "opencode":
        return ["opencode", "run", prompt]
    raise ValueError(f"unknown host {host!r}")


def _count_log_lines(path: Path, needles: tuple[str, ...]) -> int:
    if not path.is_file():
        return 0
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return 0
    return sum(1 for line in text.splitlines() if any(n in line for n in needles))


def _opencode_todowrite_count(session_started_ms: int) -> int:
    db = Path.home() / ".local" / "share" / "opencode" / "opencode.db"
    if not db.is_file():
        return 0
    try:
        import sqlite3
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        cur = conn.execute(
            "SELECT COUNT(*) FROM part WHERE time_created > ? "
            "AND json_extract(data, '$.type') = 'tool' "
            "AND json_extract(data, '$.tool') = 'todowrite'",
            (session_started_ms,),
        )
        n = int(cur.fetchone()[0] or 0)
        conn.close()
        return n
    except Exception:
        return 0


def run_smoke(host: str, timeout: int = 120) -> dict:
    SMOKE_DIR.mkdir(parents=True, exist_ok=True)
    artifact = SMOKE_DIR / f"{host}-{int(time.time())}.txt"
    if artifact.exists():
        artifact.unlink()
    prompt = smoke_prompt(artifact)
    argv = cli_argv(host, prompt)
    if not shutil.which(argv[0]):
        return {"host": host, "ok": False, "skipped": True,
                "reason": f"{argv[0]} not on PATH"}

    schema_err_before = _count_log_lines(ERROR_LOG, ("SchemaError", "Todos failed"))
    start_ms = int(time.time() * 1000)
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            argv, cwd=PROJECT_ROOT, capture_output=True, text=True,
            timeout=timeout, env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)},
        )
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        proc = subprocess.CompletedProcess(argv, returncode=-1,
                                            stdout=exc.stdout or "",
                                            stderr=exc.stderr or "")
        timed_out = True
    elapsed = time.perf_counter() - start
    schema_err_after = _count_log_lines(ERROR_LOG, ("SchemaError", "Todos failed"))

    artifact_text = artifact.read_text(encoding="utf-8") if artifact.is_file() else ""
    artifact_has_verified = "verified" in artifact_text
    artifact_has_passed = "passed" in artifact_text and "verified" not in artifact_text

    todowrite_calls = _opencode_todowrite_count(start_ms) if host == "opencode" else None

    failures: list[str] = []
    if timed_out:
        failures.append(f"timed out after {timeout}s")
    if proc.returncode not in (0, None) and not timed_out:
        failures.append(f"exit code {proc.returncode}")
    if (schema_err_after - schema_err_before) > 0:
        failures.append(f"{schema_err_after - schema_err_before} new todowrite schema error(s)")
    if not artifact.is_file():
        failures.append("Write/Edit artifact missing -- tool did not run")
    elif artifact_has_passed:
        failures.append("Edit tool did not replace 'passed' with 'verified'")
    if todowrite_calls is not None and todowrite_calls > 8:
        failures.append(f"todowrite called {todowrite_calls} times (loop signal)")

    return {
        "host": host,
        "ok": not failures,
        "elapsed_sec": round(elapsed, 1),
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "todowrite_calls": todowrite_calls,
        "schema_errors_new": schema_err_after - schema_err_before,
        "artifact_path": str(artifact),
        "artifact_present": artifact.is_file(),
        "artifact_verified": artifact_has_verified,
        "stdout_tail": (proc.stdout or "")[-400:],
        "stderr_tail": (proc.stderr or "")[-400:],
        "failures": failures,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", choices=["claude", "codex", "opencode"])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    hosts = ["claude", "codex", "opencode"] if args.all else [args.host]
    if not hosts or hosts == [None]:
        ap.error("specify --host or --all")
    results = [run_smoke(h, timeout=args.timeout) for h in hosts]

    if args.json:
        print(json.dumps(results, indent=2))
        return 0 if all(r.get("ok") or r.get("skipped") for r in results) else 1

    overall_ok = True
    for r in results:
        if r.get("skipped"):
            print(f"[SKIP] {r['host']}: {r['reason']}")
            continue
        tag = "PASS" if r["ok"] else "FAIL"
        if not r["ok"]:
            overall_ok = False
        extras = []
        if r.get("todowrite_calls") is not None:
            extras.append(f"todowrites={r['todowrite_calls']}")
        if r.get("schema_errors_new"):
            extras.append(f"schema_errs={r['schema_errors_new']}")
        if r.get("artifact_verified"):
            extras.append("artifact_verified=yes")
        print(f"[{tag}] {r['host']:9s} elapsed={r['elapsed_sec']:>5.1f}s "
              f"exit={r['exit_code']:>3} {' '.join(extras)}")
        for f in r.get("failures", []):
            print(f"       - {f}")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
