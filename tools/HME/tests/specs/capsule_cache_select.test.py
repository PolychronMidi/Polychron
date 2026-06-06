"""Tests for D1: capsule-evidence cache + target selection (no shebang: run via
`python3 tools/HME/tests/specs/capsule_cache_select.test.py`)."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import capsule_cache  # noqa: E402
import select_target  # noqa: E402


class CapsuleCacheTests(unittest.TestCase):
    def test_memoizes_until_capsule_bytes_change(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            cap = d / "c.md"
            cap.write_text("## artifact\nx\n", encoding="utf-8")
            cache = d / "cache.json"
            calls = {"n": 0}

            def compute():
                calls["n"] += 1
                return {"missing": [], "gaps": []}

            r1, hit1 = capsule_cache.cached_validation(cap, compute, cache)
            r2, hit2 = capsule_cache.cached_validation(cap, compute, cache)
            self.assertEqual(calls["n"], 1, "second identical call must hit cache")
            self.assertFalse(hit1)
            self.assertTrue(hit2)
            self.assertEqual(r1, r2)

            # Editing the capsule invalidates the cache -> recompute (no stale grounding)
            cap.write_text("## artifact\nCHANGED\n", encoding="utf-8")
            _r3, hit3 = capsule_cache.cached_validation(cap, compute, cache)
            self.assertEqual(calls["n"], 2)
            self.assertFalse(hit3)


class SelectTargetTests(unittest.TestCase):
    def test_returns_first_pending_surface(self):
        with tempfile.TemporaryDirectory() as td:
            m = Path(td) / "map.md"
            m.write_text(
                "| surface | file | status |\n"
                "| --- | --- | --- |\n"
                "| pre-write gate | tools/HME/proxy/pre_write_check.js | reviewed |\n"
                "| stop-chain | tools/HME/proxy/stop_chain/ | pending |\n"
                "| state registry | tools/HME/proxy/state_registry.js | pending |\n",
                encoding="utf-8",
            )
            nxt = select_target.next_target(m)
            self.assertIsNotNone(nxt)
            self.assertEqual(nxt["name"], "stop-chain")
            allp = select_target.pending_targets(m)
            self.assertEqual(len(allp), 2)
            self.assertTrue(all(t["name"] != "pre-write gate" for t in allp))

    def test_real_coverage_map_parses_and_has_pending(self):
        nxt = select_target.next_target(ROOT / "doc" / "myth0s-coverage-map.md")
        self.assertIsNotNone(nxt, "the live coverage map should expose pending targets")
        self.assertIn("/", nxt["file"])


if __name__ == "__main__":
    unittest.main()
