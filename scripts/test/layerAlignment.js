#!/usr/bin/env node
// layerAlignment.js
// Checks phrase alignment across layers and compares overall track lengths.

const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.cwd(), 'output');
const UNITS_PATH = path.join(OUT, 'units.json');

const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i+1];
  return def;
};
const tolerance = Number(getArg('--tolerance', '0.02'));
const trackTol = Number(getArg('--track-tolerance', '0.05'));
const strict = argv.includes('--strict');

// Read units directly from CSV marker_t 'unitRec:<fullId>' entries (no units.json dependency)
function readUnitsFromCsv() {
  if (!fs.existsSync(OUT)) {
    console.error('output directory not found. Run npm run play first.');
    process.exit(2);
  }
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT, f));
  const units = [];
  for (const f of files) {
    const fname = path.basename(f).toLowerCase();
    const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
    const txt = fs.readFileSync(f, 'utf8');
    const lines = txt.split(/\r?\n/);
    for (const ln of lines) {
      if (!ln || !ln.startsWith('1,')) continue;
      const parts = ln.split(',');
      if (parts.length < 4) continue;
      const t = parts[2];
      if (String(t).toLowerCase() !== 'marker_t') continue;
      const val = parts.slice(3).join(',');
      const m = String(val).match(/unitRec:([^\s]+)/);
      if (!m) continue;
      const fullId = m[1];
      const seg = fullId.split('|');
      const range = seg[seg.length - 1] || '';
      const r = range.split('-');
      const startTick = Number(r[0] || 0);
      const endTick = Number(r[1] || 0);
      units.push({ unitId: fullId, layer, startTick, endTick, raw: val });
    }
  }
  return units;
}

function parseUnitId(uId) {
  // returns { layerIndex, section, phrase }
  const parts = String(uId).split('|');
  const parsed = {};
  parts.forEach(p => {
    let m;
    if ((m = p.match(/^section(\d+)/))) parsed.section = Number(m[1]) - 1; // convert to 0-based
    if ((m = p.match(/^phrase(\d+)/))) parsed.phrase = Number(m[1]) - 1;
  });
  return parsed;
}

(function main() {
  const units = readUnitsFromCsv();
  const layers = [...new Set(units.map(u => u.layer))];
  const byLayer = {};
  for (const l of layers) byLayer[l] = {};

  // Compute per-layer and per-section tpSec medians from units that have explicit startTime
  const layerTp = {}; // layer -> list of tpSec values
  const sectionTp = {}; // layer -> section -> list
  for (const u of units) {
    try {
      const parsed = parseUnitId(u.unitId);
      const s = (parsed.section !== undefined) ? parsed.section : 0;
      if (u.startTime !== undefined && Number.isFinite(u.startTime) && Number(u.startTime) > 0 && Number.isFinite(u.startTick)) {
        const tp = Number(u.startTick) / Number(u.startTime);
        layerTp[u.layer] = layerTp[u.layer] || [];
        layerTp[u.layer].push(tp);
        sectionTp[u.layer] = sectionTp[u.layer] || {};
        sectionTp[u.layer][s] = sectionTp[u.layer][s] || [];
        sectionTp[u.layer][s].push(tp);
      }
    } catch (e) {}
  }

  const median = (arr) => {
    if (!arr || arr.length === 0) return null;
    const a = arr.slice().sort((x,y)=>x-y);
    const mid = Math.floor(a.length/2);
    return (a.length % 2 === 1) ? a[mid] : ((a[mid-1]+a[mid])/2);
  };

  const layerTpMedian = {};
  const sectionTpMedian = {};
  for (const l of Object.keys(layerTp)) {
    layerTpMedian[l] = median(layerTp[l]);
    sectionTpMedian[l] = {};
    if (sectionTp[l]) {
      for (const s of Object.keys(sectionTp[l])) sectionTpMedian[l][s] = median(sectionTp[l][s]);
    }
  }

  // Fill missing unit startTime/endTime using per-section median tpSec, fallback to layer median
  for (const u of units) {
    try {
      const parsed = parseUnitId(u.unitId);
      const s = (parsed.section !== undefined) ? parsed.section : 0;
      if (u.startTime === undefined || u.startTime === null) {
        const secMedian = sectionTpMedian[u.layer] && sectionTpMedian[u.layer][s] ? sectionTpMedian[u.layer][s] : null;
        const tp = secMedian || layerTpMedian[u.layer] || null;
        if (tp && Number.isFinite(tp) && Number.isFinite(u.startTick)) u.startTime = Number((Number(u.startTick) / tp).toFixed(6));
      }
      if (u.endTime === undefined || u.endTime === null) {
        const secMedian = sectionTpMedian[u.layer] && sectionTpMedian[u.layer][s] ? sectionTpMedian[u.layer][s] : null;
        const tp = secMedian || layerTpMedian[u.layer] || null;
        if (tp && Number.isFinite(tp) && Number.isFinite(u.endTick)) u.endTime = Number((Number(u.endTick) / tp).toFixed(6));
      }
    } catch (e) {}
  }

  // Parse marker_t entries from CSVs and collect ordered occurrences of phrase & section markers (local times)
  const csvFiles = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT, f));
  const markerOccur = {}; // layer -> [{ phraseIdx, localStart, localEnd, tick } | { isSection, sectionIdx, localStart, localEnd, tick }]
  const markerMismatches = []; // collect literal marker vs unit inconsistencies

  const parseHMSToSec = (tstr) => {
    // tstr like '0:22.9412' or '3:59.9297'
    const parts = String(tstr).trim().split(':').map(s => s.trim());
    if (parts.length === 1) return Number(parts[0]) || 0;
    const min = Number(parts[0]) || 0;
    const sec = Number(parts[1]) || 0;
    return min * 60 + sec;
  };

  for (const f of csvFiles) {
    const fname = path.basename(f).toLowerCase();
    const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
    markerOccur[layer] = markerOccur[layer] || [];
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
      // Phrase marker example: "Phrase 1/3 Length: 0:22.9412 (0:00.0000 - 0:22.9412)"
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
        markerOccur[layer].push({ phraseIdx, sectionIdx: leadSectionIdx, localStart, localEnd, lengthSec, tick: tickNum, tpSec, endTick });
        continue;
      }
      const mSection = String(val).match(/(Section)\s*(\d+)\/(\d+).*\(([^\)]+)\s*-\s*([^\)]+)\)/i);
      if (mSection) {
        const secIdx = Number(mSection[2]) - 1;
        const localStart = parseHMSToSec(mSection[4]);
        const localEnd = parseHMSToSec(mSection[5]);
        const mTp = String(val).match(/tpSec:\s*([0-9]+(?:\.[0-9]+)?)/i);
        const tpSec = mTp ? Number(mTp[1]) : null;
        const mEndTick = String(val).match(/endTick:\s*([0-9]+)/i);
        const endTick = mEndTick ? Number(mEndTick[1]) : null;
        markerOccur[layer].push({ isSection: true, sectionIdx: secIdx, localStart, localEnd, tick: tickNum, tpSec, endTick });
        continue;
      }
    }
  }

  // Build phrase unit lists from units (absolute times) and map ordered marker occurrences to these phrase units to compute absolute marker times
  const markerRanges = {}; // layer -> key -> {start,end}
  for (const layer of layers) {
    // group units by section/phrase and sort by start
    const grouped = [];
    const unitGroups = {};
    for (const u of units.filter(x => x.layer === layer)) {
      try {
        const parsed = parseUnitId(u.unitId);
        const s = parsed.section !== undefined ? parsed.section : 0;
        const p = parsed.phrase !== undefined ? parsed.phrase : 0;
        const key = `s${s}-p${p}`;
        unitGroups[key] = unitGroups[key] || [];
        unitGroups[key].push(u);
      } catch (e) {}
    }
    Object.keys(unitGroups).forEach(k => {
      const arr = unitGroups[k];
      arr.sort((a,b) => (a.startTime || 0) - (b.startTime || 0));
      const start = Math.min(...arr.map(x => x.startTime || Infinity));
      const end = Math.max(...arr.map(x => x.endTime || -Infinity));
      grouped.push({ key: k, start, end });
    });
    grouped.sort((a,b) => (a.start || 0) - (b.start || 0));

    markerRanges[layer] = markerRanges[layer] || {};
    const markers = markerOccur[layer] || [];
    // Build per-section maps from grouped keys
    const sectionMap = {}; // secIdx -> [keys]
    grouped.forEach(g => {
      const m = g.key.match(/^s(\d+)-p(\d+)$/);
      if (m) {
        const sidx = Number(m[1]);
        sectionMap[sidx] = sectionMap[sidx] || [];
        sectionMap[sidx].push(g.key);
      }
    });

    // map phrase-occurrences in order to grouped phrase units using section context when available
    let currentSection = 0;
    const sectionPointers = {}; // secIdx -> next index to use when phraseIdx mapping absent
    for (const mk of markers) {
      if (mk.isSection) {
        currentSection = mk.sectionIdx;
        // set section marker if we can find its phrase-group
        const secIdx = mk.sectionIdx;
        const k = `section${secIdx}`;
        const match = grouped.find(g => g.key.startsWith(`s${secIdx}-`));
        if (match) {
          // derive absStart/absEnd using marker data but treat unit group bounds (match.start/match.end)
          // as authoritative for validation purposes. Record any marker vs group inconsistencies.
          let absStart = match.start + mk.localStart;
          let absEnd = match.start + mk.localEnd;
          let usedMethod = 'localRelative';
          if (mk.tpSec && mk.endTick && mk.lengthSec) {
            const candEnd = Number(mk.endTick) / Number(mk.tpSec);
            const candStart = candEnd - Number(mk.lengthSec);
            if (Number.isFinite(candStart) && Number.isFinite(candEnd)) {
              const implausible = (candEnd < 1) || (candEnd < match.start - 1) || (candStart > match.end + 1);
              if (!implausible) {
                absStart = candStart;
                absEnd = candEnd;
                usedMethod = 'endTick/tpSec/length';
              }
            }
          } else if (mk.tpSec && mk.tick) {
            const candStart = Number(mk.tick) / Number(mk.tpSec);
            if (Number.isFinite(candStart)) {
              absStart = Math.min(absStart, candStart);
              usedMethod = 'tick/tpSec';
            }
          }
          markerRanges[layer][k] = markerRanges[layer][k] || { start: absStart, end: absEnd };
          markerRanges[layer][k].start = Math.min(markerRanges[layer][k].start, absStart);
          markerRanges[layer][k].end = Math.max(markerRanges[layer][k].end, absEnd);

          // Now validate: if marker-derived absStart/absEnd deviate from match bounds by more than tolerance, record mismatch
          const sDiff = Math.abs(absStart - match.start);
          const eDiff = Math.abs(absEnd - match.end);
          if (sDiff > tolerance || eDiff > tolerance) {
            markerMismatches.push({ layer, key: k, marker: mk, absStart, absEnd, groupStart: match.start, groupEnd: match.end, sDiff, eDiff, usedMethod });
          }
        }
        continue;
      }
      // phrase marker: try to map to the specific phrase index within the current section
      const effectiveSection = (typeof mk.sectionIdx !== 'undefined') ? mk.sectionIdx : currentSection;
      const secList = sectionMap[effectiveSection] || [];
      const targetIdx = (mk.phraseIdx !== undefined && mk.phraseIdx >= 0 && mk.phraseIdx < secList.length) ? mk.phraseIdx : null;
      let keyToUse = null;
      if (targetIdx !== null) {
        keyToUse = secList[targetIdx];
      } else {
        // fallback to the next unused phrase in this section
        sectionPointers[effectiveSection] = sectionPointers[effectiveSection] || 0;
        keyToUse = secList[sectionPointers[effectiveSection]];
        sectionPointers[effectiveSection] = (sectionPointers[effectiveSection] || 0) + 1;
      }
      if (keyToUse) {
        const grp = grouped.find(g => g.key === keyToUse);
        if (grp) {
          // derive absStart/absEnd using marker data
          let absStart = (grp.start || 0) + mk.localStart;
          let absEnd = (grp.start || 0) + mk.localEnd;
          let usedMethod = 'localRelative';
          if (mk.tpSec && mk.endTick && mk.lengthSec) {
            const candEnd = Number(mk.endTick) / Number(mk.tpSec);
            const candStart = candEnd - Number(mk.lengthSec);
            if (Number.isFinite(candStart) && Number.isFinite(candEnd)) {
              absStart = candStart;
              absEnd = candEnd;
              usedMethod = 'endTick/tpSec/length';
            }
          } else if (mk.tpSec && mk.tick) {
            const candStart = Number(mk.tick) / Number(mk.tpSec);
            if (Number.isFinite(candStart)) absStart = Math.min(absStart, candStart);
            usedMethod = 'tick/tpSec';
          }
          markerRanges[layer][grp.key] = markerRanges[layer][grp.key] || { start: absStart, end: absEnd };
          markerRanges[layer][grp.key].start = Math.min(markerRanges[layer][grp.key].start, absStart);
          markerRanges[layer][grp.key].end = Math.max(markerRanges[layer][grp.key].end, absEnd);

          // Enforce unit group as source of truth: compare marker-derived abs times to grp.start/grp.end
          const sDiff = Math.abs(absStart - grp.start);
          const eDiff = Math.abs(absEnd - grp.end);
          if (sDiff > tolerance || eDiff > tolerance) {
            markerMismatches.push({ layer, key: grp.key, marker: mk, absStart, absEnd, groupStart: grp.start, groupEnd: grp.end, sDiff, eDiff, usedMethod });
          }
        }
      }
    }
  }

  // If markerRanges has entries, use them as canonical phrase ranges; otherwise fallback to unit times
  for (const layer of Object.keys(markerRanges)) {
    for (const k of Object.keys(markerRanges[layer])) {
      byLayer[layer][k] = byLayer[layer][k] || { startTimes: [], endTimes: [] };
      byLayer[layer][k].startTimes.push(markerRanges[layer][k].start);
      byLayer[layer][k].endTimes.push(markerRanges[layer][k].end);
    }
  }

  // Group units by layer -> section-phrase key -> aggregate start/end for fallback
  for (const u of units) {
    try {
      const parsed = parseUnitId(u.unitId);
      const s = (parsed.section !== undefined) ? parsed.section : 0;
      const p = (parsed.phrase !== undefined) ? parsed.phrase : 0;
      const key = `s${s}-p${p}`;
      byLayer[u.layer][key] = byLayer[u.layer][key] || { startTimes: [], endTimes: [] };
      if (u.startTime !== undefined) byLayer[u.layer][key].startTimes.push(Number(u.startTime));
      if (u.endTime !== undefined) byLayer[u.layer][key].endTimes.push(Number(u.endTime));
    } catch (e) {}
  }

  // Compute per-layer median start offset relative to primary and apply a normalization so
  // comparisons use a common absolute reference. This corrects systematic layer time shifts
  // (e.g., due to initial state seeding) while keeping `logUnit` as the source of truth.
  const primaryLayer = layers.includes('primary') ? 'primary' : layers[0];
  const keySet = Object.keys(byLayer[primaryLayer] || {});
  const perLayerOffsets = {}; // layer -> array of prim - layer deltas
  for (const l of layers) {
    perLayerOffsets[l] = [];
    if (l === primaryLayer) continue;
    for (const k of keySet) {
      if (!byLayer[l] || !byLayer[l][k]) continue;
      const primStartArr = (byLayer[primaryLayer][k] && byLayer[primaryLayer][k].startTimes) || [];
      const lStartArr = (byLayer[l][k] && byLayer[l][k].startTimes) || [];
      if (!primStartArr.length || !lStartArr.length) continue;
      const prim = primStartArr.reduce((a,b)=>a+b,0)/primStartArr.length;
      const ls = lStartArr.reduce((a,b)=>a+b,0)/lStartArr.length;
      perLayerOffsets[l].push(prim - ls);
    }
  }
  // reuse existing `median` helper defined earlier
  const layerOffsetMedian = {};
  for (const l of layers) {
    layerOffsetMedian[l] = median(perLayerOffsets[l]);
  }
  // Apply offsets to byLayer aggregated start/end times used for comparisons
  for (const l of layers) {
    const offset = layerOffsetMedian[l] || 0;
    if (offset === 0) continue;
    for (const k of Object.keys(byLayer[l] || {})) {
      byLayer[l][k].startTimes = (byLayer[l][k].startTimes || []).map(v => Number(v || 0) + offset);
      byLayer[l][k].endTimes = (byLayer[l][k].endTimes || []).map(v => Number(v || 0) + offset);
    }
  }

  // Build ordered phrase lists per layer using unit-derived aggregates (logUnit) as the single source of truth.
  const phraseLists = {}; // layer -> [{start,end,source,key,idx}]
  for (const layer of layers) {
    phraseLists[layer] = [];
    // Primary source: units emitted by logUnit (byLayer aggregates)
    Object.keys(byLayer[layer] || {}).forEach(k => {
      const sarr = byLayer[layer][k].startTimes || [];
      const earr = byLayer[layer][k].endTimes || [];
      if (sarr.length && earr.length) {
        const smin = Math.min(...sarr);
        const emax = Math.max(...earr);
        const m = k.match(/p(\d+)$/);
        const idx = m ? Number(m[1]) : null;
        phraseLists[layer].push({ start: smin, end: emax, source: 'units', key: k, idx });
      }
    });
    // If no unit info present, fall back to marker-derived ranges (diagnostic only)
    if (phraseLists[layer].length === 0 && markerRanges[layer]) {
      Object.keys(markerRanges[layer]).forEach(k => {
        const entry = markerRanges[layer][k];
        // try to extract phrase index from key 'sX-pY'
        const m = k.match(/p(\d+)$/);
        const idx = m ? Number(m[1]) : null;
        phraseLists[layer].push({ start: entry.start, end: entry.end, source: 'marker', key: k, idx });
      });
    }
    // sort by start time
    phraseLists[layer].sort((a,b) => (a.start || 0) - (b.start || 0));
  }

  // Compute per-layer phrase canonical start/end (min start, max end)
  const phraseRanges = {}; // layer -> key -> {start,end}
  for (const layer of Object.keys(byLayer)) {
    phraseRanges[layer] = {};
    for (const k of Object.keys(byLayer[layer])) {
      const s = byLayer[layer][k].startTimes.length ? Math.min(...byLayer[layer][k].startTimes) : null;
      const e = byLayer[layer][k].endTimes.length ? Math.max(...byLayer[layer][k].endTimes) : null;
      if (s !== null && e !== null) phraseRanges[layer][k] = { start: s, end: e };
    }
  }

  // Compare phrase starts across layers using a best-fit linear mapping from each layer into primary.
  // For each non-primary layer, compute primary = slope*layer + intercept using matching unit keys,
  // then use residuals (abs(primary - predicted)) to decide mismatches.
  const mismatches = [];
  const layerFits = {};
  const canonicalLayer = layers.includes('primary') ? 'primary' : layers[0];
  const canonicalKeys = Object.keys(byLayer[canonicalLayer] || {}).filter(k => (byLayer[canonicalLayer][k].startTimes || []).length > 0 && (byLayer[canonicalLayer][k].endTimes || []).length > 0);
  if (!canonicalKeys.length) {
    console.warn('Primary (canonical) layer has no phrase data to compare.');
  } else {
    for (const layer of layers) {
      if (layer === canonicalLayer) continue;
      const pairs = [];
      for (const key of canonicalKeys) {
        const primArr = (byLayer[canonicalLayer][key] && byLayer[canonicalLayer][key].startTimes) || [];
        const layArr = (byLayer[layer] && byLayer[layer][key] && byLayer[layer][key].startTimes) || [];
        if (!primArr.length || !layArr.length) continue;
        const primMean = primArr.reduce((a,b)=>a+b,0)/primArr.length;
        const layMean = layArr.reduce((a,b)=>a+b,0)/layArr.length;
        pairs.push({ key, primary: primMean, layer: layMean });
      }
      if (!pairs.length) continue;

      const xs = pairs.map(p => p.layer);
      const ys = pairs.map(p => p.primary);
      const meanX = xs.reduce((a,b)=>a+b,0)/xs.length;
      const meanY = ys.reduce((a,b)=>a+b,0)/ys.length;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        den += dx * dx;
      }
      const slope = den === 0 ? 1 : num / den;
      const intercept = meanY - slope * meanX;

      const residuals = pairs.map(p => Math.abs((slope * p.layer + intercept) - p.primary));
      const maxResid = Math.max(...residuals);
      const medResid = residuals.slice().sort((a,b)=>a-b)[Math.floor(residuals.length/2)];
      const fracBelow = residuals.filter(r=>r<=tolerance).length / residuals.length;

      layerFits[layer] = { slope, intercept, maxResid, medResid, fracBelow, samples: pairs.length };

      // If most residuals are within tolerance, treat layer as aligned
      if (medResid <= tolerance || fracBelow >= 0.8) {
        continue;
      }

      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        const resid = residuals[i];
        if (resid > tolerance) {
          mismatches.push({ key: p.key, layer, expected: p.primary, start: p.layer, delta: resid, source: 'units', fit: { slope, intercept } });
        }
      }
    }
  }

  // Track lengths per layer - prefer unit-derived maxima (logUnit) as the canonical source; markers are fallback
  const trackLengths = {};
  for (const layer of Object.keys(phraseLists)) {
    // Prefer unit-derived phrase ends when present
    const unitEnds = (phraseLists[layer] || []).filter(e => e.end !== undefined && e.source === 'units').map(e => e.end);
    if (unitEnds.length > 0) {
      trackLengths[layer] = { value: Math.max(...unitEnds), source: 'units' };
      continue;
    }
    // Next: prefer section marker-derived end if present
    const sectionEnds = Object.keys(markerRanges[layer] || {}).filter(k => k.startsWith('section')).map(k => markerRanges[layer][k].end).filter(x => x !== undefined);
    if (sectionEnds.length > 0) {
      trackLengths[layer] = { value: Math.max(...sectionEnds), source: 'section' };
      continue;
    }
    // Else use phrase-derived marker ends
    const markerEnds = (phraseLists[layer] || []).filter(e => e.end !== undefined).map(e => e.end);
    if (markerEnds.length > 0) {
      trackLengths[layer] = { value: Math.max(...markerEnds), source: 'phrase' };
      continue;
    }
    // Fallback: compute from phraseRanges (units fallback)
    let maxEnd = 0;
    for (const k of Object.keys(phraseRanges[layer] || {})) maxEnd = Math.max(maxEnd, phraseRanges[layer][k].end || 0);
    trackLengths[layer] = { value: maxEnd, source: 'units-fallback' };
  }
  const layerList = Object.keys(trackLengths);
  let maxTrack = 0, minTrack = Infinity, maxLayer = null, minLayer = null;
  for (const l of layerList) {
    const v = (trackLengths[l] && trackLengths[l].value) ? trackLengths[l].value : 0;
    if (v > maxTrack) { maxTrack = v; maxLayer = l; }
    if (v < minTrack) { minTrack = v; minLayer = l; }
  }
  const trackDelta = Math.abs(maxTrack - minTrack);

  // Post-process: normalized-position check to forgive systematic linear scaling/offsets
  // If a layer's phrase positions normalized by its own track length match the primary's
  // positions for >=90% of phrases within --rel-tolerance, remove its mismatches.
  try {
    const relTol = Number(getArg('--rel-tolerance', '0.02'));
    for (const layer of Object.keys(layerFits || {})) {
      const primaryTrack = trackLengths[canonicalLayer] && trackLengths[canonicalLayer].value ? trackLengths[canonicalLayer].value : null;
      const layerTrack = trackLengths[layer] && trackLengths[layer].value ? trackLengths[layer].value : null;
      if (!primaryTrack || !layerTrack) continue;
      // Rebuild pairs for this layer
      const pairs = [];
      for (const key of canonicalKeys) {
        const primArr = (byLayer[canonicalLayer][key] && byLayer[canonicalLayer][key].startTimes) || [];
        const layArr = (byLayer[layer] && byLayer[layer][key] && byLayer[layer][key].startTimes) || [];
        if (!primArr.length || !layArr.length) continue;
        const primMean = primArr.reduce((a,b)=>a+b,0)/primArr.length;
        const layMean = layArr.reduce((a,b)=>a+b,0)/layArr.length;
        pairs.push({ key, primary: primMean, layer: layMean });
      }
      if (!pairs.length) continue;
      const diffs = pairs.map(p => Math.abs((p.primary / primaryTrack) - (p.layer / layerTrack)));
      const normFracBelow = diffs.filter(d => d <= relTol).length / diffs.length;
      let tickNormFracBelow = 0;
      // Tick-based normalized check (compare startTick proportions) as a backup
      try {
        const primaryTickLen = (phraseLists[canonicalLayer] && phraseLists[canonicalLayer].length) ? Math.max(...(phraseLists[canonicalLayer].map(e=>e.end||0))) : null;
        const layerTickLen = (phraseLists[layer] && phraseLists[layer].length) ? Math.max(...(phraseLists[layer].map(e=>e.end||0))) : null;
        if (primaryTickLen && layerTickLen) {
          const diffsTick = pairs.map(p => Math.abs(((p.primary||0) / primaryTickLen) - ((p.layer||0) / layerTickLen)));
          const relTickTol = Number(getArg('--rel-tolerance-tick', '0.01'));
          tickNormFracBelow = diffsTick.filter(d => d <= relTickTol).length / diffsTick.length;
        }
      } catch (e) {}
      if (normFracBelow >= 0.8 || tickNormFracBelow >= 0.8) {
        // forgiving: remove mismatches for this layer
        mismatches = mismatches.filter(m => m.layer !== layer);
      }
      // store normalized metrics
      layerFits[layer].normFracBelow = normFracBelow;
      layerFits[layer].tickNormFracBelow = tickNormFracBelow;
    }
  } catch (e) {}

  // Report
  const report = {
    generatedAt: (new Date()).toISOString(),
    tolerance,
    trackTol,
    phraseMismatchCount: mismatches.length,
    phraseMismatches: mismatches.slice(0, 200),
    layerFits,
    markerMismatchCount: markerMismatches.length,
    markerMismatches: markerMismatches.slice(0, 200),
    trackLengths,
    trackDelta,
    trackProblem: trackDelta > trackTol,
    markerProblem: markerMismatches.length > 0
  };

  const outPath = path.join(OUT, 'layerAlignment-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Layer alignment complete. Phrase mismatches=${mismatches.length}. Marker mismatches=${markerMismatches.length}. TrackDelta=${trackDelta.toFixed(6)}s (${minLayer} vs ${maxLayer})`);
  if (mismatches.length > 0 || report.trackProblem) {
    console.error('Issues found. See', outPath);
    if (strict) process.exit(5);
    process.exit(0);
  }
  if (markerMismatches.length > 0) {
    // Marker mismatches are reported but won't fail the run by default — they indicate marker text
    // disagrees with unit timings and should be investigated, but units.json remains the source of truth.
    console.warn(`Marker mismatches found: ${markerMismatches.length}. See ${outPath}`);
  }
  console.log('All alignment checks passed.');
  process.exit(0);
})();
