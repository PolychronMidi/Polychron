#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

HME_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(HME_HME_ROOT / "scripts" / "invariants"))

import check_artifact_lifecycle as artifact_lifecycle  # noqa: E402
import check_causal_paths as causal_paths  # noqa: E402
import check_coherence_proof as coherence_proof  # noqa: E402
import check_failure_alchemy as failure_alchemy  # noqa: E402


@contextlib.contextmanager
def patched(module, **pairs):
    old = {k: getattr(module, k) for k in pairs}
    try:
        for k, v in pairs.items():
            setattr(module, k, v)
        yield
    finally:
        for k, v in old.items():
            setattr(module, k, v)


def capture(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn()
    return rc, buf.getvalue()


class PhaseOmegaValidatorNegativeControls(unittest.TestCase):
    def test_coherence_proof_requires_causal_path_ids(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "bad.json"
            doc = json.loads((HME_ROOT / "tests/fixtures/coherence-trace.sample.json").read_text())
            del doc["causal_path_ids"]
            p.write_text(json.dumps(doc))
            findings = coherence_proof.validate(p)
            self.assertTrue(any("causal_path_ids" in row for row in findings))

    def test_causal_paths_rejects_restored_readq_shortcut(self):
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / "causal.json"
            shortcuts = Path(td) / "shortcuts.json"
            cfg.write_text((HME_ROOT / "config/causal-paths.json").read_text())
            data = json.loads((HME_ROOT / "config/shortcuts.json").read_text())
            data.setdefault("multi-step", {})["readq"] = {"lane": "local-session", "steps": ["[HME_READ_CHAIN] $prompt"]}
            shortcuts.write_text(json.dumps(data))
            with patched(causal_paths, CONFIG=cfg, SHORTCUTS=shortcuts):
                _rc, out = capture(causal_paths.main)
            self.assertIn("retired readq shortcut must not exist", out)
            self.assertIn("local-session step must not type [HME_READ_CHAIN]", out)

    def test_artifact_lifecycle_rejects_unclassified_tracked_path(self):
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / "life.json"
            cfg.write_text(json.dumps({
                "schema": 1,
                "classes": {
                    name: {"patterns": [f"classified/{name}/**"], "policy": "x"}
                    for name in artifact_lifecycle.REQUIRED_CLASSES
                },
                "tracked_runtime_allowlist": []
            }))
            class FakeSubprocess:
                @staticmethod
                def check_output(*_args, **_kwargs):
                    return b"unclassified.txt\0"
            with patched(artifact_lifecycle, CONFIG=cfg, subprocess=FakeSubprocess):
                _rc, out = capture(artifact_lifecycle.main)
            self.assertIn("unclassified tracked path: unclassified.txt", out)

    def test_failure_alchemy_rejects_missing_forbidden_labels(self):
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / "alchemy.json"
            doc = json.loads((HME_ROOT / "config/failure-alchemy.json").read_text())
            doc["forbidden_labels"] = ["preexisting"]
            cfg.write_text(json.dumps(doc))
            with patched(failure_alchemy, CONFIG=cfg):
                _rc, out = capture(failure_alchemy.main)
            self.assertIn("forbidden_labels", out)


if __name__ == "__main__":
    unittest.main()
