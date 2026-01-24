const fs = require('fs');
const path = require('path');
const file = path.resolve(process.cwd(), 'output', 'output1.csv');
if (!fs.existsSync(file)) { console.error('Missing file:', file); process.exit(2); }
const txt = fs.readFileSync(file, 'utf8');
const lines = txt.split('\n').filter(l => l.trim().length > 0);

let zeroNotes = [];
for (const l of lines) {
  const cols = l.split(',');
  const type = (cols[2] || '').trim().toLowerCase();
  if (type === 'note_on_c' || type === 'note_on') {
    const tick = Number(cols[1]);
    if (Number.isFinite(tick) && tick === 0) {
      // 7th column (index 6) may be unit label if present
      const unitLabel = (cols[6] || '').trim();
      zeroNotes.push({ line: l, unitLabel });
    }
  }
}

console.log('Total note_on at tick 0:', zeroNotes.length);
const labels = zeroNotes.reduce((acc, v) => { acc[v.unitLabel || '<none>'] = (acc[v.unitLabel || '<none>'] || 0) + 1; return acc; }, {});
console.log('Counts by unit label (top 20):');
console.log(Object.entries(labels).sort((a,b)=>b[1]-a[1]).slice(0,20));
console.log('Sample up to 20 zero-note rows:');
console.log(zeroNotes.slice(0,20));
process.exit(0);
