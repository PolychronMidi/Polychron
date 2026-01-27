const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const csvFiles = [path.join(OUT,'output1.csv'), path.join(OUT,'output2.csv')];
const parseHMSToSec = (tstr) => { const parts = String(tstr).trim().split(':').map(s => s.trim()); if (parts.length === 1) return Number(parts[0]) || 0; const min = Number(parts[0]) || 0; const sec = Number(parts[1]) || 0; return min * 60 + sec; };
for (const csv of csvFiles) {
  if (!fs.existsSync(csv)) { console.log(csv, 'missing'); continue; }
  const lines = fs.readFileSync(csv,'utf8').split(/\r?\n/).filter(Boolean);
  let found = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i]; if (!ln || ln.indexOf('marker_t') === -1) continue;
    const parts = ln.split(','); const val = parts.slice(3).join(',');
    const mUnitSec = String(val).match(/unitRec:[^\s,]+\|([0-9]+\.[0-9]+-[0-9]+\.[0-9]+)\b/);
    if (mUnitSec) { const r = mUnitSec[1].split('-'); found = { csv: path.basename(csv), line: i+1, method: 'unitRec', endSec: Number(r[1]), raw: ln }; break; }
    const mPhrase = String(val).match(/\(([^)]+)\s*-\s*([^)]+)\)/);
    if (mPhrase) { const endStr = String(mPhrase[2]).trim(); found = { csv: path.basename(csv), line: i+1, method: 'phrase', endSec: parseHMSToSec(endStr), raw: ln }; break; }
    const mTick = String(val).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
    if (mTick) { const endTick = Number(mTick[1]); found = { csv: path.basename(csv), line: i+1, method: 'endTick', endTick, raw: ln }; break; }
  }
  console.log(found || (path.basename(csv) + ' no marker found'));
}
