const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(),'output');
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT,f));
const lastEnds = {};
for (const f of files) {
  const fname = path.basename(f).toLowerCase();
  const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
  const txt = fs.readFileSync(f,'utf8');
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(',');
    if (parts.length < 4) continue;
    const type = String(parts[2]).toLowerCase();
    if (type !== 'marker_t') continue;
    const val = parts.slice(3).join(',');
    const mUnit = String(val).match(/unitRec:([^\s]+)/);
    if (mUnit) {
      const fullId = mUnit[1];
      const seg = fullId.split('|');
      const range = seg[seg.length - 1] || '';
      const r = range.split('-');
      const startTick = Number(r[0] || 0);
      const endTick = Number(r[1] || 0);
      lastEnds[layer] = Math.max(lastEnds[layer]||-Infinity, endTick);
      continue;
    }
    const mPhrase = String(val).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
    if (mPhrase) {
      lastEnds[layer] = Math.max(lastEnds[layer]||-Infinity, Math.round(Number(mPhrase[1])));
      continue;
    }
  }
}
console.log(lastEnds);
// Also compute max event tick per file
const maxEvents = {};
for (const f of files) {
  const fname = path.basename(f).toLowerCase();
  const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
  const txt = fs.readFileSync(f,'utf8');
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(',');
    if (parts.length < 3) continue;
    const tickRaw = parts[1];
    const tick = Number(tickRaw);
    if (Number.isFinite(tick)) {
      maxEvents[layer] = Math.max(maxEvents[layer]||-Infinity, tick);
    }
  }
}
console.log('max events', maxEvents);
