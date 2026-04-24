# Pipeline validators

Phase-gated checks run by `main-pipeline.js`. Each validator is a standalone script that reads project state, validates an invariant, and exits with `0` (pass) or non-zero (fail). Non-zero from ANY validator aborts the pipeline before composition starts — these are the guardrails that prevent broken runs from eating 10 minutes of wall time.

Validators run in deterministic order so earlier failures surface faster (cheap syntactic checks before expensive semantic ones). They must be idempotent, cwd-independent, and safe to run in parallel with `npm run main`.

## Current validators

- `check-manifest-health.js` — validates `output/metrics/feedback_graph.json`, registration manifests, and port declarations
- `check-registration-coherence.js` — every module that claims to self-register actually does
- `check-tuning-invariants.js` — numerical invariants on coupling matrix + gain budgets
- `check-hypermeta-jurisdiction.js` — bias-bounds manifest, 4-phase hypermeta boundary check (supports `--snapshot-bias-bounds`)
- `check-hme-coherence.js` — reads `output/metrics/hme-activity.jsonl`; fails on `coherence_violation` events in the current round. As of Apr 2026 the `write_without_hme_read` emitter was retired (legacy-MCP contract replaced by auto-enrichment middleware); the check runs as a no-op unless future `coherence_violation` variants are introduced.
- `check-kb-semantic-drift.py` — KB entries whose baseline signature has diverged from current code
- `check-safe-preboot-audit.js` — pre-boot side-effect audit (no writes, no network)

## Adding a validator

1. Write the script; read inputs, compute verdict, exit 0 or non-zero
2. Register it in `main-pipeline.js` at the correct phase position
3. Errors must go to `output/metrics/pipeline-summary.json` under `errorPatterns` (not just stdout — non-fatal steps get scanned)

<!-- HME-DIR-INTENT
rules:
  - Each validator exits with 0 (pass) or non-zero (fail); non-zero aborts the pipeline before composition
  - Validators must be idempotent, cwd-independent, and side-effect-free (no writes outside metrics/)
  - Non-fatal validator errors must be written to `output/metrics/pipeline-summary.json` errorPatterns — stdout alone gets missed by the LIFESAVER scanner
  - Run order is deterministic and matters — cheap syntactic checks first, expensive semantic ones last
  - New validators register in `scripts/pipeline/main-pipeline.js` at their correct phase position
-->
