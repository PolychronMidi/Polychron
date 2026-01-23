const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const files = ['output1.csv', 'output2.csv'];
const report = {};
for (const f of files) {
  const txt = fs.readFileSync(path.join(OUT, f), 'utf8');
  const lines = txt.split(/\r?\n/);
  let maxEnd = -Infinity;
  let maxPhraseEnd = -Infinity;
  let maxSectionEnd = -Infinity;
  let maxAny = -Infinity;
  for (const ln of lines) {
    if (!ln.startsWith('1,')) continue;
    const p = ln.split(',');
    if (p[2].toLowerCase() !== 'marker_t') continue;
    const val = p.slice(3).join(',');
    const mTp = String(val).match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i);
    const tp = mTp ? Number(mTp[1]) : null;
    const mEnd = String(val).match(/endTick:\s*([0-9]+)/i);
    const endTick = mEnd ? Number(mEnd[1]) : null;
    if (endTick && tp) {
      const s = endTick / tp;
      maxAny = Math.max(maxAny, s);
      if (/Phrase/i.test(val)) maxPhraseEnd = Math.max(maxPhraseEnd, s);
      if (/Section/i.test(val)) maxSectionEnd = Math.max(maxSectionEnd, s);
    }
  }
  report[f] = { maxAny, maxPhraseEnd, maxSectionEnd };
}
fs.writeFileSync(path.join(OUT,'marker_stats.json'), JSON.stringify(report, null, 2));
console.log('Wrote output/marker_stats.json');
