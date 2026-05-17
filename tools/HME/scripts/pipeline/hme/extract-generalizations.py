#!/usr/bin/env python3
"""
Scans the crystallized pattern registry and separates project-specific
patterns (depend on Polychron's particular architecture) from structurally
general ones (would apply to any similar topological system).

Output:
  src/output/metrics/hme-generalizations.json -- machine-readable, per-pattern
  scores + candidate list for status(mode=generalizations).

Scoring fix: vocabulary is now built dynamically from three sources
and matched against camelCase-split pattern tags + synthesis text:
  - src/scripts/pipeline/bias-bounds-manifest.json  (93 bias registrations)
  - src/time/l0Channels.js                       (~45 canonical channel names)
  - src/<subsystem>/                             (nine subsystem directories)

A pattern tagged `emergentMelodicEngine` used to score 0.00 because
"emergentmelodicengine" wasn't a substring of any hardcoded vocab token.
After camelCase-splitting (emergent, melodic, engine) and dynamic vocab
(all three tokens appear in l0Channels + crossLayer/melody), it scores ~0.9.

Threshold stays at 0.3: patterns whose project-token share is below that
are candidates for generalization. The status reader surfaces candidates; no separate synthesis step remains.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from _metrics import METRICS_DIR, PROJECT_METRICS_DIR, metric_path, project_metric_path
PROJECT_ROOT = (
    os.environ.get("CLAUDE_PROJECT_DIR")
    or os.environ.get("PROJECT_ROOT")
    or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
)
CRYSTALLIZED = metric_path("hme-crystallized.json")
OUT_JSON = metric_path("hme-generalizations.json")

SPECIFICITY_THRESHOLD = float(
    os.environ.get("HME_GENERALIZATION_THRESHOLD", "0.3")
)

# Dynamic project vocabulary

_CAMEL_SPLITTER = re.compile(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])')


def _camel_split(token: str) -> list[str]:
    """camelCase / PascalCase -> lowercase parts. 'emergentMelodicEngine' ->
    ['emergent', 'melodic', 'engine']. Existing all-lowercase tokens are
    returned as-is (as a 1-element list). Keeps tokens of length >= 3 --
    shorter fragments are too generic to be diagnostic."""
    parts = _CAMEL_SPLITTER.split(token)
    out: list[str] = []
    for p in parts:
        for sub in re.split(r'[-_]', p):
            sub = sub.strip().lower()
            if len(sub) >= 3:
                out.append(sub)
    return out


def _build_project_vocab() -> set[str]:
    vocab: set[str] = set()

    # 1. Bias-bounds registrations -- "module:field" pairs. Both halves
    bias_path = os.path.join(PROJECT_ROOT, "src", "scripts", "pipeline", "bias-bounds-manifest.json")
    try:
        with open(bias_path) as f:
            bias = json.load(f)
        for key in (bias.get("registrations") or {}).keys():
            for half in key.split(":", 1):
                for part in _camel_split(half):
                    vocab.add(part)
    except (OSError, json.JSONDecodeError):
        pass  # silent-ok: diagnostic; missing vocab source only narrows matching

    # 2. L0 channel names -- canonical inter-module signal identifiers.
    l0_path = os.path.join(PROJECT_ROOT, "src", "time", "l0Channels.js")
    try:
        with open(l0_path) as f:
            content = f.read()
        # Extract both the JS property keys (`emergentMelody:`) and the
        # string values (`'emergentMelody'` or `'perceptual-crowding'`).
        for key in re.findall(r'^\s*([a-zA-Z][a-zA-Z0-9]+)\s*:', content, flags=re.MULTILINE):
            for part in _camel_split(key):
                vocab.add(part)
        for val in re.findall(r"'([a-zA-Z][\w\-]+)'", content):
            for chunk in val.split('-'):
                if len(chunk) >= 3:
                    vocab.add(chunk.lower())
    except OSError:
        pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # 3. Subsystem directory names.
    src_path = os.path.join(PROJECT_ROOT, "src")
    try:
        for entry in os.listdir(src_path):
            full = os.path.join(src_path, entry)
            if os.path.isdir(full) and not entry.startswith("."):
                for part in _camel_split(entry):
                    vocab.add(part)
    except OSError:
        pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # 4. Hand-curated seeds for concepts that don't live in code but are
    vocab.update({
        "polychron", "regime", "coherent", "evolving", "exploring", "initializing",
        "legendary", "stable", "evolved", "drifted", "baseline",
        "hme", "hypermeta", "crystallized", "arc",
    })

    return vocab


PROJECT_VOCAB = _build_project_vocab()


def project_specificity(text: str, tags: list[str]) -> float:
    """Fraction of non-stopword tokens that match project vocab.
    camelCase tags are split first so single compound identifiers contribute
    multiple token-matches instead of failing a substring check."""
    tokens: list[str] = []
    for tag in tags:
        tokens.extend(_camel_split(tag))
    # Tokenize the synthesis text as whitespace+punct split, lowercased.
    for raw in re.findall(r'[A-Za-z][A-Za-z0-9]*', text or ""):
        for part in _camel_split(raw):
            tokens.append(part)
    if not tokens:
        return 0.0
    _STOP = {"the", "and", "for", "with", "this", "that", "from", "into",
             "when", "then", "where", "has", "have", "was", "were", "are",
             "pattern", "patterns", "system", "systems", "round", "rounds"}
    meaningful = [t for t in tokens if t not in _STOP]
    if not meaningful:
        return 0.0
    hits = sum(1 for t in meaningful if t in PROJECT_VOCAB)
    return hits / len(meaningful)


def draft_template(p: dict) -> str:
    """The structural scaffold a generalization candidate starts with.
    This remains a local scaffold for the status reader."""
    tags = p.get("shared_tags", [])
    rounds = p.get("rounds", [])
    members = p.get("member_count", 0)
    return (
        f"[DRAFT] Pattern observed across {len(rounds)} rounds ({members} members) "
        f"with shared traits {tags}. Synthesizer will fill in: "
        f"(a) invariant, (b) falsifiable prediction for similar systems, "
        f"(c) counterexample. Source seed: {tags[0] if tags else '?'}, "
        f"rounds: {', '.join(rounds[:6])}{'...' if len(rounds) > 6 else ''}."
    )


def main() -> int:
    if not os.path.isfile(CRYSTALLIZED):
        print(f"extract-generalizations: {CRYSTALLIZED} not found, skipping")
        return 0
    with open(CRYSTALLIZED) as f:
        data = json.load(f)
    patterns = data.get("patterns", [])

    scored: list[dict] = []
    for p in patterns:
        synth_text = p.get("synthesis") or p.get("summary") or ""
        specificity = project_specificity(synth_text, p.get("shared_tags", []))
        is_general = specificity < SPECIFICITY_THRESHOLD
        scored.append({
            "pattern_id": p.get("pattern_id") or p.get("id", "?"),
            "shared_tags": p.get("shared_tags", []),
            "rounds": p.get("rounds", []),
            "member_count": p.get("member_count", 0),
            "member_ids": p.get("member_ids", []),
            "synthesis": synth_text,
            "specificity": round(specificity, 3),
            "is_generalization_candidate": is_general,
            "template": draft_template(p) if is_general else None,
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
            "vocab_size": len(PROJECT_VOCAB),
        },
        "patterns": scored,
        "candidates": candidates,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    print(
        f"extract-generalizations: {len(candidates)}/{len(patterns)} "
        f"candidates under specificity threshold {SPECIFICITY_THRESHOLD} "
        f"(vocab={len(PROJECT_VOCAB)} tokens)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
