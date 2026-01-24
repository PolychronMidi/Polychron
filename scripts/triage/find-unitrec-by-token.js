const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const csvPath = path.join(OUT,'output2.csv');
if (!fs.existsSync(csvPath)) { console.log('no csv'); process.exit(2); }
const txt = fs.readFileSync(csvPath,'utf8');
const lines = txt.split(/\r?\n/);
const matches = [];
for (let i=0;i<lines.length;i++){
  const ln = lines[i];
  if (!ln || !ln.startsWith('1,')) continue;
  const parts = ln.split(','); if (parts.length<4) continue;
  const t = parts[2]; if (String(t).toLowerCase()!=='marker_t') continue;
  const val = parts.slice(3).join(','); const m = String(val).match(/unitRec:([^\s,]+)/);
  if (!m) continue;
  const full = m[1];
  if (full.includes('0.098039') || full.includes('3750-210000')) matches.push({line:i+1,unit:full,raw:ln});
}
fs.writeFileSync('tmp-find-unitrec-098039.json', JSON.stringify(matches.slice(0,500), null, 2));
console.log('wrote tmp-find-unitrec-098039.json');
