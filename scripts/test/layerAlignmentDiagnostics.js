#!/usr/bin/env node
// layerAlignmentDiagnostics.js
// Generates a diagnostics JSON for each phrase mismatch listed in output/layerAlignment-report.json
// Includes raw marker lines and computed absolute times using the same heuristics as layerAlignment.

const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const REPORT = path.join(OUT, 'layerAlignment-report.json');
const UNITS = path.join(OUT, 'units.json');

if (!fs.existsSync(REPORT)) {
  console.error('Report not found. Run npm run layer-alignment first.');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const mismatches = (report && Array.isArray(report.phraseMismatches)) ? report.phraseMismatches : [];
if (!mismatches.length) {
  console.log('No phrase mismatches found in report. Nothing to do.');
  process.exit(0);
}

// Read units to enable grouping per s/p where possible
let units = [];
if (fs.existsSync(UNITS)) {
  try { units = JSON.parse(fs.readFileSync(UNITS, 'utf8')).units || []; } catch (e) { units = []; }
}

// Build grouped phrase start/end by layer and key (s{n}-p{m}) from units
const groupedByLayer = {};
for (const u of units) {
  try {
    const parts = String(u.unitId || '').split('|');
    let s = 0, p = 0;
    for (const part of parts) {
      const ms = String(part).match(/^section(\d+)/i);
      const mp = String(part).match(/^phrase(\d+)/i);
      if (ms) s = Number(ms[1]) - 1;
      if (mp) p = Number(mp[1]) - 1;
    }
    const key = `s${s}-p${p}`;
    groupedByLayer[u.layer] = groupedByLayer[u.layer] || {};
    groupedByLayer[u.layer][key] = groupedByLayer[u.layer][key] || [];
    groupedByLayer[u.layer][key].push(u);
  } catch (e) {}
}

const groupedBounds = {};
for (const layer of Object.keys(groupedByLayer)) {
  groupedBounds[layer] = {};
  for (const k of Object.keys(groupedByLayer[layer])) {
    const arr = groupedByLayer[layer][k];
    const start = Math.min(...arr.map(x => Number(x.startTime || Infinity)));
    const end = Math.max(...arr.map(x => Number(x.endTime || -Infinity)));
    if (Number.isFinite(start) && Number.isFinite(end)) groupedBounds[layer][k] = { start, end };
  }
}

// Parse CSV phrase markers per layer in order
const csvFiles = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT, f));
const phraseMarkersByLayer = {}; // layer -> [ { raw, tick, localStart, localEnd, tpSec, endTick, lengthSec, sectionIdx, phraseIdx } ]

function parseHMSToSec(tstr) {
  const parts = String(tstr || '').trim().split(':').map(s => s.trim());
  if (!parts.length) return 0;
  if (parts.length === 1) return Number(parts[0]) || 0;
  const min = Number(parts[0]) || 0;
  const sec = Number(parts[1]) || 0;
  return min * 60 + sec;
}

for (const f of csvFiles) {
  const fname = path.basename(f).toLowerCase();
  const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
  phraseMarkersByLayer[layer] = phraseMarkersByLayer[layer] || [];
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(',');
    if (parts.length < 4) continue;
    const t = parts[2];
    if (String(t).toLowerCase() !== 'marker_t') continue;
    const tickNum = Number(parts[1]);
    const val = parts.slice(3).join(',');
    const leadToken = String(val).trim().split(/\s+/)[0] || '';
    const leadParts = (leadToken || '').split('|');
    let leadSectionIdx = null;
    for (const lp of leadParts) {
      const mm = String(lp).match(/^section(\d+)/i);
      if (mm) { leadSectionIdx = Number(mm[1]) - 1; break; }
    }

    const mPhrase = String(val).match(/(Phrase)\s*(\d+)\/(\d+).*\(([^\)]+)\s*-\s*([^\)]+)\)/i);
    if (mPhrase) {
      const phraseIdx = Number(mPhrase[2]) - 1;
      const localStart = parseHMSToSec(mPhrase[4]);
      const localEnd = parseHMSToSec(mPhrase[5]);
      const mLen = String(val).match(/Length:\s*([0-9]+:[0-9]+\.[0-9]+)/i);
      const lengthSec = mLen ? parseHMSToSec(mLen[1]) : null;
      const mTp = String(val).match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i);
      const tpSec = mTp ? Number(mTp[1]) : null;
      const mEndTick = String(val).match(/endTick:\s*([0-9]+)/i);
      const endTick = mEndTick ? Number(mEndTick[1]) : null;
      phraseMarkersByLayer[layer].push({ raw: val, tick: tickNum, localStart, localEnd, lengthSec, tpSec, endTick, sectionIdx: leadSectionIdx, phraseIdx });
    }
  }
}

function computeAbsFromMarker(marker, layer, groupedBoundsForLayer) {
  // Prefer endTick/tpSec/length; else use tick/tpSec; else fallback to localStart/localEnd as-is
  const res = { candStart: null, candEnd: null, method: null };
  if (marker.tpSec && marker.endTick && marker.lengthSec) {
    const candEnd = Number(marker.endTick) / Number(marker.tpSec);
    const candStart = candEnd - Number(marker.lengthSec);
    if (Number.isFinite(candStart) && Number.isFinite(candEnd)) {
      res.candStart = Number(candStart.toFixed(6));
      res.candEnd = Number(candEnd.toFixed(6));
      res.method = 'endTick/tpSec/length';
      return res;
    }
  }
  if (marker.tpSec && marker.tick) {
    const candStart = Number(marker.tick) / Number(marker.tpSec);
    if (Number.isFinite(candStart)) {
      res.candStart = Number(candStart.toFixed(6));
      // candEnd fallback: use candStart + length if present, else localEnd if present
      if (marker.lengthSec) res.candEnd = Number((candStart + Number(marker.lengthSec)).toFixed(6));
      else if (marker.localEnd !== undefined) {
        // if grouped bounds exist we can try to offset localStart -> absolute by grp.start + localStart
        res.candEnd = marker.localEnd; // indicate relative
      }
      res.method = 'tick/tpSec';
      return res;
    }
  }
  // Fallback: use groupedBounds if available to map localStart/localEnd into absolute
  if (groupedBoundsForLayer) {
    // try to find a group that matches the marker's section/phrase indices
    for (const k of Object.keys(groupedBoundsForLayer)) {
      // k like 'sX-pY'
      const m = k.match(/^s(\d+)-p(\d+)$/);
      if (!m) continue;
      const s = Number(m[1]);
      const p = Number(m[2]);
      if ((marker.sectionIdx === undefined || marker.sectionIdx === s) && (marker.phraseIdx === undefined || marker.phraseIdx === p)) {
        const grp = groupedBoundsForLayer[k];
        if (grp && Number.isFinite(grp.start)) {
          res.candStart = Number((grp.start + marker.localStart).toFixed(6));
          res.candEnd = Number((grp.start + marker.localEnd).toFixed(6));
          res.method = 'groupedBounds+local';
          return res;
        }
      }
    }
  }
  // Last fallback: report local times as-is (relative)
  res.candStart = marker.localStart;
  res.candEnd = marker.localEnd;
  res.method = 'localFallback';
  return res;
}

const diagnostics = { generatedAt: (new Date()).toISOString(), sourceReport: REPORT, mismatches: [] };

for (const mm of mismatches) {
  const layer = mm.layer;
  const ord = mm.ordinal;
  const arr = phraseMarkersByLayer[layer] || [];
  const marker = arr[ord] || null;
  const groupForLayer = groupedBounds[layer] || null;
  const computed = marker ? computeAbsFromMarker(marker, layer, groupForLayer) : { error: 'marker not found at ordinal' };
  const groupKey = marker && groupForLayer ? Object.keys(groupForLayer).find(k => {
    const m = k.match(/^s(\d+)-p(\d+)$/);
    if (!m) return false;
    const s = Number(m[1]);
    const p = Number(m[2]);
    return (marker.sectionIdx === undefined || marker.sectionIdx === s) && (marker.phraseIdx === undefined || marker.phraseIdx === p);
  }) : null;
  const groupBounds = groupKey ? groupForLayer[groupKey] : null;

  diagnostics.mismatches.push({
    ordinal: ord,
    layer,
    report: mm,
    markerFound: !!marker,
    marker: marker || null,
    computedAbsolute: computed,
    matchedGroupKey: groupKey,
    matchedGroupBounds: groupBounds || null
  });
}

const outPath = path.join(OUT, 'layerAlignment-diagnostics.json');
fs.writeFileSync(outPath, JSON.stringify(diagnostics, null, 2));
console.log(`Diagnostics written to ${outPath} (${diagnostics.mismatches.length} entries).`);

process.exit(0);
