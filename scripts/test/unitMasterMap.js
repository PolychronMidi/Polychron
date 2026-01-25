const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
// Run short play
const r = spawnSync(process.execPath, [path.join('src','play.js')], { env: {...process.env, PLAY_LIMIT:'1'}, stdio: 'inherit' });
if (r.error) throw r.error;
const p = path.join(process.cwd(), 'output', 'unitMasterMap.json');
if (!fs.existsSync(p)) { console.error('missing unitMasterMap.json'); process.exit(2); }
const obj = JSON.parse(fs.readFileSync(p,'utf8'));
const items = obj.units || [];
const groups = {};
for (const it of items) {
  const parts = it.key.split('|');
  if (parts.length < 5) continue;
  const parent = parts.slice(0,5).join('|');
  const subdivPart = parts[5];
  if (!subdivPart) continue;
  const m = String(subdivPart).match(/subdivision\d+\/(\d+)/);
  if (!m) continue;
  const denom = Number(m[1]);
  groups[parent] = groups[parent] || new Set();
  groups[parent].add(denom);
}
const bad = Object.entries(groups).filter(([k,s]) => s.size > 1);
console.log('badCount', bad.length);
if (bad.length) {
  console.log('examples', bad.slice(0,5).map(([k,s]) => [k, Array.from(s)]));
  process.exit(2);
}
console.log('No inconsistencies found');
process.exit(0);
