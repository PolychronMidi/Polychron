// Analyze audit report (copied into scripts/test for test tooling)
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('output/unitTreeAudit-report.json', 'utf8'));
const unitsManifest = JSON.parse(fs.readFileSync('output/units.json', 'utf8'));
const units = unitsManifest.units || [];

const errors = report.errors || [];
console.log('Total errors:', errors.length);

let missing = [];
let outside = [];

errors.forEach(e => {
  if (String(e).includes('Missing unit mapping')) missing.push(e);
  else if (String(e).includes('falls outside unit range')) outside.push(e);
});

console.log('Missing mapping errors:', missing.length);
console.log('Outside-range errors:', outside.length);

// Per-file counts for missing mapping
const byFile = {};
missing.forEach(e => {
  const m = String(e).match(/in (output\d+\.csv)/);
  const f = m && m[1] ? m[1] : 'unknown';
  byFile[f] = (byFile[f] || 0) + 1;
});
console.log('Missing mapping counts by file:', byFile);

// Parse ticks for missing mapping and get min/max, histogram
const parseTickFromMissing = (errStr) => {
  const m = String(errStr).match(/line:\s*([^\n]+)/);
  if (!m) return null;
  const parts = m[1].split(',');
  // typical: "1,7372500,marker_t,..."
  const tickStr = parts[1];
  const t = Number(tickStr);
  return Number.isFinite(t) ? t : null;
};

const ticks = missing.map(parseTickFromMissing).filter(t => t !== null);
if (ticks.length) {
  const min = Math.min(...ticks);
  const max = Math.max(...ticks);
  const avg = ticks.reduce((a,b)=>a+b,0)/ticks.length;
  console.log('Missing mapping ticks - min:', min, 'max:', max, 'avg:', Math.round(avg));
  // histogram buckets (100k)
  const bucketSize = 100000;
  const buckets = {};
  ticks.forEach(t => {
    const b = Math.floor(t/bucketSize)*bucketSize;
    buckets[b] = (buckets[b] || 0) + 1;
  });
  const topBuckets = Object.entries(buckets).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log('Top tick buckets (startTick -> count):');
  topBuckets.forEach(([b,c]) => console.log(b + ' -> ' + c));
}

// Representative samples: min, max, median
const sortedMissing = missing.slice().sort((a,b)=>parseTickFromMissing(a)-parseTickFromMissing(b));
const reps = [];
if (sortedMissing.length) {
  reps.push(sortedMissing[0]);
  reps.push(sortedMissing[Math.floor(sortedMissing.length/2)]);
  reps.push(sortedMissing[sortedMissing.length-1]);
}

console.log('\nRepresentative missing-mapping cases:');

const fileToLayer = { 'output1.csv': 'primary', 'output2.csv': 'poly' };

const findUnitsCovering = (layer, tick) => {
  const list = units.filter(u => u.layer === layer).map(u=>({start:u.startTick,end:u.endTick,unit:u})).sort((a,b)=>a.start-b.start);
  const covering = list.find(u => Number(tick) >= Number(u.start) && Number(tick) < Number(u.end));
  if (covering) return { covering: covering.unit };
  // find nearest before and after
  let before = null, after = null;
  for (const u of list) {
    if (Number(u.end) <= tick) before = u.unit;
    else if (Number(u.start) > tick) { after = u.unit; break; }
  }
  return { before, after };
};

reps.forEach(r => {
  console.log('\n-- ERROR --');
  console.log(r);
  const m = String(r).match(/in (output\d+\.csv)/);
  const f = m && m[1] ? m[1] : 'unknown';
  const layer = fileToLayer[f] || 'unknown';
  const t = parseTickFromMissing(r);
  console.log('Parsed tick:', t, 'file:', f, 'layer:', layer);
  if (t !== null && layer !== 'unknown') {
    const res = findUnitsCovering(layer, t);
    if (res.covering) console.log('Covering unit found:', res.covering);
    else console.log('No covering unit. Nearest before:', res.before, 'nearest after:', res.after);
  }
});

// For outside-range errors, show a few samples and parse their data
console.log('\nSamples of outside-range errors:');
outside.slice(0,5).forEach(o => console.log(o));

console.log('\nDone.');
