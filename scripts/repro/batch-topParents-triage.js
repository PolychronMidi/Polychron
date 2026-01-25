const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const summaryPath = path.join(process.cwd(), 'output', 'treewalker-overlap-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('No treewalker summary found; run validate:csv first');
  process.exit(2);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const top = summary.topParents || [];
const playLimits = process.argv[2] ? process.argv[2].split(',').map(n=>Number(n.trim())).filter(n=>Number.isFinite(n)&&n>0) : (process.env.PLAY_LIMITS ? process.env.PLAY_LIMITS.split(',').map(n=>Number(n.trim())).filter(n=>Number.isFinite(n)&&n>0) : [3,6,12,24,48,96]);
const N = process.argv[3] ? Number(process.argv[3]) : 20;
const selected = top.slice(0, N);
const results = [];

for (const p of selected) {
  const parent = p.parent;
  const safe = parent.replace(/[^a-zA-Z0-9-_]/g, '_');
  let produced = false;
  let last = null;

  for (const pl of playLimits) {
    console.log(`Trying ${parent} PLAY_LIMIT=${pl}`);
    const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), 'env:' + parent, String(pl)], { env: { ...process.env, PLAY_LIMIT: String(pl), INDEX_TRACES: '1' }, encoding: 'utf8', stdio: ['inherit','pipe','pipe'] });
    const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
    let obj = null;
    if (fs.existsSync(outFile)) {
      try { obj = JSON.parse(fs.readFileSync(outFile,'utf8')); } catch (e) { obj = null; }
    }
    last = { parent, attemptedPlayLimit: pl, status: res.status, stdout: res.stdout ? res.stdout.trim() : '', stderr: res.stderr ? res.stderr.trim() : '', result: obj };
    if (obj && obj.unitCount && obj.unitCount > 0) {
      produced = true;
      break;
    }
  }

  // If produced units, extract diagnostics and record overlap details
  if (produced && last && last.result) {
    const exec = spawnSync(process.execPath, [path.join('scripts','repro','extract-parent-diagnostics.js'), 'env:' + parent], { env: process.env, encoding: 'utf8' });
    if (exec.status !== 0) {
      console.log(`No diagnostics matched for ${parent}`);
    } else {
      console.log(`Diagnostics extracted for ${parent}`);
    }
  }

  results.push(Object.assign({ produced }, last));
}

fs.writeFileSync(path.join(process.cwd(),'output','batch-topParents-triage-results.json'), JSON.stringify(results,null,2));
console.log('Triage complete - results in output/batch-topParents-triage-results.json');
const offenders = results.filter(r=>r.result && r.result.overlapCount && r.result.overlapCount>0).sort((a,b)=>b.result.overlapCount - a.result.overlapCount);
console.log('Found offenders:', offenders.map(o=>({parent:o.parent, overlaps: o.result.overlapCount, playLimit: o.attemptedPlayLimit})));
