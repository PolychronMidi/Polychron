#!/usr/bin/env python3
"""C1/C2: score a measured baseline-vs-mesh review round.

Reads a round's output JSONs (m_base = single high-effort baseline; m_red /
m_redp / m_cross = the red -> red_purple -> blue_purple mesh chain) and emits a
scorecard so the value question is MEASURED, not anecdotal:

  - severity counts (P0/P1/P2) per arm
  - cost proxy (reply bytes) per arm
  - calibration signals (confidence:low, checked-null counter-evidence,
    AUDIT-UNCERTAIN) -- the claim-audit layer's footprint
  - unique-catch heuristic: mesh findings whose key tokens are largely absent
    from the baseline reply (the adversarial value a lone reviewer missed)

C2: `compare` diffs two scorecards (e.g. CLAIM_AUDIT=0 vs =1) so the calibration
layer can be evaluated as a measurable variable.

This is a HEURISTIC scorer over prose findings; it is intentionally conservative
and never claims semantic perfection. It exists to make trends trackable.

Usage:
  score_round.py <out_dir> [--label L] [--json]
  score_round.py --compare <cardA.json> <cardB.json> [--json]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE_FILE = "m_base.json"
MESH_FILES = ("m_red.json", "m_redp.json", "m_cross.json")

_SEV_RE = {sev: re.compile(rf"\b{sev}\b") for sev in ("P0", "P1", "P2")}
_LOW_CONF_RE = re.compile(r"confidence:\s*low", re.I)
_CHECKED_NULL_RE = re.compile(r"none found after checking", re.I)
_AUDIT_UNCERTAIN_RE = re.compile(r"AUDIT-UNCERTAIN", re.I)
_TOKEN_RE = re.compile(r"[a-z_][a-z0-9_]{3,}")
# Findings tend to start at a severity marker; split on them to count distinct items.
_FINDING_SPLIT_RE = re.compile(r"(?=\bP[012]\b)")


def _reply(path: Path) -> str:
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    reply = obj.get("reply") if isinstance(obj, dict) else ""
    return reply if isinstance(reply, str) else ""


def _severities(text: str) -> dict:
    return {sev: len(rx.findall(text)) for sev, rx in _SEV_RE.items()}


def _signals(text: str) -> dict:
    return {
        "confidence_low": len(_LOW_CONF_RE.findall(text)),
        "checked_null_counter": len(_CHECKED_NULL_RE.findall(text)),
        "audit_uncertain": len(_AUDIT_UNCERTAIN_RE.findall(text)),
    }


def _findings(text: str) -> list[str]:
    parts = [p.strip() for p in _FINDING_SPLIT_RE.split(text) if p.strip()]
    return [p for p in parts if _SEV_RE["P0"].match(p) or _SEV_RE["P1"].match(p) or _SEV_RE["P2"].match(p)]


def _tokens(text: str) -> set[str]:
    # Code-ish tokens carry the finding's identity (function/symbol names).
    return {t for t in _TOKEN_RE.findall(text.lower()) if "_" in t or len(t) >= 6}


def _unique_in_mesh(baseline: str, mesh_text: str, threshold: float = 0.34) -> int:
    """Count mesh findings whose key tokens are largely absent from baseline.

    A mesh finding is 'unique' when its overlap with the most-similar baseline
    finding is below `threshold`. Heuristic, token-overlap based -- conservative
    by design (a high threshold would over-credit the mesh)."""
    base_findings = [_tokens(f) for f in _findings(baseline)]
    unique = 0
    for f in _findings(mesh_text):
        ftok = _tokens(f)
        if not ftok:
            continue
        best = 0.0
        for bt in base_findings:
            if not bt:
                continue
            overlap = len(ftok & bt) / len(ftok)
            best = max(best, overlap)
        if best < threshold:
            unique += 1
    return unique


def score(out_dir: Path, label: str = "") -> dict:
    base_reply = _reply(out_dir / BASE_FILE)
    mesh_replies = [_reply(out_dir / f) for f in MESH_FILES]
    mesh_text = "\n\n".join(r for r in mesh_replies if r)
    card = {
        "label": label,
        "baseline": {
            "severities": _severities(base_reply),
            "signals": _signals(base_reply),
            "reply_bytes": len(base_reply.encode("utf-8")),
            "findings": len(_findings(base_reply)),
        },
        "mesh": {
            "severities": _severities(mesh_text),
            "signals": _signals(mesh_text),
            "reply_bytes": sum(len(r.encode("utf-8")) for r in mesh_replies),
            "findings": sum(len(_findings(r)) for r in mesh_replies),
            "arms": sum(1 for r in mesh_replies if r),
        },
        "unique_in_mesh": _unique_in_mesh(base_reply, mesh_text),
    }
    return card


def compare(card_a: dict, card_b: dict) -> dict:
    """C2: diff two scorecards (e.g. claim-audit off vs on)."""
    def _d(path):
        a, b = card_a, card_b
        for k in path:
            a = (a or {}).get(k, {})
            b = (b or {}).get(k, {})
        return a, b
    out = {"a_label": card_a.get("label"), "b_label": card_b.get("label"), "deltas": {}}
    for arm in ("baseline", "mesh"):
        a_sig, b_sig = _d((arm, "signals"))
        a_sev, b_sev = _d((arm, "severities"))
        out["deltas"][arm] = {
            "calibration_signal_delta": (sum(b_sig.values()) if isinstance(b_sig, dict) else 0)
            - (sum(a_sig.values()) if isinstance(a_sig, dict) else 0),
            "severity_delta": {s: (b_sev.get(s, 0) if isinstance(b_sev, dict) else 0)
                               - (a_sev.get(s, 0) if isinstance(a_sev, dict) else 0)
                               for s in ("P0", "P1", "P2")},
        }
    out["unique_in_mesh_delta"] = card_b.get("unique_in_mesh", 0) - card_a.get("unique_in_mesh", 0)
    return out


def main(argv: list) -> int:
    if argv[:1] == ["--compare"]:
        if len(argv) < 3:
            sys.stderr.write("usage: score_round.py --compare <a.json> <b.json> [--json]\n")
            return 2
        a = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        b = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        print(json.dumps(compare(a, b), indent=2, sort_keys=True))
        return 0
    if not argv:
        sys.stderr.write("usage: score_round.py <out_dir> [--label L] [--json]\n")
        return 2
    out_dir = Path(argv[0])
    label = ""
    if "--label" in argv:
        i = argv.index("--label")
        label = argv[i + 1] if i + 1 < len(argv) else ""
    card = score(out_dir, label)
    print(json.dumps(card, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
