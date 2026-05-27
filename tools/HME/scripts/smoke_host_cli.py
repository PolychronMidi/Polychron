#!/usr/bin/env python3
"""Self-contained CLI smoke tests for HME hosts: claude, codex, opencode.

This is a real end-to-end smoke harness, not a convenience wrapper. It:
  - discovers each host CLI, including known opencode install locations
  - preflights HME proxy health for hosts configured to use the HME provider
  - uses bypass/auto-approve flags so no manual permission prompt can hang it
  - writes to a unique runtime artifact path and validates Write+Edit worked
  - captures host-specific loop signals (opencode todowrite count/schema errors)
  - emits actionable failure reasons and tails of stdout/stderr

Examples:
  python3 tools/HME/scripts/smoke_host_cli.py --host opencode --timeout 180
  python3 tools/HME/scripts/smoke_host_cli.py --all --json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
SMOKE_DIR = PROJECT_ROOT / "tools" / "HME" / "runtime" / "smoke"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"
OPENCODE_DB = Path.home() / ".local" / "share" / "opencode" / "opencode.db"
OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "opencode.jsonc"

HOSTS = ("claude", "codex", "opencode")


def _strip_jsonc(text: str) -> str:
    out: list[str] = []
    in_string = False
    escape = False
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_string:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and nxt == "/":
            while i < len(text) and text[i] not in "\r\n":
                i += 1
            continue
        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < len(text) and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _which_host(host: str) -> str | None:
    found = shutil.which(host)
    if found:
        return found
    if host == "opencode":
        candidates = [
            Path.home() / ".npm" / "_npx" / "e2094862b59aac7b" / "node_modules" / "opencode-linux-x64" / "bin" / "opencode",
            PROJECT_ROOT / "tools" / "opencode" / "packages" / "opencode" / "bin" / "opencode",
        ]
        for c in candidates:
            if c.is_file() and os.access(c, os.X_OK):
                return str(c)
    return None


def _service_port(name: str = "proxy") -> int:
    js = "const {servicePort}=require('./tools/HME/proxy/service_registry'); process.stdout.write(String(servicePort(process.argv[1])));"
    try:
        out = subprocess.check_output(["node", "-e", js, name], cwd=PROJECT_ROOT, text=True, timeout=5)
        return int(out.strip())
    except Exception:
        return 9099


def _http_ok(url: str, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= int(resp.status) < 300
    except Exception:
        return False


def _local_health_url(base_url: str) -> str | None:
    if not base_url.startswith("http://127.0.0.1:") and not base_url.startswith("http://localhost:"):
        return None
    head = base_url.split("/v1", 1)[0].rstrip("/")
    return f"{head}/health"


def _host_health_urls(host: str) -> list[str]:
    urls: list[str] = []
    if host == "claude":
        settings = Path.home() / ".claude" / "settings.json"
        try:
            doc = json.loads(settings.read_text(encoding="utf-8"))
            env = doc.get("env", {}) if isinstance(doc, dict) else {}
            base = str(env.get("ANTHROPIC_BASE_URL") or "")
            url = _local_health_url(base)
            if url:
                urls.append(url)
        except Exception:
            pass  # silent-ok: pending review
    elif host == "codex":
        cfg = Path.home() / ".codex" / "config.toml"
        if cfg.is_file():
            for line in cfg.read_text(encoding="utf-8", errors="ignore").splitlines():
                if "base_url" not in line:
                    continue
                _, _, raw = line.partition("=")
                base = raw.strip().strip('"').strip("'")
                url = _local_health_url(base)
                if url and url not in urls:
                    urls.append(url)
    elif host == "opencode":
        if OPENCODE_CONFIG.is_file():
            try:
                doc = json.loads(_strip_jsonc(OPENCODE_CONFIG.read_text(encoding="utf-8")))
                blob = json.dumps(doc)
                if str(doc.get("model") or "").startswith("hme/") or "127.0.0.1:9099" in blob:
                    urls.append("http://127.0.0.1:9099/health")
            except Exception:
                pass  # silent-ok: pending review
    return urls


def preflight(host: str, no_proxy_check: bool = False) -> list[str]:
    issues: list[str] = []
    if not _which_host(host):
        issues.append(f"{host} CLI not found on PATH or known install locations")
    if not no_proxy_check:
        for url in _host_health_urls(host):
            if not _http_ok(url):
                issues.append(f"{host} configured for local provider but health check failed: {url}")
    return issues


def smoke_prompt(artifact_path: Path) -> str:
    readme = PROJECT_ROOT / "README.md"
    return "\n".join([
        "You are running an automated HME CLI smoke test. Complete exactly these steps and then stop.",
        "Use the todo tool to track progress; keep the list small and update statuses normally.",
        "Use exact paths only. Do not glob, search, list directories, or discover README files.",
        "1. Create two todos: 'smoke read' and 'smoke write edit'.",
        f"2. Read exactly {readme} and remember its first line.",
        "3. Mark 'smoke read' completed.",
        f"4. Write exactly this one line to {artifact_path}: smoke test passed",
        f"5. Edit {artifact_path}, replacing 'passed' with 'verified'.",
        "6. Mark 'smoke write edit' completed.",
        "7. Reply with one concise sentence containing the README first line and the artifact path.",
        "Do not loop. Do not repeat completed todo updates.",
    ])


def cli_argv(host: str, prompt: str) -> list[str]:
    exe = _which_host(host) or host
    if host == "claude":
        return [
            exe, "-p", prompt,
            "--permission-mode", "bypassPermissions",
            "--allowedTools", "Read,Write,Edit,TodoWrite",
            "--output-format", "text",
        ]
    if host == "codex":
        return [
            exe, "exec",
            "--dangerously-bypass-approvals-and-sandbox",
            "--dangerously-bypass-hook-trust",
            "--sandbox", "danger-full-access",
            "--cd", str(PROJECT_ROOT),
            prompt,
        ]
    if host == "opencode":
        return [
            exe, "run",
            "--dangerously-skip-permissions",
            "--format", "json",
            prompt,
        ]
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
    if not OPENCODE_DB.is_file():
        return 0
    try:
        import sqlite3
        conn = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True)
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


def _opencode_tool_counts(session_started_ms: int) -> dict[str, int]:
    if not OPENCODE_DB.is_file():
        return {}
    try:
        import sqlite3
        conn = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True)
        cur = conn.execute(
            "SELECT json_extract(data, '$.tool') AS tool, COUNT(*) FROM part "
            "WHERE time_created > ? AND json_extract(data, '$.type') = 'tool' "
            "GROUP BY tool ORDER BY COUNT(*) DESC",
            (session_started_ms,),
        )
        out = {str(k): int(v) for k, v in cur.fetchall() if k}
        conn.close()
        return out
    except Exception:
        return {}


def _classify_stderr(stderr: str) -> list[str]:
    hints: list[str] = []
    s = stderr or ""
    if "SchemaError" in s or "Todos failed" in s:
        hints.append("todowrite schema rejection")
    if "permission" in s.lower() and ("denied" in s.lower() or "approval" in s.lower()):
        hints.append("permission prompt/denial")
    if "ECONNREFUSED" in s or "connection refused" in s.lower():
        hints.append("provider/proxy connection refused")
    if "rate limit" in s.lower():
        hints.append("provider rate limit")
    return hints


def run_smoke(host: str, timeout: int = 180, no_proxy_check: bool = False) -> dict[str, Any]:
    SMOKE_DIR.mkdir(parents=True, exist_ok=True)
    artifact = SMOKE_DIR / f"{host}-{int(time.time())}.txt"
    artifact.unlink(missing_ok=True)

    preflight_issues = preflight(host, no_proxy_check=no_proxy_check)
    if preflight_issues:
        return {
            "host": host,
            "ok": False,
            "skipped": True,
            "preflight_failed": True,
            "failures": preflight_issues,
            "artifact_path": str(artifact),
        }

    prompt = smoke_prompt(artifact)
    argv = cli_argv(host, prompt)
    schema_err_before = _count_log_lines(ERROR_LOG, ("SchemaError", "Todos failed"))
    start_ms = int(time.time() * 1000)
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            argv, cwd=PROJECT_ROOT, input="", capture_output=True, text=True,
            timeout=timeout,
            env={
                **os.environ,
                "PROJECT_ROOT": str(PROJECT_ROOT),
                "HME_CLI_SMOKE": "1",
            },
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
    opencode_tools = _opencode_tool_counts(start_ms) if host == "opencode" else {}
    todowrite_calls = opencode_tools.get("todowrite") if host == "opencode" else None

    failures: list[str] = []
    if timed_out:
        failures.append(f"timed out after {timeout}s")
    if proc.returncode not in (0, None) and not timed_out:
        failures.append(f"exit code {proc.returncode}")
    new_schema_errors = schema_err_after - schema_err_before
    if new_schema_errors > 0:
        failures.append(f"{new_schema_errors} new todowrite schema error(s)")
    if not artifact.is_file():
        failures.append("Write/Edit artifact missing: host did not complete tool sequence")
    elif artifact_has_passed:
        failures.append("Edit tool did not replace 'passed' with 'verified'")
    elif not artifact_has_verified:
        failures.append("artifact exists but does not contain expected 'verified' content")
    if todowrite_calls is not None and todowrite_calls > 8:
        failures.append(f"todowrite called {todowrite_calls} times (loop signal)")
    failures.extend(_classify_stderr(str(proc.stderr or "")))

    return {
        "host": host,
        "ok": not failures,
        "elapsed_sec": round(elapsed, 1),
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "argv": argv[:3] + (["..."] if len(argv) > 3 else []),
        "todowrite_calls": todowrite_calls,
        "opencode_tool_counts": opencode_tools,
        "schema_errors_new": new_schema_errors,
        "artifact_path": str(artifact),
        "artifact_present": artifact.is_file(),
        "artifact_verified": artifact_has_verified,
        "stdout_tail": str(proc.stdout or "")[-1200:],
        "stderr_tail": str(proc.stderr or "")[-1200:],
        "failures": failures,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", choices=HOSTS)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-proxy-check", action="store_true")
    args = ap.parse_args()

    hosts = list(HOSTS) if args.all else [args.host]
    if not hosts or hosts == [None]:
        ap.error("specify --host or --all")
    results = [run_smoke(h, timeout=args.timeout, no_proxy_check=args.no_proxy_check) for h in hosts]

    if args.json:
        print(json.dumps(results, indent=2))
        return 0 if all(r.get("ok") for r in results) else 1

    overall_ok = True
    for r in results:
        if r.get("skipped"):
            overall_ok = False
            print(f"[FAIL] {r['host']:9s} preflight failed")
            for f in r.get("failures", []):
                print(f"       - {f}")
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
        if r.get("opencode_tool_counts"):
            extras.append(f"tools={r['opencode_tool_counts']}")
        print(f"[{tag}] {r['host']:9s} elapsed={r['elapsed_sec']:>5.1f}s exit={r['exit_code']:>3} {' '.join(extras)}")
        for f in r.get("failures", []):
            print(f"       - {f}")
        if not r["ok"]:
            if r.get("stderr_tail"):
                print("       stderr_tail:", r["stderr_tail"].replace("\n", "\\n")[-500:])
            if r.get("stdout_tail"):
                print("       stdout_tail:", r["stdout_tail"].replace("\n", "\\n")[-500:])
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
