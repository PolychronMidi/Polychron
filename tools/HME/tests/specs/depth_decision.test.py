"""Regression tests for evidence-weighted mesh depth voting.

The vote decides whether to buy more debate depth, never whether a finding is true.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import depth_decision  # noqa: E402


class MeshDepthDecisionTests(unittest.TestCase):
    def test_unsupported_popularity_cannot_escalate(self):
        row = depth_decision.compute_depth_decision(
            current_depth=1,
            round_name="r",
            votes=[
                {"role": "red", "delta": "+2", "confidence": "high", "reason": "risk", "evidence": ""},
                {"role": "blue", "delta": "+2", "confidence": "high", "reason": "uncertainty", "evidence": "none"},
                {"role": "driver", "delta": "+1", "confidence": "high", "reason": "more", "evidence": "uncited"},
            ],
        )
        self.assertEqual(row["next_depth"], 1)
        self.assertEqual(row["decision"], "hold_depth")
        self.assertTrue(all(v["advisory_only"] for v in row["votes"]))
        self.assertEqual(row["anti_bloat_check"], "unsupported escalation votes ignored")

    def test_grounded_p1_dissent_forces_cross_exam_despite_majority_hold(self):
        row = depth_decision.compute_depth_decision(
            current_depth=2,
            round_name="r",
            votes=[
                {"role": "red", "delta": "+1", "confidence": "high", "reason": "P1 fail-open", "evidence": "tools/HME/proxy/x.js:44"},
                {"role": "blue", "delta": "0", "confidence": "high", "reason": "enough-evidence", "evidence": "test y covers nearby behavior"},
                {"role": "purple", "delta": "0", "confidence": "medium", "reason": "enough-evidence", "evidence": "review msg 12"},
                {"role": "driver", "delta": "0", "confidence": "medium", "reason": "scope", "evidence": "user asked narrow fix"},
            ],
        )
        self.assertGreaterEqual(row["next_depth"], 3)
        self.assertIn("p1", row["evidence_gates"])
        self.assertIn("fail_open", row["evidence_gates"])
        self.assertTrue(row["decision"].startswith("escalate_to_"))

    def test_guard_surface_gate_escalates_to_debate_hall(self):
        row = depth_decision.compute_depth_decision(
            current_depth=2,
            round_name="guard-round",
            evidence_gates=["guard-surface"],
            votes=[
                {"role": "blue", "delta": "0", "confidence": "high", "reason": "tests may settle", "evidence": "tools/HME/tests/specs/guard.test.js"},
            ],
        )
        self.assertGreaterEqual(row["next_depth"], 4)
        self.assertEqual(row["next_label"], "debate_hall")
        self.assertEqual(row["anti_bloat_check"], "evidence gate dominated popularity; new evidence required next turn")

    def test_settled_or_repetitive_grounded_votes_deescalate(self):
        row = depth_decision.compute_depth_decision(
            current_depth=3,
            round_name="settled",
            votes=[
                {"role": "red", "delta": "-1", "confidence": "high", "reason": "settled-by-test", "evidence": "proxy_extracted_modules.test.js:67/67 pass"},
                {"role": "blue", "delta": "0", "confidence": "high", "reason": "enough-evidence", "evidence": "same test settles"},
                {"role": "purple", "delta": "0", "confidence": "medium", "reason": "repetition", "evidence": "no new evidence in last round"},
            ],
        )
        self.assertLess(row["next_depth"], 3)
        self.assertTrue(row["decision"].startswith("deescalate_to_"))

    def test_driver_override_requires_allowed_reason_and_evidence(self):
        ignored = depth_decision.compute_depth_decision(
            current_depth=2,
            round_name="override",
            votes=[{"role": "red", "delta": "0", "reason": "enough-evidence", "evidence": "test pass"}],
            override={"next_depth": 5, "reason": "preference", "evidence": ""},
        )
        self.assertNotEqual(ignored["next_depth"], 5)
        self.assertTrue(ignored["override"]["ignored"])

        applied = depth_decision.compute_depth_decision(
            current_depth=2,
            round_name="override",
            votes=[{"role": "red", "delta": "0", "reason": "enough-evidence", "evidence": "test pass"}],
            override={"next_depth": 4, "reason": "user-intent", "evidence": "user explicitly requested mesh consult"},
        )
        self.assertEqual(applied["next_depth"], 4)
        self.assertEqual(applied["override"]["reason"], "user-intent")

    def test_append_writes_single_durable_ledger_row(self):
        row = depth_decision.compute_depth_decision(
            current_depth=1,
            round_name="ledger",
            votes=[{"role": "red", "delta": "+1", "reason": "contradiction", "evidence": "red.md vs blue.md"}],
        )
        with tempfile.TemporaryDirectory() as td:
            ledger = Path(td) / "round-progress.jsonl"
            depth_decision.append_decision(row, ledger)
            rows = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event"], "mesh_depth_decision")
        self.assertEqual(rows[0]["round"], "ledger")
        self.assertEqual(rows[0]["anti_bloat_check"], row["anti_bloat_check"])


if __name__ == "__main__":
    unittest.main()
