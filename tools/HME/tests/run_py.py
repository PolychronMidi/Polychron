#!/usr/bin/env python3
"""HME Python-spec runner -- the Python leg of the test suite.

`tools/HME/tests/run.js` only runs *.test.js. Python specs (verify_coherence
verifiers, consult, todo_engine, etc.) had NO runner: a bare `python3 <spec>`
either passed by luck or failed with a missing-env KeyError, so a real Python
regression could land green in any normal test run. This runner closes that gap.

Each spec runs in an isolated child process (global import stubs cannot leak
between files), with the canonical env injected once here -- the same keys the
.env / Node runner provide -- so specs never depend on the caller's shell.

Run:  python3 tools/HME/tests/run_py.py
      npm run test:hme:py
Exits nonzero if any spec fails.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Canonical env parity (mirrors helpers.py / specenv.py / the Node runner's .env
# load). setdefault never overrides a value the caller already exported.
_ENV_DEFAULTS = {
    "PROJECT_ROOT": str(REPO_ROOT),
    "HME_METRICS_DIR": str(REPO_ROOT / "tools/HME/runtime/metrics"),
    "METRICS_DIR": str(REPO_ROOT / "src/output/metrics"),
    "HME_IGNORE_DIRS": "node_modules,.git,tmp,log,runtime",
    "HME_IGNORE_FILES": "package-lock.json,pnpm-lock.yaml",
    "HME_IGNORE_EXTS": ".log,.jsonl,.tmp",
    "HME_WORKER_PORT": "9098",
}

SPEC_DIRS = [REPO_ROOT / "tools/HME/tests/specs", REPO_ROOT / "teams"]
SPEC_TIMEOUT_S = int(os.environ.get("HME_PY_SPEC_TIMEOUT_S", "180"))


def _discover() -> list[Path]:
    out: list[Path] = []
    for base in SPEC_DIRS:
        if base.is_dir():
            out.extend(sorted(base.rglob("*.test.py")))
    return out


def main() -> int:
    env = dict(os.environ)
    for key, val in _ENV_DEFAULTS.items():
        env.setdefault(key, val)

    specs = _discover()
    if not specs:
        print("[hme-py-tests] no *.test.py specs found", file=sys.stderr)
        return 1

    started = time.time()
    failures: list[tuple[str, int]] = []
    for spec in specs:
        rel = spec.relative_to(REPO_ROOT)
        print(f"[hme-py-tests] running {rel}", file=sys.stderr)
        try:
            r = subprocess.run(
                [sys.executable, str(spec)],
                cwd=str(REPO_ROOT), env=env,
                capture_output=True, text=True, timeout=SPEC_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            print(f"[hme-py-tests] TIMEOUT {rel} after {SPEC_TIMEOUT_S}s", file=sys.stderr)
            failures.append((str(rel), 124))
            continue
        if r.returncode != 0:
            tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
            print(f"[hme-py-tests] FAIL {rel} exit={r.returncode}", file=sys.stderr)
            for line in tail:
                print(f"    {line}", file=sys.stderr)
            failures.append((str(rel), r.returncode))

    elapsed = int((time.time() - started) * 1000)
    if failures:
        print(f"\n[hme-py-tests] {len(failures)} of {len(specs)} spec file(s) failed:", file=sys.stderr)
        for name, code in failures:
            print(f"  {name} exit={code}", file=sys.stderr)
        return 1
    print(f"[hme-py-tests] all {len(specs)} spec files passed in {elapsed}ms", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
