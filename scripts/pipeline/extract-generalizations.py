#!/usr/bin/env python3
"""Phase 6.4 — generalization extractor.

Scans the crystallized pattern registry and separates project-specific
patterns (depend on Polychron's particular architecture) from
structurally general ones (would apply to any similar topological
system). For each general pattern it produces a templated abstraction
stripping Polychron-specific terms.

Output:
  1. metrics/hme-generalizations.json — machine-readable, per-pattern scores
  2. doc/hme-discoveries.md — human-facing appended log of generalization
     candidates (templated, requires human polish before claiming)

Rule-based v1 (no LLM synthesis):

  project_specificity_score = frequency of Polychron-specific tokens in
    the pattern's shared_tags + synthesis text, normalized to [0, 1].
  general_candidates = patterns with specificity < 0.3

Polychron-specific vocabulary: module names (validator, clamps, etc.),
subsystem names (conductor/crossLayer/etc.), project-specific concepts
(IIFE, L0, Polychron, beat, regime, hotspot, trust ecology, etc.).

Generalization templates strip the project terms and rewrite the
pattern in purely topological language. v1 templates are conservative —
they mark abstractions as DRAFT requiring human review, not as
authoritative claims.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
CRYSTALLIZED = os.path.join(PROJECT_ROOT, "metrics", "hme-crystallized.json")
OUT_JSON = os.path.join(PROJECT_ROOT, "metrics", "hme-generalizations.json")
OUT_MD = os.path.join(PROJECT_ROOT, "doc", "hme-discoveries.md")

SPECIFICITY_THRESHOLD = float(os.environ.get("HME_GENERALIZATION_THRESHOLD", "0.3"))

# Tokens that scream "Polychron-specific". The higher the share of these
# in a pattern's metadata, the less generalizable the pattern is.
PROJECT_SPECIFIC_TOKENS = {
    "polychron", "iife", "l0", "beat", "regime", "hotspot", "composer",
    "antagonism", "motif", "stutter", "crosslayer", "conductor", "rhythm",
    "trust", "trustecology", "fingerprint", "stable", "evolved", "drifted",
    "densitybias", "densitysurprise", "climax", "cadence", "ascendratio",
    "tension", "coherence", "emergent", "regimeclassifier", "entropyregulator",
    "feedbackoscillator", "motifecho", "harmonicintervalguard", "meta",
    "intelligence", "dynamism", "profile", "profile", "section",
}


def _tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric tokens of length ≥3."""
    return re.findall(r"\b[a-zA-Z][a-zA-Z0-9]{2,}\b", (text or "").lower())


def compute_specificity(pattern: dict) -> dict:
    tags = pattern.get("shared_tags") or []
    synth = pattern.get("synthesis") or ""
    seed = pattern.get("seed_tag") or ""

    all_text = " ".join(tags) + " " + synth + " " + seed
    tokens = _tokenize(all_text)
    if not tokens:
        return {"specificity": 1.0, "project_tokens": 0, "total_tokens": 0}
    project_hits = sum(1 for t in tokens if t in PROJECT_SPECIFIC_TOKENS)
    specificity = project_hits / max(len(tokens), 1)
    return {
        "specificity": round(specificity, 3),
        "project_tokens": project_hits,
        "total_tokens": len(tokens),
    }


def draft_generalization(pattern: dict) -> str:
    """Produce a templated abstraction that strips project-specific terms.
    v1 is a fill-in-the-blank template — requires human polish before it
    becomes a claim."""
    tags = pattern.get("shared_tags") or []
    rounds = pattern.get("rounds") or []
    n_members = len(pattern.get("member_ids") or [])
    non_specific_tags = [t for t in tags if t.lower() not in PROJECT_SPECIFIC_TOKENS]
    return (
        f"[DRAFT] Pattern observed across {len(rounds)} rounds "
        f"({n_members} members) with shared traits {non_specific_tags or '(none)'}. "
        f"Strip project terms and rewrite as a topological claim: "
        f"`<<STRUCTURE>> consistently yields <<OUTCOME>> when <<CONDITION>>`. "
        f"Source seed: `{pattern.get('seed_tag', '?')}`, rounds: "
        f"{', '.join(rounds[:8])}{' …' if len(rounds) > 8 else ''}."
    )


def main() -> int:
    if not os.path.exists(CRYSTALLIZED):
        print("extract-generalizations: no crystallized patterns yet — skipping")
        return 0
    try:
        with open(CRYSTALLIZED, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        print(f"extract-generalizations: read failed: {type(_e).__name__}: {_e}", file=sys.stderr)
        return 0
    patterns = data.get("patterns") or []

    scored: list[dict] = []
    for p in patterns:
        s = compute_specificity(p)
        is_general = s["specificity"] < SPECIFICITY_THRESHOLD
        scored.append({
            "pattern_id": p.get("id", "?"),
            "seed_tag": p.get("seed_tag", "?"),
            "shared_tags": p.get("shared_tags") or [],
            "rounds": p.get("rounds") or [],
            "member_count": len(p.get("member_ids") or []),
            "specificity": s["specificity"],
            "is_generalization_candidate": is_general,
            "template": draft_generalization(p) if is_general else None,
        })

    candidates = [s for s in scored if s["is_generalization_candidate"]]
    candidates.sort(
        key=lambda c: (c["specificity"], -len(c["rounds"]), -c["member_count"])
    )

    report = {
        "meta": {
            "script": "extract-generalizations.py",
            "timestamp": int(time.time()),
            "patterns_scanned": len(patterns),
            "candidates": len(candidates),
            "specificity_threshold": SPECIFICITY_THRESHOLD,
        },
        "patterns": scored,
        "candidates": candidates,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    # Append to doc/hme-discoveries.md (never overwrite — this file
    # accumulates the system's externalized intellectual contribution)
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    if candidates:
        with open(OUT_MD, "a", encoding="utf-8") as f:
            f.write(f"\n\n## Round snapshot — {time.strftime('%Y-%m-%dT%H:%M:%S')}\n\n")
            f.write(
                f"Generalization extractor found {len(candidates)} candidate(s) "
                f"(specificity < {SPECIFICITY_THRESHOLD}):\n\n"
            )
            for c in candidates[:10]:
                f.write(f"### `{c['pattern_id']}`\n")
                f.write(f"- specificity: {c['specificity']:.2f}  "
                        f"rounds: {len(c['rounds'])}  members: {c['member_count']}\n")
                f.write(f"- tags: {', '.join(c['shared_tags']) or '(none)'}\n")
                f.write(f"- draft: {c['template']}\n\n")

    print(
        f"extract-generalizations: {len(candidates)}/{len(patterns)} "
        f"candidates under specificity threshold {SPECIFICITY_THRESHOLD}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
