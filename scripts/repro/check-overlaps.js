const fs = require('fs'); const path = require('path');
const parent = process.argv[2] || 'primary|section1/1|phrase4/4|measure1/1|beat3/4';
const fn = path.join(process.cwd(),'output','masterMap-weird-emissions.ndjson');
if (!fs.existsSync(fn)) { console.error('no masterMap-weird-emissions.ndjson'); process.exit(2); }
const lines = fs.readFileSync(fn,'utf8').trim().split(/\r?\n/).filter(Boolean);
const units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).map(w => ({parts: w.parts, start: Number(w.startTick || (w.raw && w.raw.startTick) || 0), end: Number(w.endTick || (w.raw && w.raw.endTick) || 0), raw: w.raw || w }));
const cands = units.filter(u => u.parts && u.parts.join('|').startsWith(parent));
console.log('parent', parent, 'candidates', cands.length);
const overlaps = [];
for (let i=0;i<cands.length;i++) for (let j=i+1;j<cands.length;j++) {
  const a = cands[i], b = cands[j];
  if (a.start < b.end && b.start < a.end) overlaps.push({ a: a.parts.join('|'), b: b.parts.join('|'), aStart: a.start, aEnd: a.end, bStart: b.start, bEnd: b.end });
}
console.log('overlaps', overlaps.length);
if (overlaps.length) console.log(JSON.stringify(overlaps,null,2));
process.exit(overlaps.length?1:0);
