// scripts/exportUnitTreeJson.js
// Lightweight exporter to produce output/unitTreeMap.json from CSVs and master map.

const fs = require('fs');
const path = require('path');

function parseUnitRecFromToken(token) {
  // token is like "unitRec:primary|section1|phrase1|measure1|beat1/9|2500-5000|0.06-0.12"
  if (!token) return null;
  const m = String(token).match(/^unitRec:(.+)$/);
  if (!m) return null;
  const full = m[1];
  const seg = full.split('|');
  // extract tick-range (first segment matching digits-digit) and sec-range (digits.digits-digits.digits)
  let startTick, endTick, startTime, endTime;
  for (let i = seg.length - 1; i >= 0; i--) {
    const s = seg[i];
    if (/^\d+-\d+$/.test(s)) {
      const r = s.split('-'); startTick = Number(r[0]); endTick = Number(r[1]); continue;
    }
    if (/^\d+\.\d+-\d+\.\d+$/.test(s)) {
      const r = s.split('-'); startTime = Number(r[0]); endTime = Number(r[1]); continue;
    }
  }
  // normalize path segments (drop trailing range/time tokens)
  const pathSegs = seg.filter(s => !/^\d+-\d+$/.test(s) && !/^\d+\.\d+-\d+\.\d+$/.test(s));
  // the layer is likely the first segment
  const layer = pathSegs.length ? pathSegs[0] : null;
  return { fullId: full, pathSegs, layer, startTick, endTick, startTime, endTime };
}

function readCsvUnitRecs(csvPath) {
  const units = [];
  if (!fs.existsSync(csvPath)) return units;
  const txt = fs.readFileSync(csvPath, 'utf8');
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || !ln.startsWith('1,')) continue;
    // look for unitRec:
    const m = String(ln).match(/unitRec:([^\s,]+)/);
    if (m) {
      const parsed = parseUnitRecFromToken('unitRec:' + m[1]);
      if (parsed) {
        units.push(Object.assign({ file: path.basename(csvPath), line: i + 1, rawLine: ln }, parsed));
      }
    }
  }
  return units;
}

function readMasterMap(units) {
  const masterPath = path.join(process.cwd(), 'output', 'unitMasterMap.json');
  if (!fs.existsSync(masterPath)) return [];
  try {
    const jm = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const munits = (jm && jm.units) ? jm.units.map(u => ({
      source: 'masterMap', id: u.id || u.unitId || null, layer: u.layer, keyPath: u.keyPath || (u.layer ? [u.layer] : []), tickStart: u.tickStart || u.startTick || null, tickEnd: u.tickEnd || u.endTick || null, timeStart: u.timeStart || u.startTime || null, timeEnd: u.timeEnd || u.endTime || null
    })) : [];
    return munits;
  } catch (e) {
    return [];
  }
}

function canonicalize(unitsFromCsv, unitsFromMaster) {
  // unitsFromCsv: parsed with .pathSegs and ranges
  // Build a canonical map keyed by "layer|path..." (sans trailing ranges)
  const map = new Map();

  const add = (rec, src) => {
    const key = (rec.pathSegs || []).join('|') || rec.fullId || ('unknown|' + (rec.file||''));
    const cur = map.get(key) || { key, layer: rec.layer || null, parts: rec.pathSegs || [], examples: [], distinctRanges: new Set(), startTick: Infinity, endTick: -Infinity, startTime: null, endTime: null, sources: new Set() };
    cur.sources.add(src || 'csv');
    cur.examples.push({ src, rec });
    if (Number.isFinite(Number(rec.startTick))) { cur.startTick = Math.min(cur.startTick, Number(rec.startTick)); }
    if (Number.isFinite(Number(rec.endTick))) { cur.endTick = Math.max(cur.endTick, Number(rec.endTick)); }
    if (Number.isFinite(Number(rec.startTime))) cur.startTime = cur.startTime === null ? rec.startTime : Math.min(cur.startTime, rec.startTime);
    if (Number.isFinite(Number(rec.endTime))) cur.endTime = cur.endTime === null ? rec.endTime : Math.max(cur.endTime, rec.endTime);
    if (rec.startTick !== undefined && rec.endTick !== undefined) cur.distinctRanges.add(`${rec.startTick}-${rec.endTick}`);
    map.set(key, cur);
  };

  unitsFromCsv.forEach(u => add(u, 'csv'));
  unitsFromMaster.forEach(u => add({ pathSegs: u.keyPath || [], layer: u.layer, startTick: u.tickStart, endTick: u.tickEnd, startTime: u.timeStart, endTime: u.timeEnd }, 'master'));

  // Convert sets to arrays & finalize
  const out = [];
  for (const [k, v] of map.entries()) {
    out.push({ key: v.key, layer: v.layer, parts: v.parts, startTick: Number.isFinite(Number(v.startTick)) && v.startTick !== Infinity ? v.startTick : null, endTick: Number.isFinite(Number(v.endTick)) && v.endTick !== -Infinity ? v.endTick : null, startTime: v.startTime, endTime: v.endTime, distinctRanges: Array.from(v.distinctRanges), examples: v.examples.slice(0,5), sources: Array.from(v.sources) });
  }

  return out;
}

function buildRelations(canonicalUnits) {
  // map by key for quick lookup
  const keyMap = new Map();
  canonicalUnits.forEach(u => keyMap.set(u.key, u));
  const rels = [];
  for (const u of canonicalUnits) {
    const parts = u.parts || [];
    if (parts.length <= 1) continue; // no parent
    const parentKey = parts.slice(0, parts.length - 1).join('|');
    if (keyMap.has(parentKey)) rels.push({ parent: parentKey, child: u.key });
  }
  return rels;
}

function run({ out = path.join(process.cwd(), 'output', 'unitTreeMap.json'), includeConflicts = true, minLevel } = {}) {
  try {
    const outDir = path.dirname(out);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // locate output CSVs
    const CSVs = fs.readdirSync(path.join(process.cwd(), 'output')).filter(f => f.endsWith('.csv')).map(f => path.join(process.cwd(), 'output', f));
    let csvUnits = [];
    CSVs.forEach(f => csvUnits.push(...readCsvUnitRecs(f)));

    const masterUnits = readMasterMap();

    const canonicalUnits = canonicalize(csvUnits, masterUnits);
    const relations = buildRelations(canonicalUnits);

    const conflicts = canonicalUnits.filter(u => (u.distinctRanges || []).length > 1).map(u => ({ key: u.key, distinctRanges: u.distinctRanges, examples: u.examples.slice(0,3) }));

    const payload = { generatedAt: new Date().toISOString(), units: canonicalUnits, relations, conflicts, stats: { csvUnitCount: csvUnits.length, masterUnitCount: masterUnits.length } };

    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    return { out, payload };
  } catch (e) {
    throw e;
  }
}

module.exports = { run, parseUnitRecFromToken, readCsvUnitRecs };

// If run directly
if (require.main === module) {
  const out = path.join(process.cwd(), 'output', 'unitTreeMap.json');
  try {
    const res = run({ out });
    console.log('Wrote', res.out);
    process.exit(0);
  } catch (e) {
    console.error('Failed to export:', e);
    process.exit(1);
  }
}
