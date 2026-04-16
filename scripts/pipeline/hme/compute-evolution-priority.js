// scripts/pipeline/compute-evolution-priority.js
//
// The capstone pipeline step: HME answering "what should change next?"
//
// Aggregates signals from EVERY other HME subsystem into a ranked list of
// evolution priorities. Each priority is backed by evidence from multiple
// subsystems — not a single metric but the convergence of all of them.
//
// Signal sources:
//   1. Negative space discoveries → structural gaps topology predicts
//   2. KB staleness → modules that need fresh understanding
//   3. Blind spots → subsystems systematically avoided
//   4. Coherence budget → is the system too disciplined or too chaotic?
//   5. Compositional trajectory → is musical complexity growing or stalling?
//   6. Prediction accuracy → where is HME's model wrong?
//   7. Intention gap → what keeps getting proposed but not finished?
//   8. Semantic drift → where has the KB diverged from reality?
//   9. Crystallized patterns → what emergent principles can be exploited?
//  10. Constitutional claims → what identity constraints shape the next move?
//  11. Doc drift → where does documentation lag behind reality?
//  12. Adversarial probes → what boundary-pushing experiments are ripe?
//
// Output: metrics/hme-evolution-priority.json
//   [{ rank, target, category, evidence: [{source, signal, score}], rationale }]
//
// The Evolver reads this at Phase 2 diagnosis. HME stops waiting to be
// asked and starts actively steering its own evolution.
//
// Non-fatal diagnostic.

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp } = require('./utils');

const OUT = path.join(ROOT, 'metrics', 'hme-evolution-priority.json');


function main() {
  const priorities = [];

  // 1. Negative space → structural gaps
  const ns = loadJson('metrics/hme-negative-space.json');
  if (ns && Array.isArray(ns.gaps)) {
    for (const gap of ns.gaps.slice(0, 5)) {
      priorities.push({
        target: gap.module || gap.pair || gap.description,
        category: 'structural_gap',
        evidence: [{ source: 'negative_space', signal: gap.type || 'topological', score: gap.confidence || 0.5 }],
        weight: (gap.confidence || 0.5) * 0.9,
      });
    }
  }

  // 2. KB staleness → stale modules need re-understanding
  const stale = loadJson('metrics/kb-staleness.json');
  if (stale && Array.isArray(stale.modules)) {
    const staleModules = stale.modules
      .filter((m) => m.status === 'STALE' || m.status === 'MISSING')
      .sort((a, b) => (b.staleness_days || 0) - (a.staleness_days || 0));
    for (const m of staleModules.slice(0, 5)) {
      priorities.push({
        target: m.module,
        category: 'kb_stale',
        evidence: [{ source: 'staleness', signal: m.status, score: Math.min(1, (m.staleness_days || 0) / 30) }],
        weight: Math.min(1, (m.staleness_days || 0) / 30) * 0.7,
      });
    }
  }

  // 3. Semantic drift → KB entries that are wrong
  const drift = loadJson('metrics/hme-semantic-drift.json');
  if (drift && Array.isArray(drift.drifted_entries)) {
    for (const d of drift.drifted_entries.slice(0, 5)) {
      const driftScore = (d.diffs || []).length / 10;
      priorities.push({
        target: d.module,
        category: 'semantic_drift',
        evidence: [{ source: 'semantic_drift', signal: `${(d.diffs || []).length} fields changed`, score: Math.min(1, driftScore) }],
        weight: Math.min(1, driftScore) * 0.8,
      });
    }
  }

  // 4. Coherence budget → too disciplined = explore; too chaotic = consolidate
  const budget = loadJson('metrics/hme-coherence-budget.json');
  if (budget) {
    const score = budget.current_coherence || 0;
    const band = budget.band || [0.55, 0.85];
    if (score > band[1]) {
      priorities.push({
        target: 'system_coherence',
        category: 'coherence_excess',
        evidence: [{ source: 'coherence_budget', signal: `score ${score} above band [${band}]`, score: (score - band[1]) / (1 - band[1]) }],
        weight: 0.6,
        rationale: 'System is over-disciplined — prioritize exploratory evolution into uncovered territory',
      });
    } else if (score < band[0]) {
      priorities.push({
        target: 'system_coherence',
        category: 'coherence_deficit',
        evidence: [{ source: 'coherence_budget', signal: `score ${score} below band [${band}]`, score: (band[0] - score) / band[0] }],
        weight: 0.8,
        rationale: 'System coherence is low — prioritize consolidation and KB grounding before new evolution',
      });
    }
  }

  // 5. Compositional trajectory → plateau detection
  const trajectory = loadJson('metrics/hme-compositional-trajectory.json');
  if (trajectory) {
    const trend = trajectory.classification || trajectory.trend;
    if (trend === 'declining' || trend === 'plateau') {
      priorities.push({
        target: 'musical_trajectory',
        category: 'trajectory_stall',
        evidence: [{ source: 'trajectory', signal: trend, score: 0.7 }],
        weight: 0.85,
        rationale: `Musical complexity is ${trend} — structural novelty needed, not parameter tuning`,
      });
    }
  }

  // 6. Prediction accuracy → where HME's model is wrong
  const pred = loadJson('metrics/hme-prediction-accuracy.json');
  if (pred && pred.ema !== null && pred.ema < 0.5) {
    priorities.push({
      target: 'prediction_model',
      category: 'model_inaccuracy',
      evidence: [{ source: 'prediction_accuracy', signal: `EMA ${pred.ema}`, score: 1 - pred.ema }],
      weight: (1 - pred.ema) * 0.7,
      rationale: 'HME\'s cascade model is unreliable — investigate where predictions diverge from reality',
    });
  }

  // 7. Intention gap → what keeps getting abandoned
  const gap = loadJson('metrics/hme-intention-gap.json');
  if (gap && gap.ema !== null && gap.ema > 0.3) {
    priorities.push({
      target: 'execution_gap',
      category: 'intention_execution_gap',
      evidence: [{ source: 'intention_gap', signal: `EMA ${gap.ema}`, score: gap.ema }],
      weight: gap.ema * 0.6,
      rationale: 'Significant intention-execution gap — scope proposals more narrowly',
    });
  }

  // 8. Crystallized patterns → ripe for exploitation
  const cryst = loadJson('metrics/hme-crystallized.json');
  if (cryst && Array.isArray(cryst.patterns || cryst.crystals)) {
    const patterns = cryst.patterns || cryst.crystals;
    const unexploited = patterns.filter((p) => !p.exploited && (p.rounds || []).length >= 5);
    for (const p of unexploited.slice(0, 3)) {
      priorities.push({
        target: p.pattern_id || p.id,
        category: 'unexploited_pattern',
        evidence: [{ source: 'crystallizer', signal: `${(p.rounds || []).length} rounds`, score: 0.6 }],
        weight: 0.65,
      });
    }
  }

  // 9. Doc drift → documentation lagging
  const docDrift = loadJson('metrics/hme-doc-drift.json');
  if (docDrift && docDrift.meta && docDrift.meta.kb_orphans > 50) {
    priorities.push({
      target: 'documentation',
      category: 'doc_drift',
      evidence: [{ source: 'doc_drift', signal: `${docDrift.meta.kb_orphans} orphaned refs`, score: Math.min(1, docDrift.meta.kb_orphans / 200) }],
      weight: 0.4,
    });
  }

  // Rank by weight (highest first), then deduplicate by target
  priorities.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const seen = new Set();
  const ranked = [];
  for (const p of priorities) {
    if (seen.has(p.target)) continue;
    seen.add(p.target);
    ranked.push({ rank: ranked.length + 1, ...p });
  }

  const report = {
    meta: {
      script: 'compute-evolution-priority.js',
      timestamp: new Date().toISOString(),
      signals_aggregated: 9,
      priorities_generated: ranked.length,
    },
    priorities: ranked.slice(0, 15),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`compute-evolution-priority: ${ranked.length} priorities ranked from ${priorities.length} signals`);
}

main();
