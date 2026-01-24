const fs = require('fs');
const path = require('path');

const file = path.resolve(process.cwd(), 'output', 'output1.csv');
if (!fs.existsSync(file)) {
  console.error('Missing file:', file);
  process.exit(2);
}

const txt = fs.readFileSync(file, 'utf8');
const lines = txt.split('\n').filter(l => l.trim().length > 0);

let noteOnCount = 0;
let buckets = [0, 0, 0, 0, 0]; // 0-0.1, 0.1-1, 1-2, 2-4, >4 seconds
let minTick = Infinity;
let maxTick = -Infinity;
let sampleFirst50 = [];

for (const l of lines) {
  const cols = l.split(',');
  if (cols.length < 3) continue;
  const type = cols[2].trim().toLowerCase();
  if (type === 'note_on_c' || type === 'note_on') {
    const tickStr = cols[1];
    const tick = Number(tickStr);
    if (!Number.isFinite(tick)) continue;
    noteOnCount++;
    if (tick >= 0 && tick < 0.1) buckets[0]++;
    else if (tick >= 0.1 && tick < 1) buckets[1]++;
    else if (tick >= 1 && tick < 2) buckets[2]++;
    else if (tick >= 2 && tick < 4) buckets[3]++;
    else if (tick >= 4) buckets[4]++;
    minTick = Math.min(minTick, tick);
    maxTick = Math.max(maxTick, tick);
    if (sampleFirst50.length < 50) sampleFirst50.push({ tick, line: l });
  }
}

console.log('File:', file);
console.log('Total lines:', lines.length);
console.log('Total NOTE ON events:', noteOnCount);
console.log('Buckets (seconds): 0-0.1:', buckets[0], ' 0.1-1:', buckets[1], ' 1-2:', buckets[2], ' 2-4:', buckets[3], ' >4:', buckets[4]);
console.log('Min tick:', minTick === Infinity ? 'n/a' : minTick, 'Max tick:', maxTick === -Infinity ? 'n/a' : maxTick);
console.log('Sample first 10 note_on rows:', sampleFirst50.slice(0, 10));

// also compute fraction in first 2 seconds
const inFirst2 = buckets[0] + buckets[1] + buckets[2];
console.log('NOTE ON in first 2 seconds:', inFirst2, '(', noteOnCount ? ((inFirst2 / noteOnCount) * 100).toFixed(2) + '%' : '0% )');

process.exit(0);
