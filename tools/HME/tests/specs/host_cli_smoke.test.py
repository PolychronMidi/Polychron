"""Tests for optional HostCliSmokeVerifier gate."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[4]
# Load root .env so importing verify_coherence does not explode on required
# HME_* keys when this unit test is run directly.
for line in (REPO_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.split("#", 1)[0].strip())
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))
os.environ.setdefault("PROJECT_ROOT", str(REPO_ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(REPO_ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(REPO_ROOT / "src/output/metrics"))


class HostCliSmokeVerifierTests(unittest.TestCase):
    def test_skips_unless_enabled(self):
        prior = os.environ.pop("HME_RUN_CLI_SMOKE", None)
        try:
            from verify_coherence.host_cli_smoke import HostCliSmokeVerifier
            verdict = HostCliSmokeVerifier().run()
            self.assertEqual(verdict.status, "SKIP")
            self.assertIn("HME_RUN_CLI_SMOKE=1", verdict.summary)
        finally:
            if prior is not None:
                os.environ["HME_RUN_CLI_SMOKE"] = prior

    def test_live_harness_closes_stdin_and_sets_smoke_env(self):
        import subprocess
        import smoke_host_cli

        captured: dict[str, object] = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            captured.update(kwargs)
            return subprocess.CompletedProcess(argv, 0, stdout="ok", stderr="")

        with tempfile.TemporaryDirectory() as td, \
             mock.patch.object(smoke_host_cli, "PROJECT_ROOT", Path(td)), \
             mock.patch.object(smoke_host_cli, "SMOKE_DIR", Path(td) / "smoke"), \
             mock.patch.object(smoke_host_cli, "ERROR_LOG", Path(td) / "errors.log"), \
             mock.patch.object(smoke_host_cli, "preflight", return_value=[]), \
             mock.patch.object(smoke_host_cli, "_which_host", return_value="claude"), \
             mock.patch.object(smoke_host_cli.subprocess, "run", side_effect=fake_run):
            result = smoke_host_cli.run_smoke("claude", timeout=1, no_proxy_check=True)

        self.assertEqual(captured["input"], "")
        self.assertEqual(captured["env"]["HME_CLI_SMOKE"], "1")
        prompt = " ".join(str(x) for x in captured["argv"])
        self.assertIn("-read.txt", prompt)
        self.assertNotIn("README.md", prompt)
        self.assertIn("Write/Edit artifact missing", " ".join(result["failures"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
