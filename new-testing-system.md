# New Testing System (Framework + Roadmap) ✅

## Purpose 🎯
This document describes the current unit-tree audit framework and a roadmap to extend it into a broader testing system that validates phrase alignment and other absolute-time invariants across layers.

---

## Current framework (what exists now) 🔧
- Units manifest: `output/units.json` — contains entries with fields:
  - `unitId` (canonical string), `layer`, `startTick`, `endTick`, `startTime` (sec), `endTime` (sec)
  - Example ID: `layer2/2|section4/5|phrase4/6|measure1/8|beat5/2|subdivision4/3|subsubdivision1/3|2850000-3000000|0.000000-30.000000`
- CSV annotation: ticks now include appended `|<unitId>|<timeRange>` so events are resolved by ID instead of fragile containment.
  - Example CSV row: `1,7499|layer2/2|section1/6|phrase1/4|...|0-135000|0.000000-4.285714,control_c,...`
- Auditor: `scripts/unitTreeAudit.js`
  - Resolves events by `unitId` when present
  - Falls back to containment when needed
  - Runs in STRICT mode by default: post-last-unit events and other mismatches are reported as errors
  - Respects: note_off may occur after unit end
- Aux tools:
  - `scripts/analyzeAudit.js` — summarizer for audit report buckets
  - Unit tests should be added to lock behavior (see below)

---

## How to use (quick commands) 🧭
- Regenerate outputs (preferred): run the real composition engine so tests validate actual generated outputs (CSV + unit maps):
  - If you have a build: `npm run play` (runs `dist/play.js` and generates `output/*.csv` and `output/*map.json`).
  - For fast local runs or when a build isn't available: run the source engine directly: `PLAY_LIMIT=1 node src/play.js` (fast, deterministic when used with seeded RNG); on Windows use `cross-env PLAY_LIMIT=1 node src/play.js` in CI.
- Run unit-tree audit: `npm run unit-audit` (uses `scripts/test/unitTreeAudit.js`; validates event → unit mapping and reports gaps/overlaps). Use `--strict` or set `UNIT_AUDIT_STRICT=1` for harder failures in CI.
- Run phrase/track verifier: `npm run layer-alignment` (verification-only; writes diagnostics to `output/` but does not mutate CSVs).
- Summarize/triage: `analyze-audit` is **deprecated**; use the targeted triage utilities in `scripts/triage/` or `node scripts/test/analyzeAudit.js` for specific summarizers/diagnostics.

Acceptance criteria (basic):
- `output/units.json` exists and contains at least one canonical unit per active layer.
- `npm run unit-audit` returns Errors=0 (non-strict) and writes `output/unitTreeAudit-report.json`.
- `npm run layer-alignment` returns no phrase mismatches and trackDelta within the configured tolerance (see `--track-tolerance`).
- Regression: `npm run test` passes locally and `npm run onboard` completes cleanly before opening PRs or requesting broader review.

---

## Recent updates (2026-01-24) ✅
- Optimized per-layer marker cache implemented and marker-preference enabled across unit levels (`src/time.js`). ✅
- Temporary development DBG log removed from `src/time.js`. ✅
- Deterministic integration test for marker-preference added (`test/time.markerPreference.integration.test.js`) and passing locally. ✅
- CI workflow file added for marker-preference checks (`.github/workflows/marker-preference.yml`). ✅
- Onboarding & test infra: `scripts/onboard.js` converted to CommonJS so `npm run onboard` runs without syntax errors and prints checklist. `scripts/run-with-log.js` and `scripts/utils/stripAnsi.js` were converted to CommonJS to align test tooling; consider an explicit migration to ESM if you prefer ESM project-wide. ✅
- Added `test:ci` helper script for a concise play→audit→alignment CI run (fast fixture mode via `PLAY_LIMIT` recommended). ✅
- NOTE: `analyze-audit` is now considered deprecated; prefer `scripts/triage/*` tools for diagnostics and focused summarizers. ⚠️

---

## Why canonical `unitId` improved results 🧠
- Exact matching via `unitId` avoids ambiguous containment and rounding mismatch problems.
- The auditor can validate events deterministically by ID lookup, reducing false positives.

---

## Roadmap: Phrase alignment across layers (next major feature) 🚀
Goal: Verify phrase boundaries align in absolute time across layers (or report acceptable drift), enabling stronger cross-layer guarantees for multi-layer compositions.

Planned tasks:
1. Audit design & spec (this doc) — define tolerance and mapping rules.
- `scripts/test/layerAlignment.js` (implemented) with the following checks:
   - Loads unitRec entries and `unitMasterMap.json` when present; groups units by canonical phrase identity (e.g., `sectionX/...|phraseY/...`) per layer.
   - Computes per-phrase absolute start/end using unit-level times (prefers phrase-level units when present; falls back to measure aggregation or per-layer median tpSec when needed).
   - Verifies phrase startTimes across layers match within a configurable tolerance.
   - Checks phrase duration consistency and reports mismatched durations or misordered phrases; writes `output/layerAlignment-report.json`, and focused diagnostics including `output/layerAlignment-unitRec-mismatch.ndjson` for unitRec-derived mismatches.
   - Note: This verifier is *read-only* (does not modify CSVs) and intentionally ignores legacy `layerAlignment-corrections-applied.json` artifacts (it logs and does not report them).
3. Add flags/options:
   - `--tolerance <seconds>` and `--ignore-outro` to exclude after-last-unit events
   - `--strict` to fail on mismatches, otherwise warn
4. Integrate into CI: add a job that runs `npm run play` (or a fast fixture mode) + `npm run unit-audit` + `node scripts/phraseAlignmentAudit.js`.

Notes on matching logic:
- Because layers may have different structural detail (different subdivision splits), the audit should map phrases using section & phrase indices in `unitId` rather than raw ticks.
- Fallback heuristic: if no phrase-level unit exists, aggregate measure-level units to compute phrase ranges.

---

## Tests to add (short list) ✅
- Unit test for `unitId` canonical format (regex + presence of `|start-end|startSec-endSec`).
- Integration tests should exercise the *real* play engine in a deterministic fast mode (not static CSV fixtures): add a deterministic "play fixture" runner that sets `PLAY_LIMIT=1` and a seeded RNG to produce stable `output/*` artifacts quickly for CI, then assert `npm run unit-audit` returns Errors=0 and `npm run layer-alignment` passes.
- Phrase alignment unit tests: use the play-fixture to create controlled cases where a layer is offset, and verify `layerAlignment` reports mismatches (use `--tolerance` flags to test thresholds).
- Tests to add around auditor behavior: gap/overlap detection, canonicalization conflicts (`unitTreeAudit-canonicalization.json`), and `unitRec` aggregation consistency.

Example test commands:
- `npm test` (extend existing test suite)
- Quick CI: `cross-env PLAY_LIMIT=1 npm run play:raw && npm run unit-audit && npm run layer-alignment` (or `npm run test:ci` if available)
- For focused verification: `node scripts/test/layerAlignment.js --tolerance 0.02 --strict` (for CI)

---

## Implementation notes & guidelines 🔧
- Keep `unitId` deterministic and stable: prefer indices + totals (e.g., `section4/5`), not random hashes.
- Keep auditor fast: resolve by `unitId` map first before falling back to containment scans.
- Emit `startTime`/`endTime` using the same `tpSec` used for CSV generation to avoid rounding discrepancy.
- When disagreeing about an event’s unit, prefer conservative behavior: report as warning (or error in `--strict`).

---

## Next actions for me (if you'd like) ✅
- Implement `scripts/phraseAlignmentAudit.js` (quick prototype + tests).
- Add unit tests for `unitId` format and audit stability and wire into CI.

Tell me which of these to prioritize (prototype audit / tests / CI integration) and I'll implement it next.
