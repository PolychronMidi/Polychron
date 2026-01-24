const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const csv = path.join(OUT,'output2.csv');
if (!fs.existsSync(csv)) { console.error('no output2.csv'); process.exit(2); }
const lines = fs.readFileSync(csv,'utf8').split(/\r?\n/);
const results = [];
for (let i=0;i<lines.length;i++){
  const ln = lines[i];
  if (!ln || !ln.startsWith('1,')) continue;
  const parts = ln.split(','); if (parts.length<4) continue;
  const t = parts[2]; if (String(t).toLowerCase()!=='marker_t') continue;
  const val = parts.slice(3).join(','); const m = String(val).match(/unitRec:([^\s,]+)/);
  if (!m) continue;
  const full = m[1];
  if (full.indexOf('poly|section1|phrase1') === -1) continue;
  const seg = full.split('|');
  const last = seg[seg.length-1] || '';
  const secondLast = seg[seg.length-2] || '';
  let startTick = null, endTick = null, startTime = null, endTime = null;
  if (typeof last === 'string' && last.includes('.') && last.includes('-')) {
    const rs = last.split('-'); startTime = Number(rs[0]||0); endTime = Number(rs[1]||0);
    const rt = secondLast.split('-'); startTick = Number(rt[0]||0); endTick = Number(rt[1]||0);
  } else {
    const r = last.split('-'); startTick = Number(r[0]||0); endTick = Number(r[1]||0);
  }
  results.push({ line: i+1, raw: ln, full, startTick, endTick, startTime, endTime });
}
if (!results.length) console.log('no unitRec matches found'); else console.log(JSON.stringify(results.slice(0,500), null, 2));
fs.writeFileSync('tmp-unitrecs-section1-phrase1.json', JSON.stringify(results.slice(0,500), null, 2));
console.log('wrote tmp-unitrecs-section1-phrase1.json');
