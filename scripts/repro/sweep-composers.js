const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('../../src/sheet');
const composers = COMPOSERS || [];

if (!composers.length) {
  console.error('No composers found in sheet.js');
  process.exit(2);
}

const out = path.join(process.cwd(), 'output');
const results = [];

for (let i = 0; i < composers.length; i++) {
  console.log(`Running composer ${i}/${composers.length}`);
  const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-composer.js'), String(i)], { env: { ...process.env, PLAY_LIMIT: '1', INDEX_TRACES: '1' }, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' });
  const stdout = res.stdout ? res.stdout.trim() : '';
  const stderr = res.stderr ? res.stderr.trim() : '';
  let parsed = null;
  try {
    parsed = stdout ? JSON.parse(stdout) : null;
  } catch (e) {}
  const file = path.join(out, `composer-sweep-${i}.json`);
  if (fs.existsSync(file)) {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    results.push(Object.assign({ index: i, status: res.status, stderr: stderr }, obj));
  } else {
    results.push({ index: i, status: res.status, stderr: stderr, stdout: stdout });
  }
}

const summaryFile = path.join(out, 'composer-sweep-results.json');
fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2));
console.log(`Composer sweep complete. Results written to ${summaryFile}`);
// Print top offenders
const offenders = results.filter(r => r.overlapCount && r.overlapCount > 0).sort((a,b) => b.overlapCount - a.overlapCount).slice(0,10);
console.log('Top offenders:', offenders.map(o => ({ index: o.composerIndex, overlaps: o.overlapCount })));

if (offenders.length) process.exit(1); else process.exit(0);
