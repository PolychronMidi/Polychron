"""Shared helpers for verifier smoke tests.

Each `<module>.test.py` under tools/HME/tests/specs/ uses these helpers
to exercise the verifier classes its module exports: class-attribute
checks (name/category/weight/kind), canonical-name set check, and an
isolated-tmpdir smoke run that asserts run() returns a valid
VerdictResult without crashing. Per-module specs add behavioural
tests on top of this base.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = REPO_ROOT / "tools" / "HME" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def purge_modules() -> None:
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)


def with_project_root(tmpdir, fn):
    """Run fn() with PROJECT_ROOT pointed at a temp dir; restore on exit."""
    prior_pr = os.environ.get("PROJECT_ROOT")
    prior_m = os.environ.get("HME_METRICS_DIR")
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    os.environ["HME_METRICS_DIR"] = str(Path(tmpdir) / "metrics")
    purge_modules()
    try:
        return fn()
    finally:
        if prior_pr is None:
            os.environ.pop("PROJECT_ROOT", None)
        else:
            os.environ["PROJECT_ROOT"] = prior_pr
        if prior_m is None:
            os.environ.pop("HME_METRICS_DIR", None)
        else:
            os.environ["HME_METRICS_DIR"] = prior_m
        purge_modules()


VALID_STATUSES = {"PASS", "WARN", "FAIL", "SKIP", "ERROR"}
VALID_KINDS = {"static", "runtime"}


def assert_class_shape(tc: unittest.TestCase, cls) -> None:
    """Common class-attribute assertions for every Verifier subclass."""
    name = getattr(cls, "name", None)
    tc.assertIsInstance(name, str, msg=f"{cls.__name__}.name not a str")
    tc.assertTrue(name, msg=f"{cls.__name__}.name is empty")
    tc.assertIsInstance(getattr(cls, "category", None), str,
                        msg=f"{cls.__name__}.category not a str")
    tc.assertIsInstance(getattr(cls, "weight", None), (int, float),
                        msg=f"{cls.__name__}.weight not numeric")
    tc.assertIn(getattr(cls, "kind", "static"), VALID_KINDS,
                msg=f"{cls.__name__}.kind invalid")


def smoke_run(tc: unittest.TestCase, tmpdir, classes) -> None:
    """Call .execute() on every class in `classes` under PROJECT_ROOT=tmpdir;
    assert each returns a VerdictResult with a valid status and 0<=score<=1."""
    from verify_coherence._base import VerdictResult

    def _do():
        results = []
        for cls in classes:
            r = cls().execute()
            results.append((cls.__name__, r))
        return results

    results = with_project_root(tmpdir, _do)
    for name, r in results:
        tc.assertIsInstance(r, VerdictResult, msg=f"{name}: {type(r)}")
        tc.assertIn(r.status, VALID_STATUSES, msg=f"{name}: status={r.status!r}")
        tc.assertGreaterEqual(r.score, 0.0, msg=f"{name}: score={r.score}")
        tc.assertLessEqual(r.score, 1.0, msg=f"{name}: score={r.score}")
