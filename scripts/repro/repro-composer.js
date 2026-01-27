const fs = require('fs');
const path = require('path');

const idx = Number(process.argv[2]);
if (!Number.isFinite(idx)) {
  console.error('Usage: node repro-composer.js <composerIndex>');
  process.exit(2);
}

// Load sheet and pick the composer at index
require('../../src/sheet');
const composers = COMPOSERS || [];
const config = composers[idx];
if (!config) {
  console.error(`No composer at index ${idx}`);
  process.exit(2);
}

// Set single composer and deterministic run env
COMPOSERS = [config];
process.env.PLAY_LIMIT = process.env.PLAY_LIMIT || '1';
process.env.INDEX_TRACES = '1';

// Remove previous outputs to avoid mixing
const out = path.join(process.cwd(), 'output');
try { if (fs.existsSync(path.join(out, 'unitMasterMap.ndjson'))) fs.unlinkSync(path.join(out, 'unitMasterMap.ndjson')); } catch (e) { /* swallow */ }
try { if (fs.existsSync(path.join(out, 'unitMasterMap.json'))) fs.unlinkSync(path.join(out, 'unitMasterMap.json')); } catch (e) { /* swallow */ }
// Also remove any repro-overlaps left over
try { if (fs.existsSync(path.join(out, 'repro-overlaps.ndjson'))) fs.unlinkSync(path.join(out, 'repro-overlaps.ndjson')); } catch (e) { /* swallow */ }

// Run play in-process (require) so globals apply
try {
  require('../../src/play');
} catch (e) {
  console.error('play failed', e && e.stack ? e.stack : e);
  process.exit(2);
}

// Load unitMasterMap (ndjson or json)
let units = [];
const mmnd = path.join(out, 'unitMasterMap.ndjson');
const mmjson = path.join(out, 'unitMasterMap.json');
if (fs.existsSync(mmnd)) {
  const lines = fs.readFileSync(mmnd, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
} else if (fs.existsSync(mmjson)) {
  try { const obj = JSON.parse(fs.readFileSync(mmjson, 'utf8')); units = Array.isArray(obj) ? obj : (obj.units || []); } catch (e) { console.error('Failed to parse unitMasterMap.json', e); process.exit(2); }
} else {
  // Fallback: try diagnostics masterMap-weird-emissions.ndjson
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

const countsByParent = new Map();
const overlaps = [];
// Build simple index by parent key (first 5 parts: layer|section|phrase|measure|beat)
for (const u of units) {
  const p = u.parts && u.parts.slice(0,5).join('|');
  if (!p) continue;
  if (!countsByParent.has(p)) countsByParent.set(p, []);
  countsByParent.get(p).push(u);
}

for (const [parent, arr] of countsByParent.entries()) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]; const b = arr[j];
      if (a.startTick < b.endTick && b.startTick < a.endTick) {
        overlaps.push({ parent, a: a.parts.join('|'), b: b.parts.join('|'), aStart: a.startTick, aEnd: a.endTick, bStart: b.startTick, bEnd: b.endTick });
      }
    }
  }
}

const result = {
  composerIndex: idx,
  composerConfig: config,
  unitCount: units.length,
  overlapCount: overlaps.length,
  producedAt: new Date().toISOString()
};

// Write results and overlaps file
try {
  const outFile = path.join(out, `composer-sweep-${idx}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  if (overlaps.length) fs.writeFileSync(path.join(out, `composer-sweep-${idx}-overlaps.ndjson`), overlaps.map(o=>JSON.stringify(o)).join('\n') + '\n');
  console.log(JSON.stringify(result));
  process.exit(overlaps.length ? 1 : 0);
} catch (e) {
  console.error('Failed to write results', e);
  process.exit(2);
}
