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
const N = process.argv[2] ? Number(process.argv[2]) : 5;
const selected = top.slice(0, N);
const results = [];

for (const t of selected) {
  const parent = t.parent;
  console.log('Running repro-parent for', parent);
  const safe = parent.replace(/[^a-zA-Z0-9-_]/g, '_');
  const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), parent, String(3)], { env: { ...process.env, PLAY_LIMIT: '3', INDEX_TRACES: '1' }, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' });
  const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
  let obj = null;
  if (fs.existsSync(outFile)) obj = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  results.push({ parent, status: res.status, stdout: res.stdout ? res.stdout.trim() : '', stderr: res.stderr ? res.stderr.trim() : '', result: obj });
}

const outFile = path.join(process.cwd(), 'output', 'batch-topParents-results.json');
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log('Batch complete - results written to', outFile);
const offenders = results.filter(r => r.result && r.result.overlapCount && r.result.overlapCount > 0).sort((a,b) => b.result.overlapCount - a.result.overlapCount);
console.log('Top overlapping parents in batch:', offenders.map(o => ({ parent: o.parent, overlaps: o.result.overlapCount })));
if (offenders.length) process.exit(1); else process.exit(0);
