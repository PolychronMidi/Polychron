const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT,f));
const L = [];
for (const f of files) {
  const txt = fs.readFileSync(f,'utf8');
  const lines = txt.split(/\r?\n/);
  for (let i=0;i<lines.length;i++){
    const ln = lines[i];
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(','); if (parts.length<4) continue;
    const t = parts[2]; if (String(t).toLowerCase()!=='marker_t') continue;
    const val = parts.slice(3).join(','); const m = String(val).match(/unitRec:([^\s,]+)/);
    if (!m) continue;
    const full = m[1]; const seg = full.split('|');
    let startTick = null, startTime = null;
    const last = seg[seg.length-1] || '', secondLast = seg[seg.length-2] || '';
    if (typeof last === 'string' && last.includes('.') && last.includes('-')) {
      const rs = last.split('-'); startTime = Number(rs[0]||0); const rt = secondLast.split('-'); startTick = Number(rt[0]||0);
    } else { const r = last.split('-'); startTick = Number(r[0]||0); }
    if ((startTime !== null && startTime > 0.03 && startTime < 0.05) || (startTick >= 1000 && startTick <= 2000)) {
      L.push({file: path.basename(f), line: i+1, unit: full, startTick, startTime, raw: ln});
      if (L.length>200) break;
    }
  }
}
if (!L.length) console.log('no matches'); else console.log(JSON.stringify(L.slice(0,200), null, 2));
fs.writeFileSync('tmp-find-approx-unitrec.json', JSON.stringify(L.slice(0,200), null, 2));
console.log('wrote tmp-find-approx-unitrec.json');
