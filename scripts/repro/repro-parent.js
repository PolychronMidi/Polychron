const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
let parentArg = args[0];
// Allow base64-encoded parent keys to avoid shell/pipeline quoting issues (pass as "b64:<base64>")
if (parentArg && String(parentArg).startsWith('b64:')) {
  try { parentArg = Buffer.from(String(parentArg).slice(4), 'base64').toString('utf8'); } catch (e) { /* ignore and fall through */ }
}
// Fallback to environment variable for parent (easier in Windows shells)
if (!parentArg && process.env.TARGET_PARENT) {
  parentArg = process.env.TARGET_PARENT;
}
// Allow explicit env: prefix to be used in arg for clarity
if (parentArg && String(parentArg).startsWith('env:')) {
  parentArg = String(parentArg).slice(4);
}
const playLimitArg = Number(args[1]);
const envPlayLimit = process.env.PLAY_LIMIT ? Number(process.env.PLAY_LIMIT) : undefined;

if (!parentArg) {
  console.error('Usage: node repro-parent.js <parentKey> [playLimit]  (or set TARGET_PARENT env and call with [playLimit])');
  process.exit(2);
}
const parentKey = parentArg; // e.g. poly|section1/1|phrase2/3|measure1/1|beat1/5

// derive a conservative PLAY_LIMIT from the parent section index if possible
let inferredPlayLimit = 1;
const m = parentKey.match(/section(\d+)\//);
if (m) inferredPlayLimit = Math.max(1, Number(m[1]));
const PLAY_LIMIT = (playLimitArg && Number.isFinite(playLimitArg)) ? playLimitArg : (envPlayLimit && Number.isFinite(envPlayLimit)) ? envPlayLimit : (inferredPlayLimit + 1);
console.log(`repro-parent: parent=${parentKey} PLAY_LIMIT=${PLAY_LIMIT}`);

// cleanup previous artifacts for this parent
const out = path.join(process.cwd(), 'output');
const safeName = parentKey.replace(/[^a-zA-Z0-9-_]/g, '_');
const overlapsOut = path.join(out, `repro-parent-${safeName}-overlaps.ndjson`);
const resultOut = path.join(out, `repro-parent-${safeName}.json`);
try { if (fs.existsSync(overlapsOut)) fs.unlinkSync(overlapsOut); } catch (e) {}
try { if (fs.existsSync(resultOut)) fs.unlinkSync(resultOut); } catch (e) {}

// Ensure environment flags
process.env.PLAY_LIMIT = String(PLAY_LIMIT);
process.env.INDEX_TRACES = '1';
process.env.TARGET_PARENT = parentKey;

// Force deterministic section/phrase counts derived from the parent target so the run reaches the target phrase
try {
  const pm = parentKey.match(/phrase(\d+)\/\d+/);
  if (pm) {
    const neededPhrases = Math.max(1, Number(pm[1]));
    // Override PHRASES_PER_SECTION to ensure the target phrase exists in the single section run
    global.PHRASES_PER_SECTION = { min: neededPhrases, max: neededPhrases };
  }
  // Force a single section so PLAY_LIMIT controls the number of sections deterministically
  global.SECTIONS = { min: 1, max: 1 };
} catch (e) {}

// Run play in-process
try {
  // remove previous master maps to avoid stale entries
  try { if (fs.existsSync(path.join(out, 'unitMasterMap.ndjson'))) fs.unlinkSync(path.join(out, 'unitMasterMap.ndjson')); } catch (e) {}
  try { if (fs.existsSync(path.join(out, 'unitMasterMap.json'))) fs.unlinkSync(path.join(out, 'unitMasterMap.json')); } catch (e) {}

  require('../../src/play');
} catch (e) {
  console.error('play failed', e && e.stack ? e.stack : e);
  process.exit(2);
}

// Load unit master map
let units = [];
const mmnd = path.join(out, 'unitMasterMap.ndjson');
const mmjson = path.join(out, 'unitMasterMap.json');
if (fs.existsSync(mmnd)) {
  const lines = fs.readFileSync(mmnd, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
} else if (fs.existsSync(mmjson)) {
  try { const obj = JSON.parse(fs.readFileSync(mmjson, 'utf8')); units = Array.isArray(obj) ? obj : (obj.units || []); } catch (e) { console.error('Failed to parse unitMasterMap.json', e); process.exit(2); }
} else {
  // Fallback: try to recover units from diagnostic masterMap-weird-emissions.ndjson to enable repro in runs
  const weird = path.join(out, 'masterMap-weird-emissions.ndjson');
  if (fs.existsSync(weird)) {
    try {
      const lines = fs.readFileSync(weird, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      units = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).map(w => {
        // Normalize to expected unit object shape
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

// Filter units for this parent (match prefix of parts joined by '|')
const prefix = parentKey;
const candidates = units.filter(u => u.parts && u.parts.join('|').startsWith(prefix));

// Find overlaps among candidates
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

const result = { parent: parentKey, playLimit: PLAY_LIMIT, unitCount: candidates.length, overlapCount: overlaps.length, producedAt: (new Date()).toISOString() };

try {
  fs.writeFileSync(resultOut, JSON.stringify(result, null, 2));
  if (overlaps.length) fs.writeFileSync(overlapsOut, overlaps.map(o => JSON.stringify(o)).join('\n') + '\n');
  console.log(JSON.stringify(result));
  process.exit(overlaps.length ? 1 : 0);
} catch (e) {
  console.error('Failed to write results', e);
  process.exit(2);
}
