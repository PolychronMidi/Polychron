// Per-phrase diagnostics: pair poly phrases with primary phrases and report time/tick mismatches
const fs = require('fs');
const path = require('path');

function parseTimeStr(t) {
  if (typeof t !== 'string') { console.warn('parseTimeStr: expected string, got', typeof t); return null; }
  const m = t.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) { console.warn('parseTimeStr: time string did not match expected format:', t); return null; }
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) { console.warn('parseTimeStr: parsed time parts are not finite:', t); return null; }
  return minutes * 60 + seconds;
}

function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const phrases = []; // {layer, sectionIndex, phraseIndex, startTick, endTick, lengthSec, tpSec, raw}
  let currentSection = { index: 1, startTick: null, phrases: [] };
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const tick = Number(parts[1]);
    const type = parts[2].trim();
    if (type !== 'marker_t') continue;
    const text = parts.slice(3).join(',');
    const sectionMatch = text.match(/Section\s+(\d+)\/(\d+)/i);
    if (sectionMatch) {
      if (currentSection.phrases.length || currentSection.startTick !== null) phrases.push(...currentSection.phrases);
      currentSection = { index: Number(sectionMatch[1]), startTick: tick, phrases: [] };
      continue;
    }
    const phraseMatch = text.match(/(primary|poly)\s+Phrase\s+(\d+)\/(\d+)/i);
    if (phraseMatch) {
      const layer = phraseMatch[1].toLowerCase();
      const pIdx = Number(phraseMatch[2]);
      // Length
      let lengthSec = null;
      const lenMatch = text.match(/Length:\s*([0-9]+:[0-9]+(?:\.[0-9]+)?)/i);
      if (lenMatch) {
        lengthSec = parseTimeStr(lenMatch[1]);
      }
      // endTick
      const endTickMatch = text.match(/endTick:\s*(\d+|null)/i);
      const endTick = endTickMatch && endTickMatch[1] && endTickMatch[1] !== 'null' ? Number(endTickMatch[1]) : null;
      // tpSec
      const tpSecMatch = text.match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i);
      const tpSec = tpSecMatch ? Number(tpSecMatch[1]) : null;
      // Start time strings in parentheses
      const parenMatch = text.match(/\(([^)]+) - ([^)]+)\)/);
      let startTime = null, endTime = null;
      if (parenMatch) {
        startTime = parseTimeStr(parenMatch[1]);
        endTime = parseTimeStr(parenMatch[2]);
      }
      const obj = {
        layer,
        section: currentSection.index,
        phraseIndex: pIdx,
        startTick: Number.isFinite(tick) ? tick : null,
        endTick,
        lengthSec,
        tpSec,
        startTime,
        endTime,
        raw: text
      };
      currentSection.phrases.push(obj);
      continue;
    }
  }
  // push any remaining
  if (currentSection.phrases.length) phrases.push(...currentSection.phrases);
  return phrases;
}

function groupBySection(phrases) {
  const out = {};
  for (const p of phrases) {
    const key = p.section || 1;
    out[key] = out[key] || [];
    out[key].push(p);
  }
  return out;
}

function matchAndReport(primaryList, polyList) {
  const rows = [];
  for (const polyPhrase of polyList) {
    // find primary phrases that overlap or start within poly's boundaries
    const polyStart = polyPhrase.startTick !== null ? polyPhrase.startTick : -Infinity;
    const polyEnd = polyPhrase.endTick !== null ? polyPhrase.endTick : Infinity;
    const matches = primaryList.filter(p => {
      const s = p.startTick !== null ? p.startTick : -Infinity;
      const e = p.endTick !== null ? p.endTick : Infinity;
      return (s >= polyStart && s < polyEnd) || (e > polyStart && e <= polyEnd) || (s < polyStart && e > polyEnd) || (polyStart < e && polyEnd > s);
    });

    if (matches.length === 0) {
      rows.push({ poly: polyPhrase, primary: null, note: 'no matching primary phrase' });
      continue;
    }

    for (const prim of matches) {
      const primComputedSec = prim.lengthSec !== null ? prim.lengthSec : (prim.endTick !== null && prim.startTick !== null && prim.tpSec ? (prim.endTick - prim.startTick) / prim.tpSec : null);
      const polyComputedSec = polyPhrase.lengthSec !== null ? polyPhrase.lengthSec : (polyPhrase.endTick !== null && polyPhrase.startTick !== null && polyPhrase.tpSec ? (polyPhrase.endTick - polyPhrase.startTick) / polyPhrase.tpSec : null);
      const secDiff = (primComputedSec !== null && polyComputedSec !== null) ? (primComputedSec - polyComputedSec) : null;
      const tickDiff = (prim.endTick !== null && polyPhrase.endTick !== null) ? ((prim.endTick - prim.startTick) - (polyPhrase.endTick - polyPhrase.startTick)) : null;
      rows.push({ poly: polyPhrase, primary: prim, primComputedSec, polyComputedSec, secDiff, tickDiff });
    }
  }
  return rows;
}

function formatSec(s) { return s === null || typeof s === 'undefined' ? 'N/A' : s.toFixed(4); }

function run() {
  const primary = parseFile(path.join(__dirname,'..','output','output1.csv'));
  const poly = parseFile(path.join(__dirname,'..','output','output2.csv'));
  const primaryBySection = groupBySection(primary);
  const polyBySection = groupBySection(poly);

  const diagnostics = [];
  for (const sec of Object.keys(polyBySection).sort((a,b)=>a-b)) {
    const pList = primaryBySection[sec] || [];
    const qList = polyBySection[sec] || [];
    const rows = matchAndReport(pList, qList);
    for (const r of rows) diagnostics.push({ section: sec, ...r });
  }

  // Filter for any secDiff absolute >= 0.001 or missing primary
  const issues = diagnostics.filter(d => (d.secDiff !== null && Math.abs(d.secDiff) >= 0.001) || d.primary === null);

  console.log(`Found ${diagnostics.length} pairings; ${issues.length} issues (|sec diff| >= 0.001 or no match).`);
  for (const it of issues) {
    if (!it.primary) {
      console.log(`Section ${it.section} POLY p${it.poly.phraseIndex} [startTick=${it.poly.startTick} endTick=${it.poly.endTick} lenSec=${formatSec(it.poly.lengthSec)} tpSec=${it.poly.tpSec}] -> NO PRIMARY MATCH`);
    } else {
      console.log(`Section ${it.section} POLY p${it.poly.phraseIndex} len=${formatSec(it.polyComputedSec)} (tpSec=${it.poly.tpSec})  VS PRIMARY p${it.primary.phraseIndex} len=${formatSec(it.primComputedSec)} (tpSec=${it.primary.tpSec})  diff=${formatSec(it.secDiff)} ticksDiff=${it.tickDiff}`);
    }
  }
}

run();
