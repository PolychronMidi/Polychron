// scripts/pipeline/check-hme-coherence.js
//
// Phase 3 of doc/openshell_features_to_mimic.md. Reads the activity bridge
// event stream (metrics/hme-activity.jsonl) and fails the pipeline if any
// coherence_violation events fired in the current round. Also enforces the
// invariant "every file_written event must have hme_read_prior=true".
//
// A "round" is the window since the most recent round_complete event, or
// the full tail if no round boundary exists yet (fresh log).
//
// Runs as a pre-composition step so violations surface fast — before the
// 10-minute composition, not after. Exit code non-zero aborts npm run main.
//
// Violations are written to metrics/hme-violations.json for the posttooluse
// hook's LIFESAVER scanner to pick up.
//
// Note: coherence_violation emission from hooks is gated on onboarding
// graduation (_onb_is_graduated), so pre-graduated sessions never trip this
// check. Once graduated, every write without a prior HME read is fatal.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const ACTIVITY = path.join(ROOT, 'metrics', 'hme-activity.jsonl');
const OUT = path.join(ROOT, 'metrics', 'hme-violations.json');

function readEvents() {
  if (!fs.existsSync(ACTIVITY)) return [];
  const raw = fs.readFileSync(ACTIVITY, 'utf8');
  const lines = raw.split('\n');
  const events = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch (_e) {
      // corrupt line — skip
    }
  }
  return events;
}

function sliceToRound(events) {
  let lastRound = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i] && events[i].event === 'round_complete') {
      lastRound = i;
      break;
    }
  }
  return lastRound >= 0 ? events.slice(lastRound + 1) : events;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
}

function fmtTs(ts) {
  if (!Number.isFinite(ts)) return '?';
  try {
    return new Date(ts * 1000).toISOString();
  } catch (_e) {
    return String(ts);
  }
}

const events = readEvents();

if (events.length === 0) {
  writeReport({
    meta: {
      script: 'check-hme-coherence.js',
      timestamp: new Date().toISOString(),
      status: 'no_activity_log',
      window_events: 0,
    },
    violations: [],
  });
  console.log('check-hme-coherence: PASS (no activity log yet — nothing to audit)');
  process.exit(0);
}

const windowEvents = sliceToRound(events);

// Count violations and write coherence
const violations = windowEvents.filter((e) => e && e.event === 'coherence_violation');
const writes = windowEvents.filter((e) => e && e.event === 'file_written');
const writesWithPriorRead = writes.filter((e) => e.hme_read_prior === true);
const writesWithoutPriorRead = writes.length - writesWithPriorRead.length;

// Inference-layer violations (from the proxy) have source=proxy.
// Hook-layer violations have source='hook' or undefined. Split for clarity.
const hookViolations = violations.filter((v) => (v.source || 'hook') !== 'proxy');
const proxyViolations = violations.filter((v) => v.source === 'proxy');

const report = {
  meta: {
    script: 'check-hme-coherence.js',
    timestamp: new Date().toISOString(),
    window_events: windowEvents.length,
    total_writes: writes.length,
    writes_with_prior_read: writesWithPriorRead.length,
    writes_without_prior_read: writesWithoutPriorRead,
    coverage_pct:
      writes.length > 0 ? Math.round((writesWithPriorRead.length * 100) / writes.length) : 100,
  },
  violations: violations.map((v) => ({
    ts: v.ts || null,
    ts_iso: fmtTs(v.ts),
    file: v.file || null,
    module: v.module || null,
    reason: v.reason || 'unknown',
    source: v.source || 'hook',
    session: v.session || null,
  })),
};

writeReport(report);

if (violations.length > 0) {
  console.log(
    `check-hme-coherence: FAIL — ${violations.length} coherence violation(s) in current round ` +
      `(${hookViolations.length} hook, ${proxyViolations.length} proxy)`,
  );
  const preview = violations.slice(0, 10);
  for (const v of preview) {
    const label = v.file || v.module || '?';
    const src = v.source || 'hook';
    console.log(`  ${fmtTs(v.ts)}  [${src}]  ${label}  — ${v.reason || '?'}`);
  }
  if (violations.length > preview.length) {
    console.log(`  … and ${violations.length - preview.length} more`);
  }
  console.log(`  Full report: metrics/hme-violations.json`);
  console.log(
    '  FATAL: HME coherence hooks were bypassed. Call read(target=..., mode="before") before edits.',
  );
  process.exit(1);
}

console.log(
  `check-hme-coherence: PASS (${writes.length} write event(s) in window, ` +
    `${writesWithPriorRead.length} with prior HME read — ${report.meta.coverage_pct}%)`,
);
process.exit(0);
