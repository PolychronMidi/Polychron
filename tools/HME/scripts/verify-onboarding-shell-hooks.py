#!/usr/bin/env python3
"""Dynamic proof that the REAL shell-hook advancers fire on their real trigger.

verify-onboarding-flow.py dynamically drives the PYTHON chain but never invokes
the shell hooks -- so the targeted->edited advancer (which lives in
posttooluse_edit.sh, not the python chain) would have passed it while stranding
every agent. This harness closes that gap: it runs the ACTUAL hook scripts from
the repo against an ISOLATED PROJECT_ROOT and asserts the shell-side state
transitions actually happen.

Mechanism: the hooks resolve PROJECT_ROOT from the env when `$PROJECT_ROOT/src`
exists (helpers/safety/project_root.sh), and write onboarding state to
`$PROJECT_ROOT/tmp/hme-onboarding.state`. We build a minimal isolated root
(src/, .env, .git, tmp/), seed a state, feed the hook a realistic tool-event
JSON on stdin, and read the state back.

Cases:
  1. posttooluse_edit.sh: state=targeted + successful src/ edit  -> edited
  2. posttooluse_edit.sh: state=selftest_ok + src/ edit          -> unchanged
     (guard holds: only advances from the exact predecessor)
  3. posttooluse_edit.sh: state=targeted + FAILED edit (is_error) -> unchanged

Exit codes:
  0 -- all cases pass
  1 -- one or more cases failed
  2 -- harness/setup error
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EDIT_HOOK = REPO_ROOT / "tools" / "HME" / "hooks" / "posttooluse" / "posttooluse_edit.sh"
STATE_REL = Path("tmp") / "hme-onboarding.state"


def _make_isolated_root() -> Path:
    # realpath: project_root.sh canonicalizes via `cd && pwd`, so /tmp symlinks
    # (e.g. -> /private/tmp) would make the hook's resolved PROJECT_ROOT differ
    root = Path(os.path.realpath(tempfile.mkdtemp(prefix="hme-onb-shell-")))
    (root / "src").mkdir()
    (root / "tmp").mkdir()
    (root / ".git").mkdir()
    metrics = root / "src" / "output" / "metrics"
    metrics.mkdir(parents=True)
    # project_root.sh sources $root/.env; the bootstrap's _signals.sh requires
    # HME_METRICS_DIR (unbound otherwise -> set -u crash). Provide the minimum
    (root / ".env").write_text(
        f'PROJECT_ROOT="{root}"\n'
        f'HME_METRICS_DIR="{metrics}"\n'
        f'METRICS_DIR="{metrics}"\n'
    )
    return root


def _seed_state(root: Path, state: str) -> None:
    (root / STATE_REL).write_text(state)


def _read_state(root: Path) -> str:
    p = root / STATE_REL
    return p.read_text().strip() if p.exists() else "<deleted>"


def _run_edit_hook(root: Path, event: dict) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PROJECT_ROOT"] = str(root)
    env.pop("CLAUDE_PROJECT_DIR", None)
    return subprocess.run(
        ["bash", str(EDIT_HOOK)],
        input=json.dumps(event),
        capture_output=True, text=True, env=env, cwd=str(root),
    )


def _edit_event(root: Path, *, is_error: bool) -> dict:
    return {
        "tool_input": {"file_path": str(root / "src" / "demo.js")},
        "tool_response": {"is_error": is_error},
    }


def _case(label: str, root: Path, seed: str, event: dict, expect: str) -> bool:
    _seed_state(root, seed)
    proc = _run_edit_hook(root, event)
    got = _read_state(root)
    ok = got == expect
    print(f"  {'PASS' if ok else 'FAIL'}: {label} (seed={seed} -> {got}, expect {expect})")
    if not ok:
        # Self-diagnosing: dump the hook's own view so a failure is actionable
        # without hand-running the hook (which the interactive tmp-guard blocks).
        print(f"    hook exit={proc.returncode}")
        print(f"    edit_file={event.get('tool_input', {}).get('file_path')}")
        if proc.stdout.strip():
            print(f"    stdout: {proc.stdout.strip()[:300]}")
        if proc.stderr.strip():
            print(f"    stderr: {proc.stderr.strip()[:300]}")
    return ok


def main() -> int:
    if not EDIT_HOOK.is_file():
        print(f"harness error: hook not found: {EDIT_HOOK}", file=sys.stderr)
        return 2
    root = _make_isolated_root()
    try:
        print("# posttooluse_edit.sh shell-advancer proof (real hook, isolated root)")
        results = [
            _case(
                "targeted + clean src edit advances to edited",
                root, "targeted", _edit_event(root, is_error=False), "edited",
            ),
            _case(
                "wrong predecessor (selftest_ok) does not advance",
                root, "selftest_ok", _edit_event(root, is_error=False), "selftest_ok",
            ),
            _case(
                "failed edit does not advance",
                root, "targeted", _edit_event(root, is_error=True), "targeted",
            ),
        ]
    finally:
        shutil.rmtree(root, ignore_errors=True)

    if all(results):
        print("# RESULT: all shell-hook advancer cases passed")
        return 0
    print("# RESULT: shell-hook advancer proof FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
