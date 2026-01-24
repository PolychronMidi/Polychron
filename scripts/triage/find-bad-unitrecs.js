const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const csv = path.join(OUT,'output2.csv');
if (!fs.existsSync(csv)) { console.error('no output2.csv'); process.exit(2); }
const lines = fs.readFileSync(csv,'utf8').split(/\r?\n/);
let count=0;
for (let i=0;i<lines.length;i++){
  const ln = lines[i];
  if (!ln || !ln.startsWith('1,')) continue;
  const parts = ln.split(',');
  if (parts.length<4) continue;
  const t = parts[2];
  if (String(t).toLowerCase()!=='marker_t') continue;
  const val = parts.slice(3).join(',');
  const m = String(val).match(/unitRec:([^\s]+)/);
  if (!m) continue;
  const full = m[1];
  const seg = full.split('|');
  const last = seg[seg.length-1] || '';
  const hasSec = /^\d+\.\d+-\d+\.\d+$/.test(last);
  if (!hasSec) {
    console.log('NO-SEC', i+1, ln);
    count++;
    if (count>50) break;
  }
}
console.error('Done. Found',count,'missing-sec unitRec(s)');
