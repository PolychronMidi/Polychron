// scripts/pipeline/hme/emit-legacy-override-history.js
//
// Read axisEnergyEquilibrator.perLegacyOverride + perLegacyOverrideEntries
// from metrics/trace-summary.json and append one row per pipeline run to
// metrics/legacy-override-history.jsonl. Enables trend analysis: "has
// entropy-cap-0.19 ever fired?" is a simple grep over history.
//
// Writes a one-line console summary for pipeline output consumption.
// Non-fatal — missing trace-summary is a skip, not an error.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TRACE = path.join(ROOT, 'metrics', 'trace-summary.json');
const OUT = path.join(ROOT, 'metrics', 'legacy-override-history.jsonl');

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

function main() {
  const trace = loadJson(TRACE);
  if (!trace) {
    console.log('emit-legacy-override-history: trace-summary missing — skip');
    return;
  }
  const aee = trace.axisEnergyEquilibrator || {};
  const fires = aee.perLegacyOverride || {};
  const entries = aee.perLegacyOverrideEntries || {};
  if (!Object.keys(fires).length) {
    console.log('emit-legacy-override-history: no perLegacyOverride data — skip');
    return;
  }
  const { execSync } = require('child_process');
  let sha = null;
  try {
    sha = execSync('git rev-parse --short HEAD', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (_e) { /* optional */ }
  const record = {
    ts: new Date().toISOString(),
    sha: sha,
    beat_count: aee.beatCount,
    fires: fires,
    entries: entries,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, JSON.stringify(record) + '\n');
  const summary = Object.entries(fires)
    .map(([id, n]) => `${id.split('-')[0]}=${n}`)
    .join(' ');
  console.log(`emit-legacy-override-history: ${summary}`);
}

main();
