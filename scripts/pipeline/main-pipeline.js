/**
 * Main pipeline orchestrator.
 *
 * Replaces the verbose && chain in package.json with a single script that
 * runs every step sequentially, logs timing per step, and distinguishes
 * fatal pre-composition steps from non-fatal post-composition diagnostics.
 *
 * Invoked via: npm run main
 *
 * @module scripts/main-pipeline
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const MEASURE_TIMEOUT_SEC = 30;

// step definitions

const PRE_COMPOSITION = [
  { label: 'sync-instructions',       cmd: 'node scripts/pipeline/sync-instructions.js' },
  { label: 'generate-globals-dts',    cmd: 'node scripts/pipeline/generate-globals-dts.js' },
  { label: 'verify-boot-order',       cmd: 'node scripts/pipeline/verify-boot-order.js --fix' },
  { label: 'check-tuning-invariants', cmd: 'node scripts/pipeline/check-tuning-invariants.js' },
  { label: 'check-hypermeta-jurisdiction', cmd: 'node scripts/pipeline/check-hypermeta-jurisdiction.js' },
  { label: 'generate-feedback-graph', cmd: 'node scripts/pipeline/generate-feedback-graph.js' },
  { label: 'validate-feedback-graph', cmd: 'node scripts/pipeline/validate-feedback-graph.js' },
  { label: 'check-registration-coherence', cmd: 'node scripts/pipeline/check-registration-coherence.js' },
  { label: 'check-hme-coherence',     cmd: 'node scripts/pipeline/check-hme-coherence.js' },
  { label: 'check-safe-preboot-audit', cmd: 'node scripts/pipeline/check-safe-preboot-audit.js' },
  { label: 'fix-non-ascii',           cmd: 'node scripts/pipeline/fix-non-ascii.js' },
  { label: 'lint',                    cmd: 'npm run lint' },
  { label: 'typecheck',               cmd: 'npm run tc' },
];

const COMPOSITION = {
  label: 'composition',
  cmd:   'node scripts/utils/run-with-log.js main.log node src/play/main.js --trace',
};

const POST_COMPOSITION = [
  { label: 'trace-summary',            cmd: 'node scripts/pipeline/trace-summary.js' },
  { label: 'trace-replay',             cmd: 'node scripts/trace-replay.js --stats --json' },
  { label: 'check-manifest-health',    cmd: 'node scripts/pipeline/check-manifest-health.js' },
  { label: 'generate-dependency-graph', cmd: 'node scripts/pipeline/generate-dependency-graph.js' },
  { label: 'generate-conductor-map',   cmd: 'node scripts/pipeline/generate-conductor-map.js' },
  { label: 'generate-crosslayer-map',  cmd: 'node scripts/pipeline/generate-crosslayer-map.js' },
  { label: 'golden-fingerprint',       cmd: 'node scripts/pipeline/golden-fingerprint.js' },
  { label: 'narrative-digest',         cmd: 'node scripts/pipeline/narrative-digest.js' },
  { label: 'compare-runs',             cmd: 'node scripts/pipeline/compare-runs.js --against baseline' },
  { label: 'diff-compositions',        cmd: 'node scripts/pipeline/diff-compositions.js --against baseline' },
  { label: 'visualize-feedback-graph', cmd: 'node scripts/pipeline/visualize-feedback-graph.js' },
  { label: 'render-lite',              cmd: 'bash scripts/render-lite.sh' },
  { label: 'perceptual-analysis',     cmd: 'node scripts/pipeline/perceptual-analysis.js' },
  { label: 'snapshot-run',            cmd: 'node scripts/pipeline/snapshot-run.js --perceptual' },
  { label: 'train-verdict-predictor', cmd: 'node scripts/pipeline/train-verdict-predictor.js' },
  { label: 'build-kb-staleness-index', cmd: 'python3 scripts/pipeline/build-kb-staleness-index.py' },
  { label: 'check-kb-semantic-drift',  cmd: 'python3 scripts/pipeline/check-kb-semantic-drift.py' },
  { label: 'compute-coherence-score',  cmd: 'node scripts/pipeline/compute-coherence-score.js' },
  { label: 'generate-predictions',     cmd: 'node scripts/pipeline/generate-predictions.js' },
  { label: 'reconcile-predictions',    cmd: 'node scripts/pipeline/reconcile-predictions.js' },
  { label: 'compute-musical-correlation', cmd: 'node scripts/pipeline/compute-musical-correlation.js' },
  { label: 'compute-compositional-trajectory', cmd: 'node scripts/pipeline/compute-compositional-trajectory.js' },
  { label: 'compute-coherence-budget', cmd: 'node scripts/pipeline/compute-coherence-budget.js' },
  { label: 'compute-kb-trust-weights', cmd: 'python3 scripts/pipeline/compute-kb-trust-weights.py' },
  { label: 'compute-intention-gap',    cmd: 'node scripts/pipeline/compute-intention-gap.js' },
  { label: 'derive-constitution',      cmd: 'python3 scripts/pipeline/derive-constitution.py' },
  { label: 'detect-doc-drift',         cmd: 'python3 scripts/pipeline/detect-doc-drift.py' },
  { label: 'extract-generalizations',  cmd: 'python3 scripts/pipeline/extract-generalizations.py' },
  { label: 'render-generalizations',  cmd: 'python3 scripts/pipeline/render-generalizations.py' },
];

// runner

const timings = [];
const errorPatterns = [];

// Error keywords that indicate real failures even when exit code is 0.
// Each pattern: regex to match, severity label for reporting.
const ERROR_KEYWORDS = [
  { re: /Traceback \(most recent call last\)/i, tag: 'Python traceback' },
  { re: /RuntimeError:/i, tag: 'RuntimeError' },
  { re: /CUDA error/i, tag: 'CUDA error' },
  { re: /out of memory/i, tag: 'OOM' },
  { re: /MemoryError/i, tag: 'MemoryError' },
  { re: /FATAL:/i, tag: 'FATAL' },
  { re: /Segmentation fault/i, tag: 'segfault' },
  { re: /killed$/im, tag: 'process killed' },
];

function scanForErrors(label, output) {
  var found = [];
  for (var i = 0; i < ERROR_KEYWORDS.length; i++) {
    if (ERROR_KEYWORDS[i].re.test(output)) {
      found.push(ERROR_KEYWORDS[i].tag);
    }
  }
  if (found.length > 0) {
    errorPatterns.push({ label: label, errors: found });
    console.error('\n  *** ERROR DETECTED in ' + label + ': ' + found.join(', ') + ' ***');
  }
  return found;
}

function run(label, cmd, fatal) {
  const sep = '='.repeat(60);
  console.log('\n' + sep);
  console.log('  ' + label + (fatal ? '' : '  (non-fatal)'));
  console.log(sep + '\n');

  var t0 = Date.now();
  try {
    if (fatal) {
      execSync(cmd, { stdio: 'inherit', env: process.env });
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      timings.push({ label: label, elapsed: elapsed, ok: true });
      console.log('\n  ' + label + ' OK (' + elapsed + 's)');
    } else {
      // Capture stdout+stderr for non-fatal steps to scan for error keywords
      var result = spawnSync('sh', ['-c', cmd], { encoding: 'utf-8', env: process.env, maxBuffer: 50 * 1024 * 1024 });
      var combined = (result.stdout || '') + (result.stderr || '');
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      scanForErrors(label, combined);
      var elapsed2 = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.status === 0) {
        timings.push({ label: label, elapsed: elapsed2, ok: true });
        console.log('\n  ' + label + ' OK (' + elapsed2 + 's)');
      } else {
        timings.push({ label: label, elapsed: elapsed2, ok: false });
        console.warn('\n  WARNING: ' + label + ' failed (exit ' + (result.status || '?') + ') -- continuing.\n');
      }
    }
  } catch (err) {
    var elapsed3 = ((Date.now() - t0) / 1000).toFixed(1);
    timings.push({ label: label, elapsed: elapsed3, ok: false });
    if (fatal) {
      console.error('\n  FATAL: ' + label + ' failed (exit ' + (err.status || 1) + '). Pipeline aborted.\n');
      printSummary();
      process.exit(err.status || 1);
    }
    console.warn('\n  WARNING: ' + label + ' failed (exit ' + (err.status || '?') + ') -- continuing.\n');
  }
}

function printSummary() {
  var sep = '='.repeat(60);
  console.log('\n' + sep);
  console.log('  PIPELINE SUMMARY');
  console.log(sep);
  var total = 0;
  for (var i = 0; i < timings.length; i++) {
    var t = timings[i];
    var status = t.ok ? 'OK' : 'FAIL';
    var padLabel = (t.label + ' ').padEnd(36, '.');
    console.log('  ' + padLabel + ' ' + status.padEnd(4) + '  ' + t.elapsed + 's');
    total += Number(t.elapsed);
  }
  console.log(sep);
  console.log('  Total: ' + total.toFixed(1) + 's');
  console.log(sep);
  if (errorPatterns.length > 0) {
    console.log('');
    console.error('  !!! ERRORS DETECTED IN NON-FATAL STEPS !!!');
    for (var k = 0; k < errorPatterns.length; k++) {
      console.error('    ' + errorPatterns[k].label + ': ' + errorPatterns[k].errors.join(', '));
    }
    console.log('');
  }
  console.log('');
}

function writeSummaryJSON(wallTime) {
  var summary = {
    generated: new Date().toISOString(),
    wallTimeSeconds: Number(wallTime),
    steps: timings.map(function (t) {
      return { label: t.label, elapsedSeconds: Number(t.elapsed), ok: t.ok };
    }),
    passed: timings.filter(function (t) { return t.ok; }).length,
    failed: timings.filter(function (t) { return !t.ok; }).length,
    errorPatterns: errorPatterns.length > 0 ? errorPatterns : undefined
  };
  try {
    var outDir = path.join(__dirname, '../..', 'metrics');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'pipeline-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('  Pipeline summary -> metrics/pipeline-summary.json');
  } catch (e) {
    console.error('  FAILFAST: pipeline-summary.json write failed: ' + (e && e.message ? e.message : e));
    console.error('  Summary dump: ' + JSON.stringify(summary));
    throw e;
  }
}

// main

function main() {
  var pipelineStart = Date.now();
  console.log('Pipeline started at ' + new Date().toISOString());

  // Pre-composition: fatal on failure
  for (var i = 0; i < PRE_COMPOSITION.length; i++) {
    run(PRE_COMPOSITION[i].label, PRE_COMPOSITION[i].cmd, true);
  }

  // Composition: fatal on failure
  run(COMPOSITION.label, COMPOSITION.cmd, true);

  // Post-composition: non-fatal (diagnostics / reporting)
  for (var j = 0; j < POST_COMPOSITION.length; j++) {
    run(POST_COMPOSITION[j].label, POST_COMPOSITION[j].cmd, false);
  }

  var wallTime = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  printSummary();
  writeSummaryJSON(wallTime);
  console.log('Pipeline finished in ' + wallTime + 's');
}

main();
