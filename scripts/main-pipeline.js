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

const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const MEASURE_TIMEOUT_SEC = 30;

// step definitions

const PRE_COMPOSITION = [
  { label: 'generate-globals-dts',    cmd: 'node scripts/generate-globals-dts.js' },
  { label: 'verify-boot-order',       cmd: 'node scripts/verify-boot-order.js --fix' },
  { label: 'check-tuning-invariants', cmd: 'node scripts/check-tuning-invariants.js' },
  { label: 'check-hypermeta-jurisdiction', cmd: 'node scripts/check-hypermeta-jurisdiction.js' },
  { label: 'generate-feedback-graph', cmd: 'node scripts/generate-feedback-graph.js' },
  { label: 'validate-feedback-graph', cmd: 'node scripts/validate-feedback-graph.js' },
  { label: 'lint',                    cmd: 'npm run lint' },
  { label: 'typecheck',               cmd: 'npm run tc' },
];

const COMPOSITION = {
  label: 'composition',
  cmd:   'node scripts/run-with-log.js main.log node src/play/main.js --trace',
};

const POST_COMPOSITION = [
  { label: 'trace-summary',            cmd: 'node scripts/trace-summary.js' },
  { label: 'check-manifest-health',    cmd: 'node scripts/check-manifest-health.js' },
  { label: 'generate-dependency-graph', cmd: 'node scripts/generate-dependency-graph.js' },
  { label: 'generate-conductor-map',   cmd: 'node scripts/generate-conductor-map.js' },
  { label: 'generate-crosslayer-map',  cmd: 'node scripts/generate-crosslayer-map.js' },
  { label: 'golden-fingerprint',       cmd: 'node scripts/golden-fingerprint.js' },
  { label: 'narrative-digest',         cmd: 'node scripts/narrative-digest.js' },
  { label: 'compare-runs',             cmd: 'node scripts/compare-runs.js --against baseline' },
  { label: 'diff-compositions',        cmd: 'node scripts/diff-compositions.js --against baseline' },
  { label: 'visualize-feedback-graph', cmd: 'node scripts/visualize-feedback-graph.js' },
];

// runner

const timings = [];

function run(label, cmd, fatal) {
  const sep = '='.repeat(60);
  console.log('\n' + sep);
  console.log('  ' + label + (fatal ? '' : '  (non-fatal)'));
  console.log(sep + '\n');

  var t0 = Date.now();
  try {
    execSync(cmd, { stdio: 'inherit', env: process.env });
    var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    timings.push({ label: label, elapsed: elapsed, ok: true });
    console.log('\n  ' + label + ' OK (' + elapsed + 's)');
  } catch (err) {
    var elapsed2 = ((Date.now() - t0) / 1000).toFixed(1);
    timings.push({ label: label, elapsed: elapsed2, ok: false });
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
  console.log(sep + '\n');
}

function writeSummaryJSON(wallTime) {
  var summary = {
    generated: new Date().toISOString(),
    wallTimeSeconds: Number(wallTime),
    steps: timings.map(function (t) {
      return { label: t.label, elapsedSeconds: Number(t.elapsed), ok: t.ok };
    }),
    passed: timings.filter(function (t) { return t.ok; }).length,
    failed: timings.filter(function (t) { return !t.ok; }).length
  };
  try {
    var outDir = path.join(__dirname, '..', 'metrics');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'pipeline-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('  Pipeline summary -> metrics/pipeline-summary.json');
  } catch (e) {
    console.warn('  WARNING: failed to write pipeline-summary.json: ' + (e && e.message ? e.message : e));
  }
}

function runCompositionWithWatchdog() {
  run(COMPOSITION.label, COMPOSITION.cmd, true);
}

// main

function main() {
  var pipelineStart = Date.now();
  console.log('Pipeline started at ' + new Date().toISOString());

  // Pre-composition: fatal on failure
  for (var i = 0; i < PRE_COMPOSITION.length; i++) {
    run(PRE_COMPOSITION[i].label, PRE_COMPOSITION[i].cmd, true);
  }

  // Composition: fatal on failure, with measure-time watchdog
  runCompositionWithWatchdog();

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
