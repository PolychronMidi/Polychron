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

const cp = require('child_process');
const { execSync, spawnSync } = cp;
const fs   = require('fs');
const path = require('path');
const METRICS_DIR = process.env.METRICS_DIR || path.join(__dirname, '..', '..', 'output', 'metrics');

const MEASURE_TIMEOUT_SEC = 30;

// step definitions

const PRE_COMPOSITION = [
  { label: 'check-root-only-dirs',         cmd: 'node scripts/pipeline/validators/check-root-only-dirs.js' },
  { label: 'sync-instructions',            cmd: 'node scripts/pipeline/sync-instructions.js' },
  { label: 'generate-globals-dts',         cmd: 'node scripts/pipeline/generators/generate-globals-dts.js' },
  { label: 'verify-boot-order',            cmd: 'node scripts/pipeline/verify-boot-order.js --fix' },
  { label: 'check-tuning-invariants',      cmd: 'node scripts/pipeline/validators/check-tuning-invariants.js' },
  { label: 'check-hypermeta-jurisdiction',  cmd: 'node scripts/pipeline/validators/check-hypermeta-jurisdiction.js' },
  { label: 'generate-feedback-graph',      cmd: 'node scripts/pipeline/generators/generate-feedback-graph.js' },
  { label: 'validate-feedback-graph',      cmd: 'node scripts/pipeline/validate-feedback-graph.js' },
  { label: 'check-registration-coherence', cmd: 'node scripts/pipeline/validators/check-registration-coherence.js' },
  // check-hme-coherence removed (Apr 2026). The `write_without_hme_read`
  // emitter it policed was retired -- the check ran as a permanent no-op.
  // Auto-enrichment middleware (edit_context.js, read_context.js,
  // dir_context.js) now attaches KB context to every Edit/Read tool_result,
  // so the legacy "did the agent explicitly invoke HME_read?" contract no
  // longer applies. Script is kept at scripts/pipeline/validators/check-hme-coherence.js
  // for history but is no longer wired into the pipeline.
  { label: 'check-safe-preboot-audit',     cmd: 'node scripts/pipeline/validators/check-safe-preboot-audit.js' },
  { label: 'fix-non-ascii',                cmd: 'node scripts/pipeline/fix-non-ascii.js' },
  { label: 'lint',                          cmd: 'npm run lint' },
  { label: 'typecheck',                    cmd: 'npm run tc' },
];

const COMPOSITION = {
  label: 'composition',
  cmd:   'node scripts/utils/run-with-log.js main.log node src/play/main.js --trace',
};

const POST_COMPOSITION = [
  { label: 'trace-summary',                cmd: 'node scripts/pipeline/trace-summary.js' },
  { label: 'trace-replay',                 cmd: 'node scripts/trace-replay.js --stats --json' },
  { label: 'check-manifest-health',        cmd: 'node scripts/pipeline/validators/check-manifest-health.js' },
  { label: 'generate-dependency-graph',    cmd: 'node scripts/pipeline/generators/generate-dependency-graph.js' },
  { label: 'generate-conductor-map',       cmd: 'node scripts/pipeline/generators/generate-conductor-map.js' },
  { label: 'generate-crosslayer-map',      cmd: 'node scripts/pipeline/generators/generate-crosslayer-map.js' },
  { label: 'golden-fingerprint',           cmd: 'node scripts/pipeline/golden-fingerprint.js' },
  { label: 'narrative-digest',             cmd: 'node scripts/pipeline/narrative-digest.js' },
  { label: 'compare-runs',                 cmd: 'node scripts/pipeline/compare-runs.js --against baseline' },
  { label: 'diff-compositions',            cmd: 'node scripts/pipeline/diff-compositions.js --against baseline' },
  { label: 'visualize-feedback-graph',     cmd: 'node scripts/pipeline/visualize-feedback-graph.js' },
  { label: 'render-lite',                  cmd: 'bash scripts/render-lite.sh' },
  { label: 'perceptual-analysis',          cmd: 'node scripts/pipeline/perceptual-analysis.js' },
  { label: 'snapshot-run',                 cmd: 'node scripts/pipeline/snapshot-run.js --perceptual' },
  { label: 'train-verdict-predictor',      cmd: 'node scripts/pipeline/train-verdict-predictor.js' },
  // -- HME self-coherence steps --
  { label: 'build-kb-staleness-index',     cmd: 'python3 scripts/pipeline/hme/build-kb-staleness-index.py' },
  { label: 'check-kb-semantic-drift',      cmd: 'python3 scripts/pipeline/hme/check-kb-semantic-drift.py' },
  { label: 'compute-coherence-score',      cmd: 'node scripts/pipeline/hme/compute-coherence-score.js' },
  { label: 'generate-predictions',         cmd: 'node scripts/pipeline/generators/generate-predictions.js' },
  { label: 'reconcile-predictions',        cmd: 'node scripts/pipeline/hme/reconcile-predictions.js' },
  { label: 'compute-musical-correlation',  cmd: 'node scripts/pipeline/hme/compute-musical-correlation.js' },
  { label: 'compute-compositional-trajectory', cmd: 'node scripts/pipeline/hme/compute-compositional-trajectory.js' },
  { label: 'compute-coherence-budget',     cmd: 'node scripts/pipeline/hme/compute-coherence-budget.js' },
  { label: 'compute-kb-trust-weights',     cmd: 'python3 scripts/pipeline/hme/compute-kb-trust-weights.py' },
  { label: 'compute-intention-gap',        cmd: 'node scripts/pipeline/hme/compute-intention-gap.js' },
  { label: 'derive-constitution',          cmd: 'python3 scripts/pipeline/hme/derive-constitution.py' },
  { label: 'detect-doc-drift',             cmd: 'python3 scripts/pipeline/hme/detect-doc-drift.py' },
  { label: 'extract-generalizations',      cmd: 'python3 scripts/pipeline/hme/extract-generalizations.py' },
  { label: 'synthesize-generalizations',   cmd: 'python3 scripts/pipeline/hme/synthesize-generalizations.py' },
  { label: 'compute-evolution-priority',   cmd: 'node scripts/pipeline/hme/compute-evolution-priority.js' },
  { label: 'emit-legacy-override-history', cmd: 'node scripts/pipeline/hme/emit-legacy-override-history.js' },
  { label: 'compute-consensus',            cmd: 'node scripts/pipeline/hme/compute-consensus.js' },
  { label: 'compute-invariant-efficacy',   cmd: 'python3 scripts/pipeline/hme/compute-invariant-efficacy.py' },
  { label: 'compute-legendary-drift',      cmd: 'python3 scripts/pipeline/hme/compute-legendary-drift.py' },
  { label: 'match-patterns',               cmd: 'python3 scripts/pipeline/hme/match-patterns.py' },
  { label: 'emit-arc-timeseries',          cmd: 'python3 scripts/pipeline/hme/emit-arc-timeseries.py' },
  { label: 'compute-blindspots',           cmd: 'python3 scripts/pipeline/hme/compute-blindspots.py' },
  { label: 'propose-next-actions',         cmd: 'python3 scripts/pipeline/hme/propose-next-actions.py' },
  { label: 'adapt-from-activity',          cmd: 'python3 tools/HME/scripts/adapt-from-activity.py' },
  { label: 'verify-coherence-registry',    cmd: 'python3 tools/HME/scripts/verify-coherence-registry.py' },
  { label: 'auto-investigate',             cmd: 'python3 scripts/pipeline/hme/auto-investigate.py' },
  { label: 'antagonism-registry-auto-append', cmd: 'python3 scripts/check-antagonism-registry.py --auto-append' },
  { label: 'compact-lance-tables',          cmd: 'python3 scripts/compact-lance-tables.py' },
  { label: 'archive-activity',             cmd: 'python3 scripts/pipeline/hme/archive-activity.py' },
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
  console.log('\n');
  console.log('  ' + label + (fatal ? '' : '  (non-fatal)'));
  console.log('\n');

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
  console.log('\n');
  console.log('  PIPELINE SUMMARY');
  console.log('\n');
  var total = 0;
  for (var i = 0; i < timings.length; i++) {
    var t = timings[i];
    var status = t.ok ? 'OK' : 'FAIL';
    var padLabel = (t.label + ' ').padEnd(36, '.');
    console.log('  ' + padLabel + ' ' + status.padEnd(4) + '  ' + t.elapsed + 's');
    total += Number(t.elapsed);
  }
  console.log('\n');
  console.log('  Total: ' + total.toFixed(1) + 's');
  console.log('\n');
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

function writeSummaryJSON(wallTime, extra) {
  var summary = {
    generated: new Date().toISOString(),
    wallTimeSeconds: Number(wallTime),
    verdict: (extra && extra.verdict) || 'UNKNOWN',
    steps: timings.map(function (t) {
      return { label: t.label, elapsedSeconds: Number(t.elapsed), ok: t.ok };
    }),
    passed: timings.filter(function (t) { return t.ok; }).length,
    failed: timings.filter(function (t) { return !t.ok; }).length,
    errorPatterns: errorPatterns.length > 0 ? errorPatterns : undefined
  };
  // Compute HCI inline so pipeline-summary.json always carries both the
  // music verdict AND the coherence index. Previously this was done by
  // posttooluse_bash.sh, which meant non-Claude invocations produced an
  // hci=null summary. The HCI computation has no hook-specific context --
  // it's just a subprocess call -- so it belongs here.
  try {
    var hciScript = path.join(__dirname, '..', '..', 'tools', 'HME', 'scripts', 'verify-coherence.py');
    if (fs.existsSync(hciScript)) {
      var hciOut = cp.spawnSync('python3', [hciScript, '--score'], {
        encoding: 'utf8', timeout: 30_000,
        env: Object.assign({}, process.env, {
          PROJECT_ROOT: path.join(__dirname, '..', '..'),
        }),
      });
      var hciStr = (hciOut.stdout || '').trim();
      if (hciStr && /^\d+$/.test(hciStr)) {
        summary.hci = parseInt(hciStr, 10);
        summary.hci_captured_at = Math.floor(Date.now() / 1000);
      }
    }
  } catch (e) {
    console.error('  HCI compute failed: ' + (e && e.message ? e.message : e));
  }
  // R17 #3+#7: Enrich summary with rebalance cost + per-override fire sparklines
  // from legacy-override-history.jsonl. i/status and downstream tools can read
  // these directly without scanning the activity log or trace.
  try {
    var histPath = path.join(METRICS_DIR, 'legacy-override-history.jsonl');
    if (fs.existsSync(histPath)) {
      var histLines = fs.readFileSync(histPath, 'utf8').split('\n').filter(Boolean);
      var last5 = histLines.slice(-5).map(function(l) {
        try { return JSON.parse(l); } catch (_e2) { return null; }
      }).filter(Boolean);
      if (last5.length > 0) {
        var fireTrends = {};
        last5.forEach(function(r) {
          Object.keys(r.fires || {}).forEach(function(id) {
            if (!fireTrends[id]) fireTrends[id] = [];
            fireTrends[id].push(r.fires[id]);
          });
        });
        summary.legacy_override_fires_last_5 = fireTrends;
        // Total axis rebalance cost from most recent history row
        var latest = last5[last5.length - 1];
        var totalAdj = Object.values(latest.per_axis_adj || {})
          .reduce(function(a, b) { return a + (typeof b === 'number' ? b : 0); }, 0);
        summary.axis_rebalance_cost_per_100_beats = latest.beat_count > 0
          ? Number((totalAdj / latest.beat_count * 100).toFixed(2)) : null;
      }
    }
  } catch (_se) { /* best-effort */ }
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(path.join(METRICS_DIR, 'pipeline-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('  Pipeline summary -> output/metrics/pipeline-summary.json');
  } catch (e) {
    console.error('  FAILFAST: pipeline-summary.json write failed: ' + (e && e.message ? e.message : e));
    console.error('  Summary dump: ' + JSON.stringify(summary));
    throw e;
  }
  // HCI snapshot diff: compare current vs previous verifier snapshot so i/status
  // can surface which verifiers regressed without requiring a manual diff command.
  try {
    var snapCur  = path.join(METRICS_DIR, 'hci-verifier-snapshot.json');
    var snapPrev = snapCur + '.prev';
    if (fs.existsSync(snapCur) && fs.existsSync(snapPrev)) {
      var cur  = JSON.parse(fs.readFileSync(snapCur,  'utf8'));
      var prev2 = JSON.parse(fs.readFileSync(snapPrev, 'utf8'));
      var curV  = cur.verifiers  || {};
      var prevV = prev2.verifiers || {};
      var changed2 = [];
      var allKeys = new Set([...Object.keys(curV), ...Object.keys(prevV)]);
      allKeys.forEach(function(k) {
        var cs = (curV[k]  || {}).status;
        var ps = (prevV[k] || {}).status;
        if (cs !== ps) changed2.push({ verifier: k, prev: ps, cur: cs });
      });
      var diff2 = {
        generated_at: new Date().toISOString(),
        hci_prev: prev2.hci,
        hci_cur:  cur.hci,
        hci_delta: (typeof cur.hci === 'number' && typeof prev2.hci === 'number')
          ? Number((cur.hci - prev2.hci).toFixed(1)) : null,
        changed_verifiers: changed2,
      };
      fs.writeFileSync(
        path.join(METRICS_DIR, 'hci-snapshot-diff.json'),
        JSON.stringify(diff2, null, 2) + '\n',
      );
    }
  } catch (_de) { /* best-effort */ }
}

// Activity emission -- the pipeline is the authoritative source of truth for
// "a round happened," so it must emit its own events. Previously only fired
// via posttooluse_bash.sh hook, which requires the user to run `npm run main`
// through Claude's Bash tool. Running from a shell, CI, cron, or another
// agent would produce zero activity events and collapse downstream metrics
// (coherence, trajectory, reflexivity) to null. The pipeline's observability
// is now agent-independent: emit directly.
// R17 #1: direct-append first (guaranteed), then optional spawn for emit.py
// side-effects (nexus, downstream subscribers). Previously spawn-only risked
// silent loss on python crash; R16 added direct-append but left spawn in place,
// causing duplicate emissions. This consolidates into one call that's always
// single-fire: append-first guarantees the event lands, spawn-second adds any
// side-effects emit.py performs (detached so it can't block or duplicate).
function emitActivity(event, fields) {
  var projectRoot = path.join(__dirname, '..', '..');
  // 1. Guaranteed direct-append to the activity log.
  var record = Object.assign({ event: event, ts: Math.floor(Date.now() / 1000) }, fields || {});
  try {
    var activityLog = path.join(METRICS_DIR, 'hme-activity.jsonl');
    fs.appendFileSync(activityLog, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('  emit_activity append ' + event + ' failed: ' + (e && e.message ? e.message : e));
  }
  // 2. Optional spawn for emit.py side-effects (skip_append env prevents dup).
  var args = [path.join(projectRoot, 'tools', 'HME', 'activity', 'emit.py'),
              '--event=' + event, '--skip-append'];
  for (var k in fields) {
    if (fields[k] === null || fields[k] === undefined) continue;
    args.push('--' + k + '=' + String(fields[k]));
  }
  try {
    cp.spawn('python3', args, {
      stdio: 'ignore', detached: true, cwd: projectRoot,
      env: Object.assign({}, process.env, { PROJECT_ROOT: projectRoot }),
    }).unref();
  } catch (_e) { /* spawn is best-effort side-channel */ }
}

// main

function main() {
  var pipelineStart = Date.now();
  console.log('Pipeline started at ' + new Date().toISOString());

  // Pipeline-level activity: pipeline_start. session=shell so downstream
  // consumers can distinguish agent-initiated runs from direct shell runs.
  emitActivity('pipeline_start', { session: process.env.HME_SESSION_ID || 'shell' });

  // Baseline delta: what changed vs the last pipeline run? Surfaces whether
  // we're genuinely in a stable plateau (zero-diff runs) or the pipeline is
  // measuring identical state N times. If commits_ahead=0 AND files_changed=0,
  // this run is measuring the same codebase as the last one -- informative
  // context for downstream metrics.
  try {
    var lastSha = '';
    var lastShaFile = path.join(__dirname, '..', '..', 'tmp', 'hme-last-pipeline-sha');
    if (fs.existsSync(lastShaFile)) {
      lastSha = fs.readFileSync(lastShaFile, 'utf8').trim();
    }
    var curSha = '';
    try {
      curSha = execSync('git rev-parse --short HEAD', {
        cwd: path.join(__dirname, '..', '..'),
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch (_e) { /* git not available */ }
    var filesChanged = 0;
    if (lastSha && curSha) {
      try {
        var diff = execSync(`git diff --name-only ${lastSha}..${curSha}`, {
          cwd: path.join(__dirname, '..', '..'),
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
        filesChanged = diff ? diff.split('\n').length : 0;
      } catch (_e) { /* sha not reachable */ }
    }
    emitActivity('pipeline_baseline_delta', {
      session: process.env.HME_SESSION_ID || 'shell',
      prev_sha: lastSha || 'none',
      cur_sha: curSha || 'none',
      files_changed: filesChanged,
      same_commit: lastSha && curSha && lastSha === curSha ? 1 : 0,
    });
    if (curSha) {
      try {
        fs.mkdirSync(path.dirname(lastShaFile), { recursive: true });
        fs.writeFileSync(lastShaFile, curSha);
      } catch (_e) { /* sha cache is best-effort */ }
    }
  } catch (e) {
    console.error('  baseline-delta: ' + (e && e.message ? e.message : e));
  }

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

  // Collect verdict + hci BEFORE writing summary so pipeline-summary.json
  // carries all three (verdict, hci, failed) as a single coherent record.
  // Previous ordering wrote summary first, then read verdict for the
  // activity event -- which meant pipeline-summary.json never had verdict
  // at all (the hook's re-write pass was the only thing that added it).
  var verdict = 'UNKNOWN';
  var failed = timings.some(function(r) { return !r.ok; }) ? 1 : 0;
  try {
    var fp = JSON.parse(fs.readFileSync(
      path.join(METRICS_DIR, 'fingerprint-comparison.json'),
      'utf8'
    ));
    verdict = fp.verdict || fp.result || 'UNKNOWN';
  } catch (_e) { /* fingerprint not produced -- leave verdict UNKNOWN */ }

  writeSummaryJSON(wallTime, { verdict: verdict });

  // Re-read summary to pick up hci (computed inside writeSummaryJSON)
  var hci = null;
  try {
    var ps = JSON.parse(fs.readFileSync(
      path.join(METRICS_DIR, 'pipeline-summary.json'), 'utf8'
    ));
    if (typeof ps.hci === 'number') hci = ps.hci;
  } catch (_e) { /* summary wasn't read back -- leave hci null */ }
  var session = process.env.HME_SESSION_ID || 'shell';
  // R17 #1: emitActivity now guarantees direct-append; no separate append
  // needed. Both pipeline_run AND round_complete use the same guaranteed path.
  emitActivity('pipeline_run', {
    session: session, verdict: verdict, passed: failed === 0 ? 1 : 0,
    wall_s: Math.round(Number(wallTime)), hci: hci,
  });
  emitActivity('round_complete', {
    session: session, verdict: verdict, passed: failed === 0 ? 1 : 0,
  });

  // Background analytics + snapshots that need the freshly-written summary.
  // Moved from posttooluse_bash.sh so non-Claude pipeline runs (shell, cron,
  // CI, any other agent) also refresh these artifacts. Spawned detached so
  // they don't block pipeline-finish latency.
  var hmeScripts = path.join(__dirname, '..', '..', 'tools', 'HME', 'scripts');
  var bgScripts = [
    'snapshot-holograph.py',           // time-series holograph for HCI trend
    'analyze-tool-effectiveness.py',   // tool-usage patterns per session
    'analyze-hci-trajectory.py',       // HCI linear-regression forecast
    'build-hme-coupling-matrix.py',    // tool co-occurrence matrix
    'build-dashboard.py',              // interactive plotly dashboard
    'chain-snapshot.py',               // pre-compact session snapshot
    'emit-hci-signal.py',              // HCI -> composition-layer signal
    'suggest-verifiers.py',            // verifier coverage report
    'memetic-drift.py',                // CLAUDE.md rule violation scan
  ];
  var bgEnv = Object.assign({}, process.env, {
    PROJECT_ROOT: path.join(__dirname, '..', '..'),
  });
  // Pipe stderr (not 'ignore') to a per-script log file so silent failures
  // surface for diagnosis. Verified failure mode: hme-coupling.json + hme-
  // invariant-history.json + holograph-snapshots.json + hci-trajectory.json
  // were missing/days-stale because their bg-spawn errors were being swallowed
  // by stdio: 'ignore'. Now each script's stderr lands at log/hme-bg-<name>.err
  // (truncated each round so it reflects the latest run only).
  var bgLogDir = path.join(__dirname, '..', '..', 'log');
  try { fs.mkdirSync(bgLogDir, { recursive: true }); } catch (_e) { /* best-effort */ }
  function _spawnBg(scriptPath, scriptArgs, label) {
    try {
      var errFile = path.join(bgLogDir, 'hme-bg-' + label + '.err');
      // Truncate + open synchronously so the FD exists when spawn inherits it.
      var fd = fs.openSync(errFile, 'w');
      cp.spawn('python3', scriptArgs, {
        stdio: ['ignore', 'ignore', fd],
        detached: true,
        env: bgEnv,
        cwd: path.join(__dirname, '..', '..'),
      }).unref();
      fs.closeSync(fd);  // child has its own ref via inheritance
    } catch (_e) { /* best-effort -- don't block pipeline on analytics spawn */ }
  }
  for (var k = 0; k < bgScripts.length; k++) {
    var script = path.join(hmeScripts, bgScripts[k]);
    if (!fs.existsSync(script)) continue;
    var scriptArgs = [script];
    if (bgScripts[k] === 'chain-snapshot.py') scriptArgs.push('--eager');
    var label = bgScripts[k].replace(/\.py$/, '');
    _spawnBg(script, scriptArgs, label);
  }
  // Invariant battery runs the declarative checks in config/invariants.json and
  // writes to metrics/hme-invariant-history.json so chronic streaks clear every
  // round. Lives under scripts/pipeline/hme/ (not HME scripts/) so it spawns
  // separately from the hmeScripts loop above.
  _spawnBg(
    path.join(__dirname, 'hme', 'run-invariant-battery.py'),
    [path.join(__dirname, 'hme', 'run-invariant-battery.py')],
    'run-invariant-battery'
  );

  // Warm-context reprime: touch sentinel so the HME server picks up stale KV
  // contexts on next tick. verify-coherence.py only triggers this inside the
  // full battery (not --score mode), so the pipeline explicitly ensures it
  // fires after every run without requiring a full battery invocation.
  try {
    var warmSentinel = path.join(__dirname, '..', '..', 'tmp', 'hme-warm-reprime.request');
    fs.mkdirSync(path.dirname(warmSentinel), { recursive: true });
    fs.writeFileSync(warmSentinel, String(Math.floor(Date.now() / 1000)));
  } catch (_we) { /* best-effort -- warm reprime is advisory */ }

  console.log('Pipeline finished in ' + wallTime + 's');
}

main();
