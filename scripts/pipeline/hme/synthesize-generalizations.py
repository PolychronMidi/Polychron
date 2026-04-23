#!/usr/bin/env python3
"""Phase 6.4 — generalization synthesizer (R97 rewrite).

Takes generalization candidates from `metrics/hme-generalizations.json` and
produces draft universal-principle entries in
`metrics/hme-discoveries-draft.jsonl` (gitignored, regenerated every run).

Six R97 tweaks replace the R96 spam path:
  1. **Model** — synthesis_reasoning.call(profile='reasoning') cascade
     (Groq → Cerebras → Mistral → NVIDIA → OpenRouter → arbiter fallback).
     R96 used arbiter directly, which is phi-4-Q4_K_M (4GB, weak at
     conceptual reasoning). Free-tier reasoning APIs handle this far better.
  2. **Scoring** — see extract-generalizations.py. Fixed in that file.
  3. **Novelty gate** — every candidate synthesis is compared against every
     existing draft by cosine similarity on the raw text. Drafts whose
     principles duplicate (>0.90) an existing one are dropped.
  4. **Actionability** — prompt asks for three structured fields
     (invariant, falsifiable prediction, counterexample). Output missing
     any of them is rejected as tautology/waffle.
  5. **Stability** — each draft tracks `stable_runs`. When a principle
     text is unchanged across ≥3 consecutive runs, `promotable=true` flips
     and the entry becomes eligible for human-triggered promotion via
     `learn(action='promote_discovery', id=<draft_id>)`.
  6. **Separation** — drafts live in `metrics/hme-discoveries-draft.jsonl`
     (ephemeral). `doc/hme-discoveries.md` is now human-curated only.

Non-fatal: skips the pipeline step without aborting if the cascade fails.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
METRICS_DIR = os.environ.get(
    "METRICS_DIR", os.path.join(PROJECT_ROOT, "output", "metrics")
)
SRC = os.path.join(METRICS_DIR, "hme-generalizations.json")
DRAFT_OUT = os.path.join(METRICS_DIR, "hme-discoveries-draft.jsonl")

STABILITY_REQUIRED = int(os.environ.get("HME_DISCOVERY_STABILITY", "3"))
NOVELTY_MAX_COSINE = float(os.environ.get("HME_DISCOVERY_NOVELTY_MAX", "0.90"))

# Make the MCP server-side synthesis import path available.
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "mcp"))

logger = logging.getLogger("synthesize-generalizations")


def _load_existing_drafts() -> list[dict]:
    if not os.path.isfile(DRAFT_OUT):
        return []
    out: list[dict] = []
    with open(DRAFT_OUT) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # env-ok: skip malformed residual line, don't abort
    return out


def _simple_cosine(a: str, b: str) -> float:
    """Token-overlap cosine (Jaccard-like). No external model needed —
    we're measuring 'are these two sentences essentially the same claim?'
    not semantic nuance. Tokens ≥4 chars, lowercased, stopwords dropped."""
    _STOP = {"the", "and", "for", "with", "this", "that", "from",
             "into", "when", "then", "where", "have", "will", "would",
             "their", "these", "those", "such", "each", "which", "also"}
    def _bag(s: str) -> set[str]:
        return {t for t in re.findall(r'[a-z][a-z0-9]{3,}', (s or "").lower())
                if t not in _STOP}
    ba, bb = _bag(a), _bag(b)
    if not ba or not bb:
        return 0.0
    overlap = len(ba & bb)
    return overlap / (len(ba | bb) ** 0.5 * max(len(ba), len(bb)) ** 0.5)


_STRUCTURED_PROMPT = """You are extracting a universal principle from a specific software project's evolution history.

CONTEXT:
Polychron is a JavaScript algorithmic composition system. Its HME (Hypermeta)
layer crystallizes patterns observed across multiple evolution rounds. The
pattern below recurred across {n_rounds} rounds with {member_count} member
entries, and scored {specificity:.2f}/1.00 on project-specificity (lower =
more likely to generalize beyond Polychron).

PATTERN:
- ID:   {pattern_id}
- Tags: {tags}
- Evidence rounds: {rounds}

KB CONTEXT ({n_kb} member entries):
{kb_context}

REQUIRED OUTPUT FORMAT (exactly this structure, no preamble, no epilogue):

INVARIANT:
<one sentence stating a structural property that holds whenever the listed
conditions are met. Use ONLY generic terms — no Polychron module names, no
"IIFE", no "L0", no "regime", no "crossLayer". Write for a reader who has
never heard of Polychron.>

PREDICTION:
<one testable prediction the invariant makes about other complex adaptive
systems. Must be concrete enough that someone analysing a different system
could look for it. Bad: "similar systems exhibit emergence". Good:
"in any system where N+ components publish events to a shared bus AND are
each listeners on at least one event produced by another component, the
median event latency grows sub-linearly with N.">

COUNTEREXAMPLE:
<what observation in another system would falsify the invariant. Must be
an observation the reader could actually make. Bad: "if emergence stops".
Good: "any multi-agent system where removing any one agent produces
proportionate rather than sub-proportionate output degradation.">

If the pattern does NOT support a non-tautological principle — if the
honest three-field answer would be "this pattern is just restating its
own recurrence" — output exactly the single token REJECT and nothing else."""


def _parse_structured(text: str) -> dict | None:
    """Extract INVARIANT / PREDICTION / COUNTEREXAMPLE blocks. Returns None
    if any field is missing — that's the actionability gate."""
    if not text:
        return None
    t = text.strip()
    if t.upper().startswith("REJECT"):
        return None
    fields: dict[str, str] = {}
    for label in ("INVARIANT", "PREDICTION", "COUNTEREXAMPLE"):
        m = re.search(
            rf'^\s*{label}\s*:?\s*\n?(.+?)(?=^\s*(?:INVARIANT|PREDICTION|COUNTEREXAMPLE)\s*:?\s*$|\Z)',
            t, flags=re.MULTILINE | re.DOTALL | re.IGNORECASE,
        )
        if not m:
            return None
        body = m.group(1).strip()
        if len(body) < 40:  # anything shorter is guaranteed-waffle
            return None
        fields[label.lower()] = body
    return fields


def _load_kb_members(member_ids: list) -> list[str]:
    """Load content from KB lancedb for each pattern member."""
    if not member_ids:
        return []
    try:
        import lancedb
        db = lancedb.connect(os.path.join(PROJECT_ROOT, "tools", "HME", "KB"))
        tbl = db.open_table("knowledge")
        rows = tbl.to_arrow().to_pylist()
        by_id = {r["id"]: r for r in rows}
        out: list[str] = []
        for mid in member_ids:
            r = by_id.get(mid)
            if r:
                title = r.get("title", "")
                content = (r.get("content", "") or "")[:500]
                out.append(f"[{title}] {content}")
        return out
    except Exception as _err:
        logger.debug(f"kb load failed: {type(_err).__name__}: {_err}")
        return []


def _draft_id(candidate: dict, invariant: str) -> str:
    """Stable ID across runs — hash of (pattern_id, first-120-chars of
    invariant). If the synthesizer rewrites the invariant materially, a
    fresh ID is generated and the old draft ages out."""
    import hashlib
    seed = f"{candidate.get('pattern_id', '?')}|{invariant[:120].lower()}"
    return hashlib.sha1(seed.encode()).hexdigest()[:12]


def _invoke_cascade(prompt: str) -> str | None:
    """Call the ranked API reasoning cascade. Returns synthesized text or
    None if every provider in the ranking failed / timed out."""
    try:
        from server.tools_analysis.synthesis import synthesis_reasoning
        return synthesis_reasoning.call(
            prompt=prompt, max_tokens=1024, temperature=0.3, profile="reasoning",
        )
    except Exception as e:
        logger.warning(f"reasoning cascade failed: {type(e).__name__}: {e}")
        return None


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"synthesize-generalizations: {SRC} not found, skipping")
        return 0
    with open(SRC) as f:
        report = json.load(f)
    candidates = report.get("candidates", [])
    if not candidates:
        print("synthesize-generalizations: no candidates, skipping")
        return 0

    existing = _load_existing_drafts()
    by_id = {d["id"]: d for d in existing}

    fresh_drafts: list[dict] = []
    synthesized = 0
    rejected = 0
    dup = 0
    carried = 0

    for c in candidates[:20]:  # hard cap per run — cascade time isn't free
        kb_texts = _load_kb_members(c.get("member_ids", []))
        kb_context = "\n\n".join(f"- {t[:300]}" for t in kb_texts[:6]) or "(none)"
        prompt = _STRUCTURED_PROMPT.format(
            pattern_id=c.get("pattern_id", "?"),
            tags=", ".join(c.get("shared_tags", [])) or "(none)",
            n_rounds=len(c.get("rounds", [])),
            rounds=", ".join(c.get("rounds", [])[:8]),
            member_count=c.get("member_count", 0),
            n_kb=len(kb_texts),
            kb_context=kb_context,
            specificity=c.get("specificity", 0),
        )
        raw = _invoke_cascade(prompt)
        if not raw:
            continue  # cascade exhausted — try again next run
        fields = _parse_structured(raw)
        if fields is None:
            rejected += 1
            continue
        invariant = fields["invariant"]
        # Novelty check — reject near-duplicates of anything already in drafts.
        is_dup = False
        for prev in existing:
            if _simple_cosine(invariant, prev.get("invariant", "")) >= NOVELTY_MAX_COSINE:
                is_dup = True
                # Bump stable_runs on the matching prior draft instead of
                # writing a new one.
                prev["stable_runs"] = prev.get("stable_runs", 0) + 1
                prev["last_seen_ts"] = int(time.time())
                prev["promotable"] = prev["stable_runs"] >= STABILITY_REQUIRED
                break
        if is_dup:
            dup += 1
            carried += 1
            continue
        draft_id = _draft_id(c, invariant)
        existing_hit = by_id.get(draft_id)
        if existing_hit:
            # Same synthesis as last run — increment stability.
            existing_hit["stable_runs"] = existing_hit.get("stable_runs", 0) + 1
            existing_hit["last_seen_ts"] = int(time.time())
            existing_hit["promotable"] = (
                existing_hit["stable_runs"] >= STABILITY_REQUIRED
            )
            carried += 1
            continue
        entry = {
            "id": draft_id,
            "pattern_id": c.get("pattern_id", "?"),
            "tags": c.get("shared_tags", []),
            "rounds": c.get("rounds", []),
            "member_count": c.get("member_count", 0),
            "specificity": c.get("specificity", 0),
            "invariant": invariant,
            "prediction": fields["prediction"],
            "counterexample": fields["counterexample"],
            "first_seen_ts": int(time.time()),
            "last_seen_ts": int(time.time()),
            "stable_runs": 1,
            "promotable": False,
        }
        fresh_drafts.append(entry)
        existing.append(entry)  # so subsequent candidates this run dedup against it
        by_id[draft_id] = entry
        synthesized += 1

    # Prune: anything not touched this run ages out after 10 missed runs.
    now_ts = int(time.time())
    AGED_OUT_AFTER_RUNS = 10
    RUN_GAP_S = 300  # approximate min time between runs
    kept: list[dict] = []
    for d in existing:
        if (now_ts - d.get("last_seen_ts", 0)) > AGED_OUT_AFTER_RUNS * RUN_GAP_S:
            continue
        kept.append(d)

    os.makedirs(os.path.dirname(DRAFT_OUT), exist_ok=True)
    with open(DRAFT_OUT, "w", encoding="utf-8") as f:
        for d in kept:
            f.write(json.dumps(d) + "\n")

    promotable = sum(1 for d in kept if d.get("promotable"))
    print(
        f"synthesize-generalizations: {synthesized} new drafts, "
        f"{carried} existing carried/stability-bumped, "
        f"{dup} duplicates, {rejected} cascade-rejected tautologies, "
        f"{promotable}/{len(kept)} promotable "
        f"(need {STABILITY_REQUIRED} stable runs + human promotion)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
