const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const summary = path.join(process.cwd(), 'output', 'treewalker-overlap-summary.json');
if (!fs.existsSync(summary)) {
  console.error('treewalker-overlap-summary.json not found in output/ - run treewalker first');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(summary, 'utf8'));
const top = data.topParents || [];
const N = process.argv[2] ? Number(process.argv[2]) : 10;
const selected = top.slice(0, N);
const playLimits = process.argv[3] ? process.argv[3].split(',').map(n => Number(n.trim())).filter(n => Number.isFinite(n) && n > 0) : (process.env.PLAY_LIMITS ? process.env.PLAY_LIMITS.split(',').map(n => Number(n.trim())).filter(n => Number.isFinite(n) && n > 0) : [3, 6, 12, 24]);
console.log('Iterative batch playLimits:', playLimits);
const results = [];

for (const t of selected) {
  const parent = t.parent;
  const safe = parent.replace(/[^a-zA-Z0-9-_]/g, '_');
  let found = false;
  let lastResult = null;

  for (const pl of playLimits) {
    console.log(`Trying parent=${parent} with PLAY_LIMIT=${pl}`);
    const childEnv = Object.assign({}, process.env, { PLAY_LIMIT: String(pl), INDEX_TRACES: '1' });
    if (process.env.INDEX_TRACES_ASSERT) childEnv.INDEX_TRACES_ASSERT = '1';
    const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), parent, String(pl)], { env: childEnv, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' });
    // read produced file
    const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
    let obj = null;
    if (fs.existsSync(outFile)) obj = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    lastResult = { parent, attemptedPlayLimit: pl, status: res.status, stdout: res.stdout ? res.stdout.trim() : '', stderr: res.stderr ? res.stderr.trim() : '', result: obj };
    if (obj && obj.unitCount && obj.unitCount > 0) {
      found = true;
      break;
    }
  }

  results.push(Object.assign({ found }, lastResult));
}

const outFile = path.join(process.cwd(), 'output', 'batch-topParents-iter-results.json');
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log('Iterative batch complete - results written to', outFile);
const offenders = results.filter(r => r.result && r.result.overlapCount && r.result.overlapCount > 0).sort((a,b) => b.result.overlapCount - a.result.overlapCount);
console.log('Top overlapping parents found in iterative batch:', offenders.map(o => ({ parent: o.parent, overlaps: o.result.overlapCount, playLimit: o.attemptedPlayLimit })));
if (offenders.length) process.exit(1); else process.exit(0);
