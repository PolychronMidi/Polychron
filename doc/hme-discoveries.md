# HME Discoveries

Human-curated universal principles promoted from HME's generalization draft
stream. Each entry has been reviewed and passed the promotion gate
(`learn(action='promote_discovery', id=<draft_id>)`).

## How entries get here

1. `extract-generalizations.py` scores every multi-round crystallized pattern
   against a project-specific vocabulary (see below). Patterns whose tag and
   synthesis tokens overlap <30% with project vocab become candidates.
2. `synthesize-generalizations.py` sends each candidate through the reasoning
   API cascade (Groq → Cerebras → Mistral → NVIDIA → OpenRouter → local) with
   a structured prompt asking for three fields: **invariant**,
   **falsifiable prediction in other systems**, **counterexample that would
   disprove it**. Output lands in `output/metrics/hme-discoveries-draft.jsonl`
   (gitignored, regenerated each pipeline run).
3. Drafts that persist unchanged for ≥3 consecutive pipeline runs and pass
   the novelty gate (cosine-similarity to every existing entry < 0.90)
   become eligible for human promotion.
4. A human reviews the draft and runs
   `learn(action='promote_discovery', id=<draft_id>)` — this moves the entry
   into this file as a permanent claim.

## Project-specific vocabulary (for specificity scoring)

Sourced dynamically at scoring time from:
- `scripts/pipeline/bias-bounds-manifest.json` — registered bias module keys
- `src/time/l0Channels.js` — canonical L0 channel names
- `src/<subsystem>/` — the nine subsystem directory names
- camelCase splits of the above to catch partial matches in tag strings

A pattern tagged `emergentMelodicEngine` now scores ~0.9 (highly specific to
Polychron's crossLayer melody stack) instead of the old 0.00.

---

*No entries yet. The first promoted claim will appear below this line.*
