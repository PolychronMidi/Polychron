const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const csv = path.join(OUT,'output2.csv');
if (!fs.existsSync(csv)) { console.error('no output2.csv'); process.exit(2); }
const lines = fs.readFileSync(csv,'utf8').split(/\r?\n/);
const groups = {};
for (let i=0;i<lines.length;i++){
  const ln = lines[i];
  if (!ln || !ln.startsWith('1,')) continue;
  const parts = ln.split(','); if (parts.length<4) continue;
  const t = parts[2]; if (String(t).toLowerCase()!=='marker_t') continue;
  const val = parts.slice(3).join(','); const m = String(val).match(/unitRec:([^\s,]+)/);
  if (!m) continue;
  const full = m[1];
  if (!full.includes('poly|section1|phrase1')) continue; // narrow to s0-p0
  const seg = full.split('|');
  let sectionIdx=null, phraseIdx=null;
  for (const s of seg) {
    const ms = String(s).match(/^section(\d+)/i); if (ms) sectionIdx = Number(ms[1])-1;
    const mp = String(s).match(/^phrase(\d+)/i); if (mp) phraseIdx = Number(mp[1])-1;
  }
  const last = seg[seg.length-1] || '', secondLast = seg[seg.length-2] || '';
  let startTick=null, startTime=null;
  if (typeof last === 'string' && last.includes('.') && last.includes('-')) {
    const rs = last.split('-'); startTime = Number(rs[0]||0);
    const rt = secondLast.split('-'); startTick = Number(rt[0]||0);
  } else {
    const r = last.split('-'); startTick = Number(r[0]||0);
  }
  const key = `s${sectionIdx}-p${phraseIdx}`;
  groups[key] = groups[key] || [];
  groups[key].push({full, startTime, startTick});
}
const res = {};
for (const k of Object.keys(groups)) {
  const arr = groups[k];
  const times = arr.map(x => (x.startTime !== null && x.startTime !== undefined) ? x.startTime : null).filter(x => x !== null);
  const ticks = arr.map(x => (x.startTick !== null && x.startTick !== undefined) ? x.startTick : null).filter(x => x !== null);
  res[k] = { count: arr.length, minTime: times.length ? Math.min(...times) : null, minTick: ticks.length ? Math.min(...ticks) : null, sample: arr.slice(0,10) };
}
console.log(JSON.stringify(res, null, 2));
fs.writeFileSync('tmp-min-unitrec-starts.json', JSON.stringify(res, null, 2));
console.log('wrote tmp-min-unitrec-starts.json');
