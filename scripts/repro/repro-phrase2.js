const fs = require('fs');
const path = require('path');

// Clear previous artifacts
const out = path.join(process.cwd(), 'output');
try { if (fs.existsSync(path.join(out, 'unitMasterMap.ndjson'))) fs.unlinkSync(path.join(out, 'unitMasterMap.ndjson')); } catch (e) {}
try { if (fs.existsSync(path.join(out, 'repro-overlaps.ndjson'))) fs.unlinkSync(path.join(out, 'repro-overlaps.ndjson')); } catch (e) {}

// Force deterministic composers: only use advancedVoiceLeading composer
try {
  require('../../src/sheet');
  // Override global COMPOSERS
  COMPOSERS = [ { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.7 } ];
} catch (e) {
  console.error('Failed to load sheet.js', e);
  process.exit(2);
}

// Force quick run and traces
process.env.PLAY_LIMIT = process.env.PLAY_LIMIT || '1';
process.env.INDEX_TRACES = '1';
process.env.ENABLE_REPRO = '1';

// Run play
try {
  require('../../src/play');
} catch (e) {
  console.error('play failed', e);
  process.exit(2);
}

// After play, scan unitMasterMap for target parent
const parentPrefix = 'poly|section1/1|phrase2/3|measure1/1|beat1/5';
let units = [];
const mmnd = path.join(out, 'unitMasterMap.ndjson');
const mmjson = path.join(out, 'unitMasterMap.json');
if (fs.existsSync(mmnd)) {
  const lines = fs.readFileSync(mmnd, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
} else if (fs.existsSync(mmjson)) {
  try {
    const obj = JSON.parse(fs.readFileSync(mmjson, 'utf8'));
    units = Array.isArray(obj) ? obj : (obj.units || []);
  } catch (e) {
    console.error('Failed to parse unitMasterMap.json', e);
    process.exit(2);
  }
} else {
  // Fallback to diagnostics masterMap-weird-emissions.ndjson
  const weird = path.join(out, 'masterMap-weird-emissions.ndjson');
  if (fs.existsSync(weird)) {
    try {
      const lines = fs.readFileSync(weird, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).map(w => {
        const parts = Array.isArray(w.parts) ? w.parts : (typeof w.key === 'string' ? String(w.key).split('|') : []);
        const startTick = Number(w.startTick || (w.raw && w.raw.startTick) || 0);
        const endTick = Number(w.endTick || (w.raw && w.raw.endTick) || 0);
        return { parts, startTick, endTick, raw: w.raw || w };
      });
    } catch (e) {
      console.error('Failed to parse masterMap-weird-emissions.ndjson', e);
      process.exit(2);
    }
  } else {
    console.error('unitMasterMap not found');
    process.exit(2);
  }
}
const candidates = units.filter(u => u.parts && u.parts.join('|').startsWith(parentPrefix));

// Find overlaps
const overlaps = [];
for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i];
    const b = candidates[j];
    if (a.startTick < b.endTick && b.startTick < a.endTick) {
      overlaps.push({ a: a.parts.join('|'), b: b.parts.join('|'), aStart: a.startTick, aEnd: a.endTick, bStart: b.startTick, bEnd: b.endTick });
    }
  }
}

if (overlaps.length) {
  const { appendToFile } = require('../../src/logGate');
  try { appendToFile('repro-overlaps.ndjson', { when: new Date().toISOString(), overlaps }); } catch (e) {}
  console.error(`Found ${overlaps.length} overlaps for parent ${parentPrefix} - see output/repro-overlaps.ndjson`);
  process.exit(1);
}

console.log('No overlaps found for parent', parentPrefix);
process.exit(0);
