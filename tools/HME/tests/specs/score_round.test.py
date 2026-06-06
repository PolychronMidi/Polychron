#!/usr/bin/env python3
"""Tests for the C1/C2 round scorer (teams/rounds/score_round.py)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import score_round  # noqa: E402


def _write_round(d: Path, base: str, red: str, redp: str, cross: str) -> None:
    (d / "m_base.json").write_text(json.dumps({"reply": base}), encoding="utf-8")
    (d / "m_red.json").write_text(json.dumps({"reply": red}), encoding="utf-8")
    (d / "m_redp.json").write_text(json.dumps({"reply": redp}), encoding="utf-8")
    (d / "m_cross.json").write_text(json.dumps({"reply": cross}), encoding="utf-8")


class ScoreRoundTests(unittest.TestCase):
    def test_scores_severities_signals_and_unique_catch(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            _write_round(
                d,
                base="P1 fsync issue in _write_json_atomic\nP2 style nit",
                red="P1 fsync issue in _write_json_atomic\nP1 budget row _reserve_budget negative count",
                redp="P1 _reserve_budget negative; none found after checking guards\nconfidence: low",
                cross="P1 confirmed _reserve_budget\nAUDIT-UNCERTAIN: recommend human review",
            )
            card = score_round.score(d, label="t")
            self.assertEqual(card["label"], "t")
            self.assertEqual(card["baseline"]["severities"]["P1"], 1)
            self.assertEqual(card["baseline"]["severities"]["P2"], 1)
            self.assertEqual(card["mesh"]["arms"], 3)
            # the mesh surfaced a _reserve_budget finding the baseline lacked
            self.assertGreaterEqual(card["unique_in_mesh"], 1)
            # calibration signals are counted from the claim-audit footprint
            self.assertEqual(card["mesh"]["signals"]["checked_null_counter"], 1)
            self.assertEqual(card["mesh"]["signals"]["audit_uncertain"], 1)
            self.assertEqual(card["mesh"]["signals"]["confidence_low"], 1)

    def test_compare_diffs_two_cards(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            _write_round(d, "P1 a _alpha", "P1 a _alpha", "", "")
            off = score_round.score(d, label="ca-off")
            _write_round(d, "P1 a _alpha", "P1 a _alpha; none found after checking", "AUDIT-UNCERTAIN", "")
            on = score_round.score(d, label="ca-on")
            cmp = score_round.compare(off, on)
            self.assertEqual(cmp["a_label"], "ca-off")
            self.assertEqual(cmp["b_label"], "ca-on")
            # turning claim-audit on adds calibration signals in the mesh arm
            self.assertGreater(cmp["deltas"]["mesh"]["calibration_signal_delta"], 0)

    def test_missing_or_malformed_outputs_are_empty_not_crash(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "m_base.json").write_text("not json", encoding="utf-8")
            card = score_round.score(d, label="empty")
            self.assertEqual(card["baseline"]["findings"], 0)
            self.assertEqual(card["mesh"]["findings"], 0)
            self.assertEqual(card["unique_in_mesh"], 0)


if __name__ == "__main__":
    unittest.main()
