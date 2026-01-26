const fs = require('fs'); const path = require('path');
const OUT = path.join(process.cwd(), 'output');
const csv = path.join(OUT, 'output2.csv');
console.log('csv exists?', fs.existsSync(csv));
if (!fs.existsSync(csv)) process.exit(1);
const lines = fs.readFileSync(csv, 'utf8').split(/\r?\n/);
const unitRecs = [];
for (const ln of lines) {
  if (!ln || !ln.startsWith('1,')) continue;
  const parts = ln.split(','); if (parts.length < 4) continue;
  if (String(parts[2]).toLowerCase() !== 'marker_t') continue;
  const val = parts.slice(3).join(',');
  const m = String(val).match(/unitRec:([^\s,]+)/);
  if (!m) continue;
  const full = m[1];
  if (full.indexOf('section1|phrase1') === -1) continue;
  const seg = full.split('|');
  let startTime = null;
  for (let i = seg.length - 1; i >= 0; i--) {
    const s = seg[i];
    if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { startTime = Number(s.split('-')[0]); break; }
  }
  unitRecs.push({ full, startTime });
}
console.log('found', unitRecs.length, 'recs');
console.log(unitRecs.slice(0,10));
