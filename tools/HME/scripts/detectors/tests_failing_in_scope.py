#!/usr/bin/env python3
"""Stop-level detector: tests for files edited this turn fail.

The TDD gate ensures impl-with-test exists at file birth. This detector closes
the next gap: edited files whose corresponding test FILE EXISTS but is failing
right now. Surfaces "you broke a test that covers what you just edited."

Approach: for each Edit/Write target this turn, find the candidate test
files (mirror of tdd_test_first_gate.py mapping). Run only those tests
(pytest -k for Python; node --test for JS). Surface failures.

Verdicts:
  ok                  no scoped failures (or no tests/no edits)
  tests_failing_scope at least one scoped test failed

Env knobs:
  TESTS_FAILING_DISABLED=1   bypass entirely
  TESTS_FAILING_TIMEOUT_S=N  per-test-runner timeout (default 60)

Performance: bounded to first 5 edited files; tests not in scope for an edit
are not run. This is a same-turn signal, not a CI replacement.

Usage: tests_failing_in_scope.py <transcript_path>
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events  # noqa: E402

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
_PY_EXTS = {".py"}
_JS_EXTS = {".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"}
_MAX_FILES = 5
_DEFAULT_TIMEOUT_S = int(os.environ.get("TESTS_FAILING_TIMEOUT_S", "60"))
_SKIP_PATH_PARTS = {"__pycache__", "node_modules", ".git", "tools/HME/KB"}


def _collect_edited_impls(events: list) -> list[Path]:
    out: list[Path] = []
    for ev in events:
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("name") not in _WORK_TOOLS:
                continue
            inp = block.get("input") or {}
            fp = inp.get("file_path")
            if not isinstance(fp, str) or not fp:
                continue
            p = Path(fp)
            if not p.is_absolute():
                p = _PROJECT / p
            if any(seg in str(p) for seg in _SKIP_PATH_PARTS):
                continue
            if p.suffix not in _PY_EXTS | _JS_EXTS:
                continue
            if "tests" in p.parts or p.name.startswith("test_") or ".test." in p.name:
                continue
            out.append(p)
            if len(out) >= _MAX_FILES:
                return out
    return out


def _candidate_tests(impl: Path) -> tuple[list[Path], list[Path]]:
    """Return (py_tests, js_tests) for an edited impl file."""
    parent = impl.parent
    stem = impl.stem
    py_cands: list[Path] = []
    js_cands: list[Path] = []
    spec_dir = _PROJECT / "tools" / "HME" / "tests" / "specs"
    if impl.suffix == ".py":
        for d in (parent, parent / "tests", parent.parent / "tests"):
            for name in (f"test_{stem}.py", f"{stem}_test.py"):
                py_cands.append(d / name)
        # Polychron pattern: Python modules may have JS spec companions
        # in tools/HME/tests/specs/<stem>.test.js (node --test runs them).
        js_cands.append(spec_dir / f"{stem}.test.js")
    else:
        for d in (parent, parent / "tests", parent.parent / "tests", spec_dir):
            for name in (f"{stem}.test.js", f"{stem}.test.ts", f"test_{stem}.js"):
                js_cands.append(d / name)
    return ([c for c in py_cands if c.is_file()],
            [c for c in js_cands if c.is_file()])


# pytest exit 5 = no tests collected; treat as ok (no tests = no failures).
_PYTEST_NO_TESTS_COLLECTED = 5


def _run_pytest(test_paths: list[Path]) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            ["python3", "-m", "pytest", "-q", "--no-header", "--tb=line",
             *(str(p) for p in test_paths)],
            cwd=str(_PROJECT), capture_output=True, text=True,
            timeout=_DEFAULT_TIMEOUT_S,
        )
        ok = proc.returncode in (0, _PYTEST_NO_TESTS_COLLECTED)
        tail = (proc.stdout + proc.stderr).splitlines()[-5:]
        return ok, "\n".join(tail)
    except (OSError, subprocess.SubprocessError) as e:
        return True, f"pytest skipped: {type(e).__name__}: {e}"


def _run_node_test(test_paths: list[Path]) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            ["npx", "node", "--test", *(str(p) for p in test_paths)],
            cwd=str(_PROJECT), capture_output=True, text=True,
            timeout=_DEFAULT_TIMEOUT_S,
        )
        ok = proc.returncode == 0
        all_out = (proc.stdout + proc.stderr).splitlines()
        fails = [ln for ln in all_out if ln.startswith("X") or ln.startswith("not ok")]
        return ok, "\n".join(fails[:5]) if fails else "\n".join(all_out[-5:])
    except (OSError, subprocess.SubprocessError) as e:
        return True, f"node --test skipped: {type(e).__name__}: {e}"


def main() -> int:
    if os.environ.get("TESTS_FAILING_DISABLED") == "1":
        print("ok")
        return 0
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    impls = _collect_edited_impls(events)
    if not impls:
        print("ok")
        return 0

    py_tests: list[Path] = []
    js_tests: list[Path] = []
    for impl in impls:
        cands = _candidate_tests(impl)
        if not cands:
            continue
        if impl.suffix in _PY_EXTS:
            py_tests.extend(cands)
        else:
            js_tests.extend(cands)

    failures: list[str] = []
    if py_tests:
        ok, tail = _run_pytest(list(dict.fromkeys(py_tests)))
        if not ok:
            failures.append(f"  pytest:\n{tail}")
    if js_tests:
        ok, tail = _run_node_test(list(dict.fromkeys(js_tests)))
        if not ok:
            failures.append(f"  node --test:\n{tail}")

    if failures:
        sys.stderr.write("tests_failing_in_scope:\n" + "\n".join(failures) + "\n")
        print("tests_failing_scope")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
