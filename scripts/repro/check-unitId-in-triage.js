const fs = require('fs');
const path = require('path');
const unitId = process.argv[2];
const triageDir = path.join(process.cwd(), 'output', 'triage');
if (!unitId) { console.error('usage: node check-unitId-in-triage.js <unitId>'); process.exit(2); }
if (!fs.existsSync(triageDir)) { console.error('triage dir missing'); process.exit(2); }
const dirs = fs.readdirSync(triageDir);
let total = 0;
for (const d of dirs) {
  const dir = path.join(triageDir, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      const txt = fs.readFileSync(fp, 'utf8');
      const cnt = (txt.split(unitId).length -1);
      if (cnt>0) console.log(`${d}/${f}: ${cnt}`), total += cnt;
    } catch (e) { /* swallow */ }
  }
}
console.log('TOTAL', total);
