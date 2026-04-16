# Integration Notes — Deep Audit Pass (2026-04-16)

Tracked items from full feature audit against `new_integrations.md`.

---

## ~~Critical: Proxy Not Running~~ RESOLVED

Proxy now fully tested: 9 mock tests + 7 live API tests (all providers).
Multi-upstream routing via `X-HME-Upstream` header. Emergency valve
self-disables after 3 consecutive upstream failures. Coherence budget
gates injection. `sessionstart.sh` defaults `HME_PROXY_ENABLED=0`.
All 6 synthesis modules route through proxy when active.

**Remaining:** Activate on mainline when ready (`HME_PROXY_ENABLED=1`).

---

## ~~Coherence Score Window Boundary~~ RESOLVED

`sliceToRound()` now skips empty windows from consecutive `round_complete`
events. 0 writes in window = score 0.5 (unmeasured), not 1.0 (false perfect).

---

## ~~hme-predictions.jsonl Does Not Exist~~ RESOLVED

New pipeline step `generate-predictions.js` runs BFS on dependency graph
for each changed src/ file. First run: 15 predictions across 399 modules.
`reconcile-predictions.js` now has data; `hme-prediction-accuracy.json` exists.

---

## 206 Orphaned KB References (doc-drift)

Still present. Most are abstract concepts (globals, signal names) not files.
Not a code fix — needs a KB reconciliation pass during a round.

---

## Proxy System Prompt Budget Accounting

Enhancement. Proxy tracks `injection_influence` events — foundation for
behavioral impact measurement. Full budget accounting deferred.

---

## Crystallizer Jaccard Threshold

Enhancement. 19 patterns crystallized at current threshold. Semantic
similarity fallback worth exploring once pattern count plateaus.

---

## ~~Coherence Budget → Proxy~~ RESOLVED

`shouldInject()` reads `hme-coherence-budget.json`. When coherence is
ABOVE band, injection suppressed. Verified in test suite.

---

## ~~Cognitive Load Model~~ RESOLVED

Depends on coherence window fix (done). `cognitive_load.py` produces
`hme-cognitive-load.json` with session signatures.

---

## Multi-Agent Scaffolding — Dormant by Design

Observability scaffold complete. Activates when multi-agent operation begins.

---

## Ground Truth — 3 Entries

Human-dependent. Each listened round should get a `ground_truth` entry via
`learn(action='ground_truth')`. Statistical significance needs ~10+ entries.

---
