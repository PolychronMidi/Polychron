const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');

const reportPath = path.join(OUT, 'layerAlignment-report.json');
if (!fs.existsSync(reportPath)) {
  console.error('layerAlignment report not found:', reportPath);
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const CSV = {
  primary: path.join(OUT, 'output1.csv'),
  poly: path.join(OUT, 'output2.csv')
};

const out = { generatedAt: new Date().toISOString(), reportSummary: { trackDelta: report.trackDelta, trackProblem: report.trackProblem, trackLengths: report.trackLengths }, findings: [] };

// Helper: read last meaningful marker lines in CSV
function lastLines(filePath, n = 200) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - n));
}

// Check per-layer: last end_tick from unit-derived data (unitTreeMap.json preferred), fallback to CSV end_track
let unitTree = null;
const utp = path.join(OUT, 'unitTreeMap.json');
if (fs.existsSync(utp)) {
  try { unitTree = JSON.parse(fs.readFileSync(utp,'utf8')) } catch (e) { unitTree = null }
}

for (const layer of Object.keys(report.trackLengths || {})) {
  const lk = report.trackLengths[layer] || {};
  const csvPath = CSV[layer] || null;
  const tail = csvPath ? lastLines(csvPath, 400) : [];
  const lastMarkers = tail.filter(l => l.toLowerCase().includes('marker_t'));
  // Find last explicit unitRec marker (either as marker_t token or appended unit id in tick field) and the last end_track line
  const lastUnitRecMarker = tail.slice().reverse().find(l => l.includes('unitRec:')) || null;
  let lastUnitRecAppended = null;
  const lastEndTrackLine = tail.slice().reverse().find(l => l.includes('end_track')) || null;
  for (const ln of tail.slice().reverse()) {
    // match '1,<tickField>,<type>,...'
    const m = String(ln).match(/^\s*1,([^,]+),([^,]+),/);
    if (!m) continue;
    const tickField = m[1] || '';
    // appended unit id form: '7499|layer1/...'
    if (tickField.includes('|') && !/^\d+$/.test(tickField)) {
      // prefer trailing id pattern (after first '|')
      const idx = tickField.indexOf('|');
      const candidate = tickField.slice(idx + 1);
      lastUnitRecAppended = { line: ln, tickField, appended: candidate };
      break;
    }
  }
  const lastUnitRec = lastUnitRecMarker || (lastUnitRecAppended ? lastUnitRecAppended.line : null);

  // parse last Section/Phrase markers in tail for endTick and endTime details
  const parseHMSToSec = (tstr) => { const parts = String(tstr).trim().split(':').map(s=>s.trim()); if (parts.length===1) return Number(parts[0])||0; const min=Number(parts[0])||0; const sec=Number(parts[1])||0; return min*60+sec; };
  const lastSectionLine = tail.slice().reverse().find(l => /Section\s*\d+\//i.test(l) && /endTick:/i.test(l));
  const lastPhraseLine = tail.slice().reverse().find(l => /Phrase\s*\d+\//i.test(l) && /endTick:/i.test(l));
  const sectionInfo = lastSectionLine ? (()=>{ const m = String(lastSectionLine).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i); const m2 = String(lastSectionLine).match(/\(([^\)]+)\s*-\s*([^\)]+)\)/); const m3 = String(lastSectionLine).match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i); return { line: lastSectionLine, endTick: m?Number(m[1]):null, endTime: m2?parseHMSToSec(m2[2]):(m3 && m && m[1]? Number(m[1])?Number(m[1]):null : null), tpSec: m3?Number(m3[1]):null }; })() : null;
  const phraseInfo = lastPhraseLine ? (()=>{ const m = String(lastPhraseLine).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i); const m2 = String(lastPhraseLine).match(/\(([^\)]+)\s*-\s*([^\)]+)\)/); const m3 = String(lastPhraseLine).match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i); return { line: lastPhraseLine, endTick: m?Number(m[1]):null, endTime: m2?parseHMSToSec(m2[2]):(m3 && m && m[1]? Number(m[1])?Number(m[1]):null : null), tpSec: m3?Number(m3[1]):null }; })() : null;

  const candidate = { layer, declaredTrackEnd: lk.value, declaredSource: lk.source, lastMarkerCount: lastMarkers.length, lastUnitRecLine: lastUnitRec, lastEndTrackLine, lastSection: sectionInfo, lastPhrase: phraseInfo };

  // Scan entire CSV for Section markers and compute the maximum endTick/endTime reported by sections (if any)
  try {
    const csvTxt = csvPath && fs.existsSync(csvPath) ? fs.readFileSync(csvPath,'utf8') : '';
    const linesAll = csvTxt.split(/\r?\n/);
    let maxSectionEndTime = -Infinity, maxSectionEndTick = -Infinity;
    for (const ln of linesAll) {
      if (!ln || ln.indexOf('marker_t') === -1) continue;
      const ms = String(ln).match(/Section\s*(\d+)\/\d+.*?\(([\d:\.]+)\s*-\s*([\d:\.]+)\)/i);
      if (ms) {
        const endStr = ms[3];
        const endTime = parseHMSToSec(endStr);
        if (Number.isFinite(endTime)) maxSectionEndTime = Math.max(maxSectionEndTime, endTime);
      }
      const mt = String(ln).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
      if (mt) {
        const et = Number(mt[1]);
        if (Number.isFinite(et)) maxSectionEndTick = Math.max(maxSectionEndTick, et);
      }
    }
    if (maxSectionEndTime !== -Infinity) candidate.maxSectionEndTime = maxSectionEndTime;
    if (maxSectionEndTick !== -Infinity) candidate.maxSectionEndTick = maxSectionEndTick;
  } catch (e) {}

  // If unitTree present, compute last canonical endTime/endTick for this layer
  if (unitTree && Array.isArray(unitTree.units)) {
    const units = unitTree.units.filter(u => String(u.layer) === String(layer));
    if (units.length) {
      const maxTime = units.reduce((m,u) => (Number.isFinite(Number(u.endTime)) ? Math.max(m, Number(u.endTime)) : m), -Infinity);
      const maxTick = units.reduce((m,u) => (Number.isFinite(Number(u.endTick)) ? Math.max(m, Number(u.endTick)) : m), -Infinity);
      candidate.unitTreeMaxEndTime = Number.isFinite(maxTime) ? maxTime : null;
      candidate.unitTreeMaxEndTick = Number.isFinite(maxTick) ? maxTick : null;
    }
  }

  // If no unitRec at tail, suggest adding explicit final unitRec markers
  if (!candidate.lastUnitRecLine) {
    candidate.suspected = 'no tail unitRec marker found';
    candidate.suggestion = 'Ensure final phrase/section/unitRec markers are emitted near the end of the track so canonical map captures the full duration.';
  } else {
    candidate.suspected = 'tail unitRec present';
    // parse end tick/time from that unitRec token for quick sanity
    const m = String(candidate.lastUnitRecLine || '').match(/unitRec:([^\s,]+)/);
    if (m) {
      const token = m[1];
      const seg = token.split('|');
      const last = seg[seg.length-1] || '';
      const secondLast = seg[seg.length-2] || '';
      if (last && last.includes('.')) {
        const rs = last.split('-'); candidate.unitRecTailStartTime = Number(rs[0]); candidate.unitRecTailEndTime = Number(rs[1]);
        if (secondLast && secondLast.includes('-')) { const rt = secondLast.split('-'); candidate.unitRecTailStartTick = Number(rt[0]); candidate.unitRecTailEndTick = Number(rt[1]); }
      } else if (last && last.includes('-')) {
        const rt = last.split('-'); candidate.unitRecTailStartTick = Number(rt[0]); candidate.unitRecTailEndTick = Number(rt[1]);
      }
    }
  }

  out.findings.push(candidate);
}

const outPath = path.join(OUT, 'layerAlignment-track-triage.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
console.log(out.findings.map(f => ({ layer: f.layer, suspected: f.suspected, suggestion: f.suggestion || null, lastUnitRecPresent: !!f.lastUnitRecLine })));
