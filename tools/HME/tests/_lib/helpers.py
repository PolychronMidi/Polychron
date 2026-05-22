"""Shared test helpers for verify_coherence specs.

Every spec under tools/HME/tests/specs/<module>.test.py used to redefine
its own _purge / _with_project_root / _write / _init_git_repo / mock-
~/.claude/settings.json scaffolding. This module is the canonical home
for all of it. Specs import what they need with one line.

Public helpers:
  purge_modules()               -- clear verify_coherence.* from sys.modules
  with_project_root(tmp, fn)    -- run fn under PROJECT_ROOT=tmp
  with_home_settings(...)       -- mock ~/.claude/settings.json
  write_file(root, rel, body)   -- mkdir + write atomic
  init_git_repo(root)           -- `git init`, configure user, seed commit
  stage_file(root, rel, body)   -- write + git add
  assert_class_shape(tc, cls)   -- common Verifier subclass assertions
  smoke_run(tc, classes)        -- execute() on each verifier, assert result shape

Public constants:
  VALID_STATUSES, VALID_KINDS
"""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = REPO_ROOT / "tools" / "HME" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

VALID_STATUSES = {"PASS", "WARN", "FAIL", "SKIP", "ERROR"}
VALID_KINDS = {"static", "runtime"}

_REAL_EXPANDUSER = os.path.expanduser


def purge_modules() -> None:
    """Drop every cached verify_coherence.* module so the next import
    picks up the current PROJECT_ROOT (captured at module-load time)."""
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)


def with_project_root(tmpdir, fn):
    """Run fn() with PROJECT_ROOT pointed at tmpdir; restore env on exit."""
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


def with_home_settings(tmpdir, settings, fn):
    """Mock ~/.claude/settings.json to point at tmpdir/settings.json.

    `settings` is a dict (written as JSON), a str (raw content for
    malformed-JSON tests), or None (file absent).
    """
    from unittest import mock
    import json as _json
    settings_path = Path(tmpdir) / "settings.json"
    if isinstance(settings, dict):
        settings_path.write_text(_json.dumps(settings))
    elif isinstance(settings, str):
        settings_path.write_text(settings)

    def _eu(p):
        if p == "~/.claude/settings.json":
            return str(settings_path)
        return _REAL_EXPANDUSER(p)

    with mock.patch("os.path.expanduser", side_effect=_eu):
        return fn()


def write_file(root, rel, body=""):
    """mkdir parents, write file body."""
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)
    return p


def init_git_repo(root, seed=True):
    """git init + configure user + (optional) seed commit so the tree has HEAD."""
    root = Path(root)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
    if seed:
        (root / "seed.txt").write_text("seed\n")
        subprocess.run(["git", "add", "seed.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "seed"], cwd=root, check=True)


def stage_file(root, rel, body=""):
    """write_file + git add (single staged file)."""
    write_file(root, rel, body)
    subprocess.run(["git", "add", rel], cwd=Path(root), check=True)


def assert_class_shape(tc, cls):
    """Common class-attribute assertions for every Verifier subclass.

    `kind` is a @property on the Verifier base (derived from category), so
    we read it from an instance rather than the class.
    """
    name = getattr(cls, "name", None)
    tc.assertIsInstance(name, str, msg=f"{cls.__name__}.name not a str")
    tc.assertTrue(name, msg=f"{cls.__name__}.name is empty")
    tc.assertIsInstance(getattr(cls, "category", None), str,
                        msg=f"{cls.__name__}.category not a str")
    tc.assertIsInstance(getattr(cls, "weight", None), (int, float),
                        msg=f"{cls.__name__}.weight not numeric")
    tc.assertIn(cls().kind, VALID_KINDS,
                msg=f"{cls.__name__}.kind invalid")


def smoke_run(tc, classes):
    """Call .run() then .execute() on every class in `classes`.

    .run() is invoked directly first so a TypeError / NameError /
    AttributeError class bug (e.g. local variable shadowing a helper)
    surfaces as a real test failure, not as a wrapped ERROR status.
    .execute() is invoked after to assert the result envelope shape.

    A verifier may legitimately raise inside run() when its
    environment is incomplete -- catch that distinction by mapping
    OSError/FileNotFoundError to a SKIP-equivalent path. Anything else
    is a programmer bug and fails the test loudly.
    """
    from verify_coherence._base import VerdictResult
    for cls in classes:
        name = cls.__name__
        try:
            cls().run()
        except (OSError, FileNotFoundError, KeyError):
            # Environment incompleteness during smoke is OK; production
            # callers handle these via execute()'s try-wrap.
            pass
        except NotImplementedError:
            tc.fail(f"{name}.run is abstract; subclass must implement it")
        r = cls().execute()
        tc.assertIsInstance(r, VerdictResult, msg=f"{name}: {type(r)}")
        tc.assertIn(r.status, VALID_STATUSES, msg=f"{name}: status={r.status!r}")
        tc.assertGreaterEqual(r.score, 0.0, msg=f"{name}: score={r.score}")
        tc.assertLessEqual(r.score, 1.0, msg=f"{name}: score={r.score}")
