# Integration Notes — Deep Audit Pass (2026-04-16)

Items that piqued interest during the full feature audit. Each is a potential
enhancement or investigation target, not a blocking issue.

---

## Critical: Proxy Not Running

The inference proxy (tools/HME/proxy/hme_proxy.js) is fully implemented but
**never launched**. sessionstart.sh doesn't start it. ANTHROPIC_BASE_URL is
never pointed at :9099. This means:
- Inference-side coherence violations are invisible
- Jurisdiction injection (Tier 2 Feature 1) is dead code in production
- Prediction logging from proxy → hme-predictions.jsonl never fires
- Reflexivity model (Tier 6) has no injected predictions to score
- All downstream features that depend on proxy data are running on empty

**Action:** Wire proxy launch into sessionstart.sh. Set ANTHROPIC_BASE_URL=http://localhost:9099
in Claude Code project settings. This is the single highest-leverage fix —
it activates Tiers 2, 3, and 6 features that are currently implemented but
data-starved.

---

## Coherence Score Window Boundary Is Stale

compute-coherence-score.js slices activity events to the "current round"
using the last round_complete event as boundary. But round_complete events
are only emitted by the stop.sh hook or manually via emit.py. Between
pipeline runs, the window contains 0 file_written events even though 530+
edits have happened since. Score shows perfect 1.0 with no evidence.

**Action:** The window boundary should include ALL events since the last
round_complete, not just events before it. This is a slicing bug — events
after the last round_complete are the current round's events. Check
compute-coherence-score.js sliceToRound() logic.

---

## hme-predictions.jsonl Does Not Exist

cascade_analysis.py has _log_prediction() but it only fires when
trace(mode='impact') is called during a session. No session has triggered
it yet since the feature was implemented. Downstream: reconcile-predictions.js
has nothing to reconcile, so hme-prediction-accuracy.json is never written,
so prediction_accuracy_report() and reflexivity_report() show empty.

**Action:** Either auto-trigger cascade predictions during review(mode='forget')
for each changed file, or add a pipeline step that generates predictions from
the current round's edit set. The cascade analysis code is solid — it just
needs a trigger.

---

## 206 Orphaned KB References (doc-drift)

hme-doc-drift.json shows 206 out of 308 KB-referenced module names have no
matching source file. This is a 67% orphan rate. Most are in ARCHITECTURE.md
(62 orphans) and TUNING_MAP.md (32 orphans). Either the modules were renamed,
the KB entries are stale, or the docs reference abstract concepts not files.

**Action:** Run a one-time KB cleanup pass correlating orphaned names against
git log renames. Many may be legitimate renames that the KB didn't track.

---

## Proxy Architecture Could Enable System Prompt Budget Accounting

The proxy sees every inference call's full message history. It could track
how much of the system prompt budget HME injections consume and whether
the Evolver's behavior changes after injection vs without. This would
give the self-audit (Tier 4) real behavioral data instead of just
counting tool calls.

---

## Crystallizer Jaccard Threshold May Be Too Aggressive

crystallizer.py groups KB entries by tag overlap with Jaccard >= 0.5. With
112 KB entries and potentially sparse tagging, this might miss patterns
that share semantic meaning but not literal tags. Could experiment with
a semantic similarity fallback (embed tags, compare cosine) for entries
that fail the Jaccard threshold but cluster in embedding space.

---

## Coherence Budget Shows ABOVE Band

hme-coherence-budget.json has coherence at 1.0 vs band [0.55, 0.85].
The design doc explicitly warns: "When coherence is too high — the system
is too disciplined, surprises have stopped — the proxy actively relaxes
injection constraints." But the proxy isn't running, so this prescription
can't be acted on. Once the proxy is live, the budget state should
influence injection behavior.

---

## Cognitive Load Model Has No Data

cognitive_load.py reads activity events split by round_complete boundaries.
With the stale window boundary issue, the cognitive load model may also
be running on empty or misaligned data. Verify after fixing the coherence
window slicing.

---

## Multi-Agent Scaffolding Is Ready But Dormant

multi_agent.py computes inter-agent coherence metrics but all events have
role='single' since we're not running multiple agents. The scaffolding is
correct — when multi-agent mode is activated, the metrics will flow. This
is dormant by design, not broken.

---

## Ground Truth Has 3 Entries Only

hme-ground-truth.jsonl exists with actual human listening verdicts, but only
3 entries. The musical correlation computation (hme-musical-correlation.json)
needs more data points to be statistically meaningful. Each pipeline run that
gets a listening verdict should get a ground_truth entry.

---
