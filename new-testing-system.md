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
  - Supports `--strict` to report post-last-unit events as warnings (default non-strict silently ignores them)
  - Respects: note_off may occur after unit end
- Aux tools:
  - `scripts/analyzeAudit.js` — summarizer for audit report buckets
  - Unit tests should be added to lock behavior (see below)

---

## How to use (quick commands) 🧭
- Regenerate outputs: `npm run play` (produces `output/*.csv` and `output/units.json`)
- Run unit-tree audit (non-strict): `npm run unit-audit`
- Run audit (strict mode - warnings shown): `npm run unit-audit -- --strict`
- Summarize audit: `node scripts/analyzeAudit.js`

Acceptance criteria (basic):
- `output/units.json` non-empty
- `npm run unit-audit` returns **Errors=0** (non-strict)

---

## Why canonical `unitId` improved results 🧠
- Exact matching via `unitId` avoids ambiguous containment and rounding mismatch problems.
- The auditor can validate events deterministically by ID lookup, reducing false positives.

---

## Roadmap: Phrase alignment across layers (next major feature) 🚀
Goal: Verify phrase boundaries align in absolute time across layers (or report acceptable drift), enabling stronger cross-layer guarantees for multi-layer compositions.

Planned tasks:
1. Audit design & spec (this doc) — define tolerance and mapping rules.
2. Implement `scripts/phraseAlignmentAudit.js` with the following checks:
   - Load `output/units.json` and group units by canonical phrase identity (e.g., `sectionX/..|phraseY/..`) per layer.
   - For each phrase-group, compute absolute startTime and endTime from the unit entries (prefer phrase-level units when present; otherwise infer from measure aggregation).
   - Verify phrase startTimes across layers match within a configurable tolerance (e.g., 10ms / 0.01s or 1% depending on use-case).
   - Check phrase duration consistency and report mismatched durations or misordered phrases.
   - Produce a JSON report with counts, top mismatches, and examples (layer pairs, expected vs actual times).
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
- Integration test: run composition on a deterministic fixture -> assert `npm run unit-audit` returns Errors=0 non-strict and Warnings reasonable in strict mode.
- Phrase alignment unit tests: synthetic fixtures where we intentionally offset a layer phrase start and verify `phraseAlignmentAudit` reports it.

Example test commands:
- `npm test` (extend existing test suite)
- `node scripts/phraseAlignmentAudit.js --tolerance 0.02 --strict` (for CI)

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
