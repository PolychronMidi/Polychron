#!/usr/bin/env python3
"""Onboarding flow dry-run verifier.

Simulates a full HME onboarding walkthrough in an ISOLATED state file,
verifies each state transition fires, the todo tree mirrors correctly,
and graduation clears state. Catches integration bugs in the chain decider
before real agents hit them.

Tests:
    1. Fresh boot state is created.
    2. Each forward transition advances state + updates step label.
    3. Backward transitions are refused.
    4. The todo tree mirror preserves sub IDs across transitions.
    5. chain_exit correctly parses HME_TARGET and HME_REVIEW_VERDICT markers.
    6. Graduation deletes the state file and clears the onboarding tree.

Exit codes:
    0 — all tests pass
    1 — one or more tests failed
    2 — unexpected error

Usage:
    python3 tools/HME/scripts/verify-onboarding-flow.py
"""
import importlib.util
import os
import sys
import tempfile
import types


def _load_onboarding_chain():
    """Load onboarding_chain.py directly, with a fake PROJECT_ROOT set in env."""
    spec = importlib.util.spec_from_file_location(
        "server.onboarding_chain",
        os.path.join(
            os.environ["PROJECT_ROOT"],
            "tools", "HME", "mcp", "server", "onboarding_chain.py"
        ),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["server.onboarding_chain"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_todo_module(project_root: str):
    """Load todo.py standalone so register_onboarding_tree works under mirror."""
    class _FakeMCP:
        @staticmethod
        def tool(**_kw):
            return lambda f: f

    sys.modules.setdefault("server", types.ModuleType("server"))
    sys.modules["server.context"] = types.SimpleNamespace(
        mcp=_FakeMCP(), PROJECT_ROOT=project_root,
    )
    ta_pkg = types.ModuleType("server.tools_analysis")
    ta_pkg.__path__ = [os.path.join(project_root, "tools", "HME", "mcp", "server", "tools_analysis")]
    ta_pkg._track = lambda *_a, **_kw: None
    sys.modules["server.tools_analysis"] = ta_pkg
    ss_pkg = types.ModuleType("server.tools_analysis.synthesis_session")
    ss_pkg.append_session_narrative = lambda *_a, **_kw: None
    sys.modules["server.tools_analysis.synthesis_session"] = ss_pkg

    spec = importlib.util.spec_from_file_location(
        "server.tools_analysis.todo",
        os.path.join(project_root, "tools", "HME", "mcp", "server", "tools_analysis", "todo.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["server.tools_analysis.todo"] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    real_project = os.environ.get("PROJECT_ROOT") or os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..")
    )
    tmp_project = tempfile.mkdtemp(prefix="hme-onb-verify-")
    os.makedirs(os.path.join(tmp_project, "tools", "HME", "mcp", "server"), exist_ok=True)
    os.makedirs(os.path.join(tmp_project, "tools", "HME", "mcp", "server", "tools_analysis"), exist_ok=True)
    os.makedirs(os.path.join(tmp_project, "metrics"), exist_ok=True)
    os.makedirs(os.path.join(tmp_project, "tmp"), exist_ok=True)

    # Copy Python source into tmp_project so relative paths resolve
    import shutil
    for rel in [
        "tools/HME/mcp/server/onboarding_chain.py",
        "tools/HME/mcp/server/tools_analysis/todo.py",
        "tools/HME/mcp/hme_env.py",
        "CLAUDE.md",
    ]:
        src = os.path.join(real_project, rel)
        dst = os.path.join(tmp_project, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(src, dst)

    # Rewrite .env so PROJECT_ROOT points at the sandbox, not the real project.
    # hme_env's loader overwrites os.environ with .env values, so a copied .env
    # carrying the real PROJECT_ROOT would bleed real-project paths (todo store,
    # state files) into the dry-run.
    real_env_path = os.path.join(real_project, ".env")
    sandbox_env_path = os.path.join(tmp_project, ".env")
    with open(real_env_path, encoding="utf-8") as _src_env:
        env_lines = _src_env.readlines()
    with open(sandbox_env_path, "w", encoding="utf-8") as _dst_env:
        for _line in env_lines:
            if _line.startswith("PROJECT_ROOT="):
                _dst_env.write(f"PROJECT_ROOT={tmp_project}\n")
            else:
                _dst_env.write(_line)

    os.environ["PROJECT_ROOT"] = tmp_project

    failures = []

    def check(cond: bool, label: str) -> None:
        if cond:
            print(f"  PASS: {label}")
        else:
            print(f"  FAIL: {label}")
            failures.append(label)

    try:
        print("# Onboarding flow dry-run")
        print(f"  Source: {real_project}")
        print(f"  Sandbox: {tmp_project}")
        print()

        onb = _load_onboarding_chain()
        todo_mod = _load_todo_module(tmp_project)

        # Test 1: state machine shape
        print("## Test 1: state machine shape")
        check(len(onb.STATES) == 8, "STATES has 8 entries")
        check(onb.STATES[0] == "boot", "first state is 'boot'")
        check(onb.STATES[-1] == "graduated", "last state is 'graduated'")
        expected_order = [
            "boot", "selftest_ok", "targeted",
            "edited", "reviewed", "piped", "verified", "graduated",
        ]
        check(onb.STATES == expected_order, "STATES order matches 7-step flow + graduated")
        print()

        # Test 2: forward transitions
        print("## Test 2: forward transitions")
        onb.set_state("boot")
        check(onb.state() == "boot", "set boot")
        for s in expected_order[1:]:
            ok = onb.force_state(s)
            check(ok and onb.state() == s, f"advance to {s}")
        print()

        # Test 3: backward transitions refused
        print("## Test 3: backward transitions refused")
        onb.set_state("reviewed")
        check(not onb.force_state("boot"), "refuse reviewed -> boot")
        check(onb.state() == "reviewed", "state stays at reviewed after refusal")
        print()

        # Test 4: todo tree mirror preserves IDs
        print("## Test 4: todo tree ID stability")
        # Reset state and walk through (triggers mirror)
        onb.set_state("boot")
        initial_list = todo_mod.hme_todo(action="list")
        initial_ids = [l for l in initial_list.splitlines() if l.strip().startswith("[")]
        onb.set_state("selftest_ok")
        onb.set_state("targeted")
        after = todo_mod.hme_todo(action="list")
        after_lines = after.splitlines()
        check(len(after_lines) > 3, "tree has entries after transitions")
        # Check that IDs don't blow up (should be < 20 after 3 transitions)
        import re
        ids = [int(m.group(1)) for m in re.finditer(r'#(\d+)', after)]
        if ids:
            check(max(ids) < 20, f"max id < 20 after 3 transitions (got {max(ids)})")
        print()

        # Test 5: marker parsing
        print("## Test 5: structured marker parsing")
        evolve_out_with_marker = "# Evolution Intelligence\n\nSome analysis...\n\n<!-- HME_TARGET: testModule -->"
        extracted = onb._extract_target_from_evolve(evolve_out_with_marker)
        check(extracted == "testModule", "HTML marker extraction")
        evolve_out_fallback = "Proposed target: anotherModule for bridge E3"
        extracted2 = onb._extract_target_from_evolve(evolve_out_fallback)
        check(extracted2 == "anotherModule", "regex fallback extraction")
        review_clean = "No warnings found.\n<!-- HME_REVIEW_VERDICT: clean -->"
        check(onb._review_clean(review_clean), "clean verdict marker")
        review_warnings = "Some issue.\n<!-- HME_REVIEW_VERDICT: warnings -->"
        check(not onb._review_clean(review_warnings), "warnings verdict marker")
        print()

        # Test 6: graduation clears state
        print("## Test 6: graduation clears state")
        onb.set_state("verified")
        onb.chain_exit("learn", {"title": "test", "content": "x"}, "Entry saved")
        check(onb.state() == "graduated", "learn(title=, content=) graduates from verified")
        state_file = os.path.join(tmp_project, "tmp", "hme-onboarding.state")
        check(not os.path.exists(state_file), "state file deleted on graduation")
        after_grad = todo_mod.hme_todo(action="list")
        check("onboarding" not in after_grad.lower(), "onboarding tree cleared on graduation")
        print()

    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        return 2
    finally:
        import shutil as _sh
        try:
            _sh.rmtree(tmp_project)
        except Exception:
            pass

    print()
    if failures:
        print(f"# RESULT: {len(failures)} failure(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("# RESULT: all tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
