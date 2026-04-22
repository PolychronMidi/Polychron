// scripts/compare-runs.js
// Profile A/B comparison tool: compares two composition runs side-by-side.
// Takes two run directories (or uses metrics/ vs a named snapshot) and produces
// a detailed comparison report showing what changed and why.
//
// Usage:
//   node scripts/compare-runs.js <dirA> <dirB>
//   node scripts/compare-runs.js --snapshot <name>       (save current metrics/ as named snapshot)
//   node scripts/compare-runs.js --against <name>        (compare metrics/ against snapshot)
//
// Snapshots are stored in metrics/snapshots/<name>/
// Output: metrics/run-comparison.json
//
// Example workflow:
//   node scripts/compare-runs.js --snapshot baseline
//   # ... make changes, run main ...
//   node scripts/compare-runs.js --against baseline

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const METRICS_DIR     = path.join(METRICS_DIR);
const COMPOSITION_DIR = path.join(ROOT, 'output');
const SNAPSHOT_DIR    = path.join(METRICS_DIR, 'snapshots');
const COMPARISON_PATH = path.join(METRICS_DIR, 'run-comparison.json');

// -Helpers -

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function loadRun(dir, csvDir) {
  var effectiveCsvDir = csvDir || dir;
  const run = { dir };

  // Fingerprint
  run.fingerprint = loadJSON(path.join(dir, 'golden-fingerprint.json'));

  // Trace summary
  run.summary = loadJSON(path.join(dir, 'trace-summary.json'));

  // System manifest
  run.manifest = loadJSON(path.join(dir, 'system-manifest.json'));

  // Trace entries (lightweight: just count and sample)
  const tracePath = path.join(dir, 'trace.jsonl');
  run.traceEntries = [];
  if (fs.existsSync(tracePath)) {
    const raw = fs.readFileSync(tracePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    run.traceEntries = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  }

  // Note counts from CSV
  run.noteCounts = {};
  for (const layer of ['output1', 'output2']) {
    const csvPath = path.join(effectiveCsvDir, layer + '.csv');
    if (!fs.existsSync(csvPath)) continue;
    const raw = fs.readFileSync(csvPath, 'utf8');
    let count = 0;
    for (const line of raw.split(/\r?\n/)) {
      const cols = line.split(',');
      if (cols.length >= 6 && cols[2] && cols[2].trim() === 'note_on_c') {
        const vel = toNum(cols[5], 0);
        if (vel > 0) count++;
      }
    }
    run.noteCounts[layer] = count;
  }

  return run;
}

// -Comparison Logic -

function compareRuns(runA, runB) {
  const report = {
    meta: {
      generated: new Date().toISOString(),
      dirA: runA.dir,
      dirB: runB.dir
    },
    sections: []
  };

  // 1. Note counts
  const noteSection = { name: 'Note Output', metrics: [] };
  for (const layer of ['output1', 'output2']) {
    const a = runA.noteCounts[layer] || 0;
    const b = runB.noteCounts[layer] || 0;
    const pct = a > 0 ? ((b - a) / a * 100).toFixed(1) : 'N/A';
    noteSection.metrics.push({ metric: `${layer} notes`, A: a, B: b, change: `${pct}%` });
  }
  report.sections.push(noteSection);

  // 2. Fingerprint comparison
  if (runA.fingerprint && runB.fingerprint) {
    const fpSection = { name: 'Fingerprint Dimensions', metrics: [] };
    const fa = runA.fingerprint;
    const fb = runB.fingerprint;

    fpSection.metrics.push({ metric: 'pitchEntropy', A: toNum(fa.pitchEntropy, 0).toFixed(3), B: toNum(fb.pitchEntropy, 0).toFixed(3) });
    fpSection.metrics.push({ metric: 'densityMean', A: toNum(fa.density && fa.density.mean, 0).toFixed(3), B: toNum(fb.density && fb.density.mean, 0).toFixed(3) });
    fpSection.metrics.push({ metric: 'densityVariance', A: toNum(fa.density && fa.density.variance, 0).toFixed(4), B: toNum(fb.density && fb.density.variance, 0).toFixed(4) });
    fpSection.metrics.push({ metric: 'trustConvergence', A: toNum(fa.trustConvergence, 0).toFixed(3), B: toNum(fb.trustConvergence, 0).toFixed(3) });

    if (fa.tensionArc && fb.tensionArc) {
      fpSection.metrics.push({ metric: 'tensionArc', A: fa.tensionArc.map(v => v.toFixed(3)), B: fb.tensionArc.map(v => v.toFixed(3)) });
    }

    if (fa.exceedanceSeverity || fb.exceedanceSeverity) {
      fpSection.metrics.push({
        metric: 'exceedanceSeverity (beats)',
        A: toNum(fa.exceedanceSeverity && Object.values(fa.exceedanceSeverity).reduce((sum, v) => sum + v, 0), 0),
        B: toNum(fb.exceedanceSeverity && Object.values(fb.exceedanceSeverity).reduce((sum, v) => sum + v, 0), 0)
      });
    }

    if (fa.hotspotMigration || fb.hotspotMigration) {
      const hotA = fa.hotspotMigration || {};
      const hotB = fb.hotspotMigration || {};
      fpSection.metrics.push({ metric: 'hotspotTopPair', A: hotA.topPair || 'none', B: hotB.topPair || 'none' });
      fpSection.metrics.push({ metric: 'hotspotTop2Concentration', A: toNum(hotA.top2Concentration, 0).toFixed(4), B: toNum(hotB.top2Concentration, 0).toFixed(4) });
      fpSection.metrics.push({ metric: 'hotspotTrustAxisShare', A: toNum(hotA.axisShares && hotA.axisShares.trust, 0).toFixed(4), B: toNum(hotB.axisShares && hotB.axisShares.trust, 0).toFixed(4) });
      fpSection.metrics.push({ metric: 'hotspotPhaseAxisShare', A: toNum(hotA.axisShares && hotA.axisShares.phase, 0).toFixed(4), B: toNum(hotB.axisShares && hotB.axisShares.phase, 0).toFixed(4) });
    }

    if (fa.telemetryHealth || fb.telemetryHealth) {
      const telA = fa.telemetryHealth || {};
      const telB = fb.telemetryHealth || {};
      fpSection.metrics.push({ metric: 'telemetryHealthScore', A: toNum(telA.score, 0).toFixed(4), B: toNum(telB.score, 0).toFixed(4) });
      fpSection.metrics.push({ metric: 'telemetryPhaseIntegrity', A: telA.phaseIntegrity || 'unknown', B: telB.phaseIntegrity || 'unknown' });
      fpSection.metrics.push({ metric: 'telemetryUnderSeenPairs', A: toNum(telA.underSeenPairCount, 0), B: toNum(telB.underSeenPairCount, 0) });
    }

    report.sections.push(fpSection);
  }

  // 3. Regime distribution
  if (runA.fingerprint && runB.fingerprint) {
    const regA = runA.fingerprint.regimeDistribution || {};
    const regB = runB.fingerprint.regimeDistribution || {};
    const allRegimes = new Set([...Object.keys(regA), ...Object.keys(regB)]);
    const regSection = { name: 'Regime Distribution', metrics: [] };
    for (const r of [...allRegimes].sort()) {
      regSection.metrics.push({
        metric: r,
        A: ((regA[r] || 0) * 100).toFixed(1) + '%',
        B: ((regB[r] || 0) * 100).toFixed(1) + '%'
      });
    }
    report.sections.push(regSection);
  }

  // 4. Trust final scores
  if (runA.fingerprint && runB.fingerprint) {
    const trustA = runA.fingerprint.trustFinal || {};
    const trustB = runB.fingerprint.trustFinal || {};
    const allKeys = new Set([...Object.keys(trustA), ...Object.keys(trustB)]);
    const trustSection = { name: 'Trust Scores (final avg)', metrics: [] };
    for (const k of [...allKeys].sort()) {
      trustSection.metrics.push({
        metric: k,
        A: toNum(trustA[k], 0).toFixed(3),
        B: toNum(trustB[k], 0).toFixed(3)
      });
    }
    report.sections.push(trustSection);
  }

  // 5. Trace statistics
  const traceSection = { name: 'Trace Statistics', metrics: [] };
  traceSection.metrics.push({ metric: 'traceEntries', A: runA.traceEntries.length, B: runB.traceEntries.length });

  // Average tension
  const tensionA = runA.traceEntries.map(e => toNum(e.snap && e.snap.tension, NaN)).filter(Number.isFinite);
  const tensionB = runB.traceEntries.map(e => toNum(e.snap && e.snap.tension, NaN)).filter(Number.isFinite);
  traceSection.metrics.push({ metric: 'avgTension', A: mean(tensionA).toFixed(3), B: mean(tensionB).toFixed(3) });

  // Average playProb
  const ppA = runA.traceEntries.map(e => toNum(e.snap && e.snap.playProb, NaN)).filter(Number.isFinite);
  const ppB = runB.traceEntries.map(e => toNum(e.snap && e.snap.playProb, NaN)).filter(Number.isFinite);
  traceSection.metrics.push({ metric: 'avgPlayProb', A: mean(ppA).toFixed(3), B: mean(ppB).toFixed(3) });

  // Notes embedded in trace (evolution #1)
  const notesInTraceA = runA.traceEntries.reduce((s, e) => s + (e.notes ? e.notes.length : 0), 0);
  const notesInTraceB = runB.traceEntries.reduce((s, e) => s + (e.notes ? e.notes.length : 0), 0);
  if (notesInTraceA > 0 || notesInTraceB > 0) {
    traceSection.metrics.push({ metric: 'traceEmbeddedNotes', A: notesInTraceA, B: notesInTraceB });
  }

  report.sections.push(traceSection);

  // 6. Manifest differences
  if (runA.manifest && runB.manifest) {
    const manSection = { name: 'System Manifest', metrics: [] };
    const mA = runA.manifest;
    const mB = runB.manifest;
    if (mA.registries && mB.registries) {
      const ciA = mA.registries.conductorIntelligence;
      const ciB = mB.registries.conductorIntelligence;
      if (ciA && ciB) {
        manSection.metrics.push({ metric: 'CI modules', A: ciA.moduleCount || 0, B: ciB.moduleCount || 0 });
      }
      const clA = mA.registries.crossLayer;
      const clB = mB.registries.crossLayer;
      if (clA && clB) {
        manSection.metrics.push({ metric: 'CL modules', A: clA.moduleCount || 0, B: clB.moduleCount || 0 });
      }
    }
    report.sections.push(manSection);
  }

  // Overall verdict
  const totalNoteA = (runA.noteCounts.output1 || 0) + (runA.noteCounts.output2 || 0);
  const totalNoteB = (runB.noteCounts.output1 || 0) + (runB.noteCounts.output2 || 0);
  const noteRatio = totalNoteA > 0 ? Math.abs(totalNoteB - totalNoteA) / totalNoteA : 0;
  report.verdict = noteRatio < 0.1 ? 'SIMILAR' : noteRatio < 0.35 ? 'DIFFERENT' : 'DIVERGENT';

  return report;
}

// -Snapshot Management -

function saveSnapshot(name) {
  const snapDir = path.join(SNAPSHOT_DIR, name);
  fs.mkdirSync(snapDir, { recursive: true });
  const metricsFiles = [
    'golden-fingerprint.json', 'trace-summary.json', 'system-manifest.json',
    'trace.jsonl'
  ];
  const compositionFiles = ['output1.csv', 'output2.csv'];
  let copied = 0;
  for (const f of metricsFiles) {
    const src = path.join(METRICS_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(snapDir, f));
      copied++;
    }
  }
  for (const f of compositionFiles) {
    const src = path.join(COMPOSITION_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(snapDir, f));
      copied++;
    }
  }
  console.log(`compare-runs: snapshot '${name}' saved (${copied} files) -> metrics/snapshots/${name}/`);
}

// -CLI -

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--snapshot' && args[1]) {
    saveSnapshot(args[1]);
    return;
  }

  let dirA, dirB, csvDirB;

  if (args[0] === '--against' && args[1]) {
    dirA = path.join(SNAPSHOT_DIR, args[1]);
    dirB = METRICS_DIR;
    csvDirB = COMPOSITION_DIR;
    if (!fs.existsSync(dirA)) {
      throw new Error(`compare-runs: snapshot '${args[1]}' not found at ${dirA}`);
    }
  } else if (args.length >= 2) {
    dirA = path.resolve(args[0]);
    dirB = path.resolve(args[1]);
  } else {
    console.log('Usage:');
    console.log('  node scripts/compare-runs.js <dirA> <dirB>');
    console.log('  node scripts/compare-runs.js --snapshot <name>');
    console.log('  node scripts/compare-runs.js --against <name>');
    process.exit(1);
  }

  if (!fs.existsSync(dirA)) throw new Error(`compare-runs: directory not found: ${dirA}`);
  if (!fs.existsSync(dirB)) throw new Error(`compare-runs: directory not found: ${dirB}`);

  const runA = loadRun(dirA);
  const runB = loadRun(dirB, csvDirB);
  const report = compareRuns(runA, runB);

  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(COMPARISON_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`compare-runs: ${report.verdict} (${report.sections.length} sections) -> metrics/run-comparison.json`);
  for (const section of report.sections) {
    console.log(`  ${section.name}: ${section.metrics.length} metrics`);
  }
}

main();
