"""Conjugate-channel coherence verifier -- extracted from code_audits_runtime.py.
Includes _count_legendary_streak helper. code_audits.py re-exports.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    ERROR,
    FAIL,
    METRICS_DIR,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _DOC_DIRS,
    _HOOKS_DIR,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _run_subprocess,
    errored,
    failed,
    passed,
    register,
    skipped,
)


def _count_legendary_streak(project_root: str) -> int:
    """Count consecutive 'legendary' ground-truth verdicts ending at the
    most recent verdict. Used by ConjugateChannelVerifier's license-to-
    explore branch to scale band-widening proportionally to recent
    productive-territory evidence (V * VIII * IX compounding)."""
    gt_path = os.path.join(project_root, "src", "output", "metrics",
                           "hme-ground-truth.jsonl")
    if not os.path.isfile(gt_path):
        return 0
    try:
        with open(gt_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, ValueError):
        return 0
    streak = 0
    for r in reversed(rows):
        if r.get("sentiment") == "legendary":
            streak += 1
        else:
            break
    return streak


@register
class ConjugateChannelVerifier(Verifier):
    """Horizon V expansion -- composition<=>HME conjugate-channel feedback.

    Couples HCI to perceptual coherence by reading the latest
    musical-correlation row and FAILing when the system is in the
    'lost' quadrant (low HCI AND low perceptual). PASS when in any
    other quadrant. The `perceptual_complexity_avg` and `hme_coherence`
    fields exist in `tools/HME/runtime/metrics/hme-musical-correlation.json`.

    This is the FIRST verifier whose status depends on the composition
    signal -- the conjugate channel previously was a passive view
    (`i/status mode=conjugate`) but didn't feed back into HCI. With
    this verifier the two coherences become a coupled system: a
    sustained 'lost' state degrades HCI, which signals the agent to
    investigate.

    Threshold: 'lost' = HCI < median AND perceptual < median (data-driven)."""
    name = "conjugate-channel"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    def run(self) -> VerdictResult:
        path = os.path.join(_PROJECT, "src", "output", "metrics",
                            "hme-musical-correlation.json")
        if not os.path.isfile(path):
            return skipped(summary="no musical-correlation file yet; pipeline hasn't produced one")
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError) as e:
            return errored(summary=f"could not read: {e}")
        latest = d.get("latest") or {}
        history = d.get("history") or []
        all_rounds = [r for r in (history + [latest])
                      if isinstance(r.get("hme_coherence"), (int, float))
                      and isinstance(r.get("perceptual_complexity_avg"), (int, float))]
        if not all_rounds:
            return skipped(summary="no rounds carry both signals")
        if not isinstance(latest.get("hme_coherence"), (int, float)) or \
           not isinstance(latest.get("perceptual_complexity_avg"), (int, float)):
            # SKIP path -- but DON'T let the streak-aware license signal go
            try:
                _streak = _count_legendary_streak(_PROJECT)
                if _streak >= 2:
                    _delta = min(0.10, 0.05 + max(0, _streak - 1) * 0.025)
                    _expiry = min(4, 1 + max(0, _streak - 1))
                    _refresh_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
                    _refresh = {
                        "ts": time.time(),
                        "trigger": "streak-aware-skip-refresh",
                        "reason": (f"latest round missing quantitative signals "
                                   f"but {_streak}-round legendary streak active"),
                        "recommended_action": "widen_band",
                        "band_delta": _delta,
                        "expires_after_rounds": _expiry,
                        "streak": {
                            "legendary_consecutive": _streak,
                            "policy": "magnitude +0.025/streak (cap +0.10) . duration +1/streak (cap 4)",
                        },
                    }
                    _refresh_tmp = _refresh_path + ".tmp"
                    with open(_refresh_tmp, "w") as _rf:
                        json.dump(_refresh, _rf, indent=2)
                    os.replace(_refresh_tmp, _refresh_path)
            except OSError:
                # Marker write is advisory; SKIP returns successfully
                # regardless.
                pass
            return skipped(summary="latest round missing one of the two signals")
        # Data-driven thresholds -- medians across history
        sorted_h = sorted(r["hme_coherence"] for r in all_rounds)
        sorted_p = sorted(r["perceptual_complexity_avg"] for r in all_rounds)
        h_thr = sorted_h[len(sorted_h) // 2]
        p_thr = sorted_p[len(sorted_p) // 2]
        cur_h = float(latest["hme_coherence"])
        cur_p = float(latest["perceptual_complexity_avg"])
        if cur_h < h_thr and cur_p < p_thr:
            # Bidirectional V-coupling (Horizon V asymptote): on lost-
            try:
                tightening = {
                    "ts": time.time(),
                    "trigger": "conjugate-channel-lost-quadrant",
                    "reason": (f"HCI={cur_h:.2f} < {h_thr:.2f} AND "
                               f"perc={cur_p:.2f} < {p_thr:.2f}"),
                    "recommended_action": "narrow_band",
                    "band_delta": -0.05,  # advisory: contract by 5pp
                    "expires_after_rounds": 1,
                }
                tightening_path = os.path.join(
                    _PROJECT, "tmp", "hme-band-tightening.json")
                tightening_tmp = tightening_path + ".tmp"
                with open(tightening_tmp, "w") as _tf:
                    json.dump(tightening, _tf, indent=2)
                os.replace(tightening_tmp, tightening_path)
            except OSError:
                pass  # silent-ok: best-effort fs op
            return failed(summary=f"latest round in 'lost' quadrant "
                           f"(HCI={cur_h:.2f} < {h_thr:.2f} AND "
                           f"perc={cur_p:.2f} < {p_thr:.2f})", details=["wrote tmp/hme-band-tightening.json (V->IX bidirectional coupling)",
                            "consider: i/status mode=conjugate for full quadrant view",
                            "consider: i/why mode=hci-drop to identify regressed axes",
                            "consider: i/why mode=conscience for ground-truth context"])
        # Bidirectional cleanup: if we're NOT in lost quadrant, clear any
        # stale tightening proposal so it doesn't persist past its trigger.
        try:
            tightening_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
            if os.path.isfile(tightening_path):
                os.remove(tightening_path)
        except OSError:
            pass  # silent-ok: best-effort fs op
        # Otherwise: PASS, with quadrant label in summary.
        try:
            snap_path = os.path.join(_PROJECT, "src", "output", "metrics",
                                     "hci-verifier-snapshot.json")
            if os.path.isfile(snap_path):
                with open(snap_path) as _sf:
                    _snap = json.load(_sf)
                # Compute per-subtag mean score; count ABOVE band
                from collections import defaultdict
                _by_subtag: dict = defaultdict(list)
                _scripts2 = os.path.join(_PROJECT, "tools", "HME", "scripts")
                if _scripts2 not in sys.path:
                    sys.path.insert(0, _scripts2)
                from verify_coherence import REGISTRY as _REG
                _name_to_subtag = {v.name: getattr(v, "subtag", "(none)") for v in _REG}
                for name, info in (_snap.get("verifiers") or {}).items():
                    subtag = _name_to_subtag.get(name, "(none)")
                    _by_subtag[subtag].append(float(info.get("score", 0.0)))
                _LO, _HI = 0.55, 0.85
                _above = sum(1 for vals in _by_subtag.values()
                             if vals and (sum(vals) / len(vals)) > _HI)
                _total = sum(1 for vals in _by_subtag.values() if vals)
                # >= 5 of 7 axes saturated -> license-to-explore signal.
                if _total >= 6 and _above >= 5:
                    legendary_streak = _count_legendary_streak(_PROJECT)
                    streak_delta = min(0.10, 0.05 + max(0, legendary_streak - 1) * 0.025)
                    # Duration: 1 round base, +1 per additional streak round, capped at 4
                    streak_expiry = min(4, 1 + max(0, legendary_streak - 1))
                    loosen_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
                    loosen_proposal = {
                        "ts": time.time(),
                        "trigger": "conjugate-channel-license-to-explore",
                        "reason": (f"{_above} of {_total} subtags ABOVE band "
                                   f"(saturated -> license to explore)"),
                        "recommended_action": "widen_band",
                        "band_delta": streak_delta,
                        "expires_after_rounds": streak_expiry,
                        "streak": {
                            "legendary_consecutive": legendary_streak,
                            "policy": "magnitude +0.025/streak (cap +0.10) . duration +1/streak (cap 4)",
                        },
                    }
                    loosen_tmp = loosen_path + ".tmp"
                    with open(loosen_tmp, "w") as _lf:
                        json.dump(loosen_proposal, _lf, indent=2)
                    os.replace(loosen_tmp, loosen_path)
        except (OSError, ImportError, ValueError):
            # Loosening signal is advisory; absence of the marker is
            pass
        if cur_h >= h_thr and cur_p >= p_thr:
            quad = "mature stability"
        elif cur_h >= h_thr:
            quad = "sterile rigor"
        else:
            quad = "lucky chaos"
        return passed(summary=f"latest round: '{quad}' "
                       f"(HCI={cur_h:.2f}, perc={cur_p:.2f}; medians {h_thr:.2f}/{p_thr:.2f})")




