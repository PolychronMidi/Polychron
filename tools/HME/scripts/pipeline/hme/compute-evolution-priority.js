// HME evolution-priority capstone. Aggregates subsystem signals (negative
// space, blind spots, coherence budget, trajectory, prediction accuracy,
// intention gap, semantic drift, patterns, constitutional, doc drift,
// adversarial probes) -> ranked evidence-backed priorities. Output:
// metrics/hme-evolution-priority.json. Read by Evolver Phase 2. Non-fatal.

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp, metricPath } = require('./utils');

const OUT = metricPath('hme-evolution-priority.json');


function main() {
  const priorities = [];

  // 1. Negative space -> structural gaps
  const ns = loadJson(metricPath('hme-negative-space.json'));
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

  // 2. Semantic drift -> KB entries that are wrong
  const drift = loadJson(metricPath('hme-semantic-drift.json'));
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

  // 3. Coherence budget -> too disciplined = explore; too chaotic = consolidate
  const budget = loadJson(metricPath('hme-coherence-budget.json'));
  if (budget) {
    const score = budget.current_coherence || 0;
    const band = budget.band || [0.55, 0.85];
    if (score > band[1]) {
      priorities.push({
        target: 'system_coherence',
        category: 'coherence_excess',
        evidence: [{ source: 'coherence_budget', signal: `score ${score} above band [${band}]`, score: (score - band[1]) / (1 - band[1]) }],
        weight: 0.6,
        rationale: 'System is over-disciplined -- prioritize exploratory evolution into uncovered territory',
      });
    } else if (score < band[0]) {
      priorities.push({
        target: 'system_coherence',
        category: 'coherence_deficit',
        evidence: [{ source: 'coherence_budget', signal: `score ${score} below band [${band}]`, score: (band[0] - score) / band[0] }],
        weight: 0.8,
        rationale: 'System coherence is low -- prioritize consolidation and KB grounding before new evolution',
      });
    }
  }

  // 4. Compositional trajectory -> plateau detection
  const trajectory = loadJson(metricPath('hme-compositional-trajectory.json'));
  if (trajectory) {
    const trend = trajectory.classification || trajectory.trend;
    if (trend === 'declining' || trend === 'plateau') {
      priorities.push({
        target: 'musical_trajectory',
        category: 'trajectory_stall',
        evidence: [{ source: 'trajectory', signal: trend, score: 0.7 }],
        weight: 0.85,
        rationale: `Musical complexity is ${trend} -- structural novelty needed, not parameter tuning`,
      });
    }
  }

  // 5. Prediction accuracy -> where HME's model is wrong
  const pred = loadJson(metricPath('hme-prediction-accuracy.json'));
  if (pred && pred.ema !== null && pred.ema < 0.5) {
    priorities.push({
      target: 'prediction_model',
      category: 'model_inaccuracy',
      evidence: [{ source: 'prediction_accuracy', signal: `EMA ${pred.ema}`, score: 1 - pred.ema }],
      weight: (1 - pred.ema) * 0.7,
      rationale: 'HME\'s cascade model is unreliable -- investigate where predictions diverge from reality',
    });
  }

  // 6. Intention gap -> what keeps getting abandoned
  const gap = loadJson(metricPath('hme-intention-gap.json'));
  if (gap && gap.ema !== null && gap.ema > 0.3) {
    priorities.push({
      target: 'execution_gap',
      category: 'intention_execution_gap',
      evidence: [{ source: 'intention_gap', signal: `EMA ${gap.ema}`, score: gap.ema }],
      weight: gap.ema * 0.6,
      rationale: 'Significant intention-execution gap -- scope proposals more narrowly',
    });
  }

  // 7. Crystallized patterns -> ripe for exploitation
  const cryst = loadJson(metricPath('hme-crystallized.json'));
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

  // 8. Doc drift -> documentation lagging
  const docDrift = loadJson(metricPath('hme-doc-drift.json'));
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
      signals_aggregated: 8,
      priorities_generated: ranked.length,
    },
    priorities: ranked.slice(0, 15),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`compute-evolution-priority: ${ranked.length} priorities ranked from ${priorities.length} signals`);
}

main();
