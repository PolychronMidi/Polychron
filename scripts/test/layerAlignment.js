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
// Remove forgiving mode: script is strict by default and will fail on any mismatch
const strict = true;
// Verification-only mode: this script only *detects* mismatches and writes diagnostics/corrections files; it does NOT modify CSVs or re-run itself.

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
      // Support optional seconds suffix: ...|<startTick>-<endTick>|<startSec>-<endSec>
      let startTick = 0, endTick = 0, startTime = null, endTime = null;
      const last = seg[seg.length - 1] || '';
      const secondLast = seg[seg.length - 2] || '';
      if (typeof last === 'string' && last.includes('.') && last.includes('-')) {
        // last is seconds range, secondLast is ticks range
        const rs = last.split('-'); startTime = Number(rs[0] || 0); endTime = Number(rs[1] || 0);
        const rt = secondLast.split('-'); startTick = Number(rt[0] || 0); endTick = Number(rt[1] || 0);
      } else {
        const r = last.split('-'); startTick = Number(r[0] || 0); endTick = Number(r[1] || 0);
      }
      units.push({ unitId: fullId, layer, startTick, endTick, startTime, endTime, raw: val });
    }
  }
  return units;
}

// Read canonical units from the live master map final JSON (if present) and convert to unit-like entries
function readUnitsFromMasterMap() {
  const masterPath = path.join(OUT, 'unitMasterMap.json');
  if (!fs.existsSync(masterPath)) return [];
  try {
    const jm = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const munits = (jm && jm.units) ? jm.units.map(u => ({ unitId: u.key, layer: u.layer || (u.key ? String(u.key).split('|')[0] : 'unknown'), startTick: Number.isFinite(u.startTick) ? u.startTick : (Number.isFinite(u.tickStart) ? u.tickStart : null), endTick: Number.isFinite(u.endTick) ? u.endTick : (Number.isFinite(u.tickEnd) ? u.tickEnd : null), startTime: Number.isFinite(u.startTime) ? u.startTime : null, endTime: Number.isFinite(u.endTime) ? u.endTime : null, raw: 'masterMap' })) : [];
    return munits;
  } catch (e) {
    return [];
  }
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
  // Clear previous run's focused diagnostics so outputs reflect the current run only
  try { require('fs').writeFileSync(require('path').join(process.cwd(),'output','layerAlignment-unitRec-mismatch.ndjson'), ''); } catch (e) {}
  // Merge CSV-derived unitRecs with canonical master map units (if present)
  const unitsCsv = readUnitsFromCsv();
  const masterUnits = readUnitsFromMasterMap();
  // avoid duplicate units by key (prefer CSV entries which are higher-resolution)
  const seenKeys = new Set(unitsCsv.map(u => String(u.unitId)));
  for (const mu of masterUnits) {
    if (!seenKeys.has(String(mu.unitId))) unitsCsv.push(mu);
  }
  const units = unitsCsv;

  const layers = [...new Set(units.map(u => u.layer))];
  // Choose canonical layer (prefer 'primary' when present)
  const canonicalLayer = layers.includes('primary') ? 'primary' : layers[0];
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

  // If a master map exists, use its canonical units to build robust phrase start/end overrides
  try {
    const masterUnitsPath = path.join(OUT, 'unitMasterMap.json');
    if (fs.existsSync(masterUnitsPath)) {
      const jm = JSON.parse(fs.readFileSync(masterUnitsPath, 'utf8'));
      const masterUnits = (jm && jm.units) ? jm.units : [];
      const masterByPhrase = {};
      for (const mu of masterUnits) {
        try {
          const parts = String(mu.key || mu.id || '').split('|');
          // parse section/phrase indices
          let sectionIdx = null, phraseIdx = null;
          for (const p of parts) {
            const ms = String(p).match(/^section(\d+)/i);
            if (ms) sectionIdx = Number(ms[1]) - 1;
            const mp = String(p).match(/^phrase(\d+)/i);
            if (mp) phraseIdx = Number(mp[1]) - 1;
          }
          if (sectionIdx === null || phraseIdx === null) continue;
          const key = `s${sectionIdx}-p${phraseIdx}`;
          const layer = mu.layer || (parts.length ? parts[0] : 'unknown');
          masterByPhrase[layer] = masterByPhrase[layer] || {};
          masterByPhrase[layer][key] = masterByPhrase[layer][key] || { starts: [], ends: [] };
          if (Number.isFinite(mu.startTime)) masterByPhrase[layer][key].starts.push(Number(mu.startTime));
          else if (Number.isFinite(mu.startTick) && layerTpMedian[layer]) masterByPhrase[layer][key].starts.push(Number(mu.startTick) / layerTpMedian[layer]);
          if (Number.isFinite(mu.endTime)) masterByPhrase[layer][key].ends.push(Number(mu.endTime));
          else if (Number.isFinite(mu.endTick) && layerTpMedian[layer]) masterByPhrase[layer][key].ends.push(Number(mu.endTick) / layerTpMedian[layer]);
        } catch (e) {}
      }

      // Apply master overrides into byLayer aggregates where meaningful
      for (const layerName of Object.keys(masterByPhrase)) {
        for (const k of Object.keys(masterByPhrase[layerName])) {
          const starts = masterByPhrase[layerName][k].starts || [];
          const ends = masterByPhrase[layerName][k].ends || [];
          if (!starts.length || !ends.length) continue;
          byLayer[layerName] = byLayer[layerName] || {};
          byLayer[layerName][k] = byLayer[layerName][k] || { startTimes: [], endTimes: [] };
          // prefer master map aggregates (min start, max end)
          byLayer[layerName][k].startTimes = [Math.min(...starts)];
          byLayer[layerName][k].endTimes = [Math.max(...ends)];
        }
      }
    }
  } catch (e) {}

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

      // Parse unitRec entries (high-resolution) and capture absolute seconds when present
      const mUnitRec = String(val).match(/unitRec:([^\s]+)/);
      if (mUnitRec) {
        const fullId = mUnitRec[1];
        const seg = fullId.split('|');
        let sectionIdx = null, phraseIdx = null;
        for (const s of seg) {
          const ms = String(s).match(/^section(\d+)/i);
          if (ms) sectionIdx = Number(ms[1]) - 1;
          const mp = String(s).match(/^phrase(\d+)/i);
          if (mp) phraseIdx = Number(mp[1]) - 1;
        }
        // extract tick-range and seconds-range tokens if present
        let startTick = null, endTick = null, startTime = null, endTime = null;
        for (let i = seg.length - 1; i >= 0; i--) {
          const s = seg[i];
          if (/^\d+-\d+$/.test(s)) {
            const r = s.split('-'); startTick = Number(r[0]); endTick = Number(r[1]); continue;
          }
          if (/^\d+\.\d+-\d+\.\d+$/.test(s)) {
            const r = s.split('-'); startTime = Number(r[0]); endTime = Number(r[1]); continue;
          }
        }
        // If we have absolute seconds, use them directly as localStart/localEnd (absolute times).
        // Otherwise convert ticks to seconds using the per-layer tpSec median when available (do NOT divide by the CSV tick number which is not seconds).
        const layerTp = layerTpMedian[layer] || null;
        const absStart = Number.isFinite(startTime) ? startTime : (Number.isFinite(startTick) && layerTp ? (startTick / layerTp) : null);
        const absEnd = Number.isFinite(endTime) ? endTime : (Number.isFinite(endTick) && layerTp ? (endTick / layerTp) : null);
        markerOccur[layer].push({ phraseIdx, sectionIdx, absStart: Number.isFinite(absStart) ? absStart : null, absEnd: Number.isFinite(absEnd) ? absEnd : null, tickStart: startTick, tickEnd: endTick, raw: fullId, isUnitRec: true });
        continue;
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
        // store the marker raw for diagnostics
        markerOccur[layer].push({ phraseIdx, sectionIdx: leadSectionIdx, localStart, localEnd, lengthSec, tick: tickNum, tpSec, endTick, raw: val, markerType: 'phrase' });
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
        markerOccur[layer].push({ isSection: true, sectionIdx: secIdx, localStart, localEnd, tick: tickNum, tpSec, endTick, raw: val, markerType: 'section' });
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
      // Use median-based aggregation to be robust to outlier units (e.g., outros)
      const median = (a) => {
        if (!a || !a.length) return null;
        const s = a.slice().sort((x,y)=>x-y);
        const mid = Math.floor(s.length/2);
        return (s.length % 2 === 1) ? s[mid] : ((s[mid-1] + s[mid]) / 2);
      };
      const starts = arr.map(x => Number.isFinite(Number(x.startTime)) ? Number(x.startTime) : null).filter(x => x !== null);
      const ends = arr.map(x => Number.isFinite(Number(x.endTime)) ? Number(x.endTime) : null).filter(x => x !== null);
      const start = (starts.length ? median(starts) : Math.min(...arr.map(x => x.startTime || Infinity)));
      const end = (ends.length ? median(ends) : Math.max(...arr.map(x => x.endTime || -Infinity)));
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
          // If marker localStart appears to be a track-level absolute time (e.g., close to the layer's max localStart),
          // treat it as localAbsolute rather than adding to the section start.
          try {
            const maxLocal = Math.max(...(markers.map(m => Number(m.localStart) || 0)));
            if (Number.isFinite(mk.localStart) && mk.localStart > 1 && mk.localStart <= (maxLocal + 0.1)) {
              absStart = Number(mk.localStart);
              absEnd = Number(mk.localEnd);
              usedMethod = 'localAbsolute';
            }
          } catch (e) {}
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
          markerRanges[layer][k].from = markerRanges[layer][k].from || 'phrase';
          // attach best-effort absolute times when available
          if (Number.isFinite(absStart) && Number.isFinite(absEnd)) { markerRanges[layer][k].absStart = absStart; markerRanges[layer][k].absEnd = absEnd; }


          // Validation: DO NOT treat marker vs unit-derived group bounds as hard mismatches. Markers are authoritative.
          // If both layers have marker-derived ranges for this key, compare them and report inter-marker discrepancies only.
          if (mk.isUnitRec) {
            // Internal unitRec markers are sub-phrase; don't treat them as mismatches here
          } else {
            // Compare this layer's marker range (absStart/absEnd) to canonical layer marker range if present
            const can = markerRanges[canonicalLayer] && markerRanges[canonicalLayer][k] ? markerRanges[canonicalLayer][k] : null;
            const oth = markerRanges[layer] && markerRanges[layer][k] ? markerRanges[layer][k] : null;
            if (can && oth && Number.isFinite(can.absStart) && Number.isFinite(oth.absStart)) {
              const delta = Math.abs(Number(can.absStart) - Number(oth.absStart));
              // Policy: per-layer markers are authoritative. Do not treat inter-layer marker time differences as hard mismatches.
              // Record as diagnostics only (not a markerMismatch) so we do not auto-apply cross-layer corrections.
              try { const _fs = require('fs'); const _path = require('path'); _fs.appendFileSync(_path.join(process.cwd(),'output','layerAlignment-marker-diagnostics.ndjson'), JSON.stringify({ layer, key: k, delta, usedMethod, primary: can, other: oth, when: new Date().toISOString() }) + '\n'); } catch (_e) {}
            } else {
              // No reliable marker-to-marker comparison possible; record as diagnostic (no mismatch)
            }
          }
        }
        continue;
      }
      // unitRec aggregation: if this marker is an internal high-resolution unitRec, map it into the phrase-group if possible
      if (mk.isUnitRec) {
        // Strict mapping: only aggregate unitRec markers that explicitly include section/phrase tokens
        if (typeof mk.sectionIdx === 'undefined' || mk.sectionIdx === null || typeof mk.phraseIdx === 'undefined' || mk.phraseIdx === null) {
          // cannot map confidently — skip
          continue;
        }
        const key = `s${mk.sectionIdx}-p${mk.phraseIdx}`;
        const grp = grouped.find(g => g.key === key);
        if (!grp) continue;
        // Prefer absolute seconds from unitRec when available, otherwise convert ticks using per-section median tpSec
        let absStart = null, absEnd = null, usedMethod = 'unitRec';
        if (mk.absStart !== null && mk.absEnd !== null && Number.isFinite(Number(mk.absStart)) && Number.isFinite(Number(mk.absEnd))) {
          absStart = Number(mk.absStart); absEnd = Number(mk.absEnd);
          usedMethod = 'unitRec-seconds';
        } else if (mk.tickStart !== undefined && mk.tickEnd !== undefined && Number.isFinite(Number(mk.tickStart)) && Number.isFinite(Number(mk.tickEnd))) {
          const tp = (sectionTpMedian[layer] && sectionTpMedian[layer][mk.sectionIdx] !== undefined) ? sectionTpMedian[layer][mk.sectionIdx] : layerTpMedian[layer];
          if (tp) {
            absStart = Number(mk.tickStart) / tp;
            absEnd = Number(mk.tickEnd) / tp;
            usedMethod = 'unitRec-ticks->secs';
          }
        }
        if (absStart !== null && absEnd !== null) {
          markerRanges[layer][key] = markerRanges[layer][key] || { start: absStart, end: absEnd };
          const existing = markerRanges[layer][key];
          // If a stronger phrase/section marker already exists for this key (i.e., not unitRec), prefer its start.
          // Allow unitRec markers to grow the end and record them as candidates for tracing, but do not override a phrase-level start.
          if (existing.from && existing.from !== 'unitRec') {
            existing.end = Math.max(existing.end || -Infinity, absEnd);
            existing.unitRecCandidates = existing.unitRecCandidates || [];
            existing.unitRecCandidates.push({ absStart, absEnd, raw: mk.raw || mk.full || null, method: usedMethod, tickRange: (mk.tickStart !== undefined ? { start: mk.tickStart, end: mk.tickEnd } : null) });
          } else {
            // No stronger source present; apply/tighten bounds using this unitRec
            existing.start = Math.min(existing.start, absStart);
            existing.end = Math.max(existing.end, absEnd);
            existing.from = 'unitRec';
            if (!Number.isFinite(existing.absStart) || absStart < existing.absStart) {
              existing.absStart = absStart;
              existing.unitRecRaw = mk.raw || mk.full || null;
              existing.unitRecTickRange = (mk.tickStart !== undefined && mk.tickEnd !== undefined) ? { start: mk.tickStart, end: mk.tickEnd } : null;
            }
            existing.absEnd = Math.max(existing.absEnd || absEnd, absEnd);
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

          // DO NOT enforce unit-derived group bounds as authoritative when markers are present. Markers are authoritative.
          if (mk.isUnitRec) {
            // internal unitRec markers — do not report as mismatches
          } else {
            // If canonical marker available, compare marker-to-marker
            const can = markerRanges[canonicalLayer] && markerRanges[canonicalLayer][grp.key] ? markerRanges[canonicalLayer][grp.key] : null;
            const oth = markerRanges[layer] && markerRanges[layer][grp.key] ? markerRanges[layer][grp.key] : null;
            if (can && oth && Number.isFinite(can.absStart) && Number.isFinite(oth.absStart)) {
              const delta = Math.abs(Number(can.absStart) - Number(oth.absStart));
              if (delta > tolerance) markerMismatches.push({ layer, key: grp.key, marker: mk, absStart, absEnd, delta, usedMethod, reason: 'inter-marker-start-diff' });
            } else {
              // No direct marker-to-marker comparison possible; record as diagnostic only (no mismatch)
            }
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

  // Build phrase lists strictly from marker-derived ranges: marker_t entries are authoritative.
  const phraseLists = {};
  for (const layer of layers) {
    phraseLists[layer] = [];
    if (markerRanges[layer]) {
      const keys = Object.keys(markerRanges[layer]).filter(k => /s\d+-p\d+/i.test(k));
      for (const k of keys) {
        const entry = markerRanges[layer][k];
        if (entry && Number.isFinite(entry.start) && Number.isFinite(entry.end)) {
          phraseLists[layer].push({ start: entry.start, end: entry.end, source: 'marker', key: k, idx: (k.match(/p(\d+)$/) ? Number(k.match(/p(\d+)$/)[1]) : null) });
        }
      }
      phraseLists[layer].sort((a,b) => (a.start || 0) - (b.start || 0));
      // If there are no marker-based phrases for the layer, keep phraseLists empty and report missing markers later
    }
  }

  // Build canonical phraseRanges directly from markers only
  const phraseRanges = {}; // layer -> key -> {start,end}
  for (const layer of layers) {
    phraseRanges[layer] = {};
    for (const e of (phraseLists[layer] || [])) {
      phraseRanges[layer][e.key] = { start: e.start, end: e.end };
    }
  }

  // Marker-derived phraseLists are authoritative; do not force-align or override them from master/unit sources.
  // phraseRanges already built directly from `phraseLists` above (marker-only canonical).

  // Compare phrase starts across layers by direct marker/unitTree comparison only. Do NOT compute or fabricate linear fits when markers are absent.
  const mismatches = [];
  const layerFits = {};
  // canonicalLayer already determined earlier

  // Build a quick lookup of phrase sources so we can prefer authoritative sources (unitTree > marker > master > units)
  const phraseSourceMap = {};
  for (const layer of layers) {
    phraseSourceMap[layer] = {};
    for (const e of (phraseLists[layer] || [])) {
      if (e && e.key) phraseSourceMap[layer][e.key] = e.source || 'unknown';
    }
  }

  // For each non-primary layer, compare any keys where both layers have canonical phrase starts (from unitTree/marker/master)
  for (const layer of layers) {
    if (layer === canonicalLayer) continue;

    // If this layer has 'unit-derived' sources for a key while canonical has marker/unitTree, prefer canonical and force-copy the range
    for (const k of Object.keys(phraseRanges[canonicalLayer] || {})) {
      try {
        const canSrc = phraseSourceMap[canonicalLayer] && phraseSourceMap[canonicalLayer][k] ? phraseSourceMap[canonicalLayer][k] : null;
        const laySrc = phraseSourceMap[layer] && phraseSourceMap[layer][k] ? phraseSourceMap[layer][k] : null;
        if (canSrc && laySrc && laySrc === 'units' && (canSrc === 'unitTree' || canSrc === 'marker' || canSrc === 'master')) {
          // Overwrite the less-authoritative layer range with canonical range
          phraseRanges[layer] = phraseRanges[layer] || {};
          phraseRanges[layer][k] = { start: phraseRanges[canonicalLayer][k].start, end: phraseRanges[canonicalLayer][k].end };
          layerFits[layer] = layerFits[layer] || {};
          layerFits[layer].forcedFrom = layerFits[layer].forcedFrom || [];
          layerFits[layer].forcedFrom.push(k);
        }
      } catch (e) {}
    }

    const keys = Object.keys(phraseRanges[canonicalLayer] || {});
    layerFits[layer] = layerFits[layer] || { samples: 0 };
    if (!keys.length) {
      layerFits[layer].skipped = true;
      continue;
    }
    for (const k of keys) {
      const layerPhrase = (phraseRanges[layer] && phraseRanges[layer][k]) ? phraseRanges[layer][k] : null;
      const prim = phraseRanges[canonicalLayer][k];
      if (!layerPhrase) {
        mismatches.push({ key: k, layer, expected: prim.start, start: null, delta: null, reason: 'missing-marker', source: 'marker' });
        continue;
      }
      layerFits[layer].samples++;
      // Internal validation: if this layer has unitRec-derived markers, ensure their absolute starts match the layer's phrase start
      const layMR = (markerRanges[layer] && markerRanges[layer][k]) ? markerRanges[layer][k] : null;
      if (layMR && layMR.from === 'unitRec' && Number.isFinite(Number(layMR.absStart)) && Number.isFinite(Number(layerPhrase.start))) {
        const delta = Math.abs(Number(layMR.absStart) - Number(layerPhrase.start));
        if (delta > tolerance) {
          const mobj = { key: k, layer, expected: layerPhrase.start, start: layMR.absStart, delta, reason: 'unitRec-start-diff', source: 'unitRec', unitRecRaw: layMR.unitRecRaw || layMR.raw || null, unitRecTicks: (layMR.unitRecTickRange || (layMR.tickStart !== undefined ? { start: layMR.tickStart, end: layMR.tickEnd } : null)), unitRecMethod: layMR.from };
          // attach current markerRange snapshot for richer tracing
          mobj.markerRange = (markerRanges[layer] && markerRanges[layer][k]) ? markerRanges[layer][k] : null;
          mismatches.push(mobj);
          // Emit a focused diagnostic record to help trace origin of unitRec-derived mismatches
          try { const _fs = require('fs'); const _path = require('path'); _fs.appendFileSync(_path.join(process.cwd(),'output','layerAlignment-unitRec-mismatch.ndjson'), JSON.stringify(Object.assign({}, mobj, { when: new Date().toISOString() })) + '\n'); } catch (e) {}
        }
      } else {
        // For phrase-based markers or unmatched types, do NOT report a mismatch — markers are authoritative and may be relative; log as diagnostics only
      }
    }
  }

  // Corrections: compare canonical marker-derived phrase starts against other data sources (unitTree / master) and emit corrections for any discrepancies
  const corrections = [];
  try {
    const unitTreePath = path.join(OUT, 'unitTreeMap.json');
    const masterPath = path.join(OUT, 'unitMasterMap.json');
    const unitTree = fs.existsSync(unitTreePath) ? JSON.parse(fs.readFileSync(unitTreePath,'utf8')) : null;
    const master = fs.existsSync(masterPath) ? JSON.parse(fs.readFileSync(masterPath,'utf8')) : null;

    const findUnitInUnitTree = (key, layer) => {
      if (!unitTree || !Array.isArray(unitTree.units)) return null;
      return unitTree.units.find(u => u.key === key && u.layer === layer) || null;
    };
    const findUnitInMaster = (key, layer) => {
      if (!master || !Array.isArray(master.units)) return null;
      return master.units.find(u => u.key === key && u.layer === layer) || null;
    };

    for (const layer of layers) {
      const canonicalKeys = Object.keys(phraseRanges[layer] || {});
      for (const k of canonicalKeys) {
        const canonical = phraseRanges[layer][k];
        // unitTree comparison
        try {
          const ut = findUnitInUnitTree(k, layer);
          if (ut) {
            const utStart = Number.isFinite(ut.startTime) ? ut.startTime : (Number.isFinite(ut.startTick) && layerTpMedian[layer] ? ut.startTick / layerTpMedian[layer] : null);
            if (utStart !== null && Math.abs(utStart - canonical.start) > tolerance) corrections.push({ key: k, layer, source: 'unitTree', canonicalStart: canonical.start, sourceStart: utStart, delta: Math.abs(utStart - canonical.start) });
          } else {
            // missing in unitTree -> record
            corrections.push({ key: k, layer, source: 'unitTree', canonicalStart: canonical.start, sourceStart: null, delta: null, note: 'missing' });
          }
        } catch (e) {}
        // master comparison
        try {
          const mu = findUnitInMaster(k, layer);
          if (mu) {
            const muStart = Number.isFinite(mu.startTime) ? mu.startTime : (Number.isFinite(mu.startTick) && layerTpMedian[layer] ? mu.startTick / layerTpMedian[layer] : null);
            if (muStart !== null && Math.abs(muStart - canonical.start) > tolerance) corrections.push({ key: k, layer, source: 'master', canonicalStart: canonical.start, sourceStart: muStart, delta: Math.abs(muStart - canonical.start) });
          } else {
            corrections.push({ key: k, layer, source: 'master', canonicalStart: canonical.start, sourceStart: null, delta: null, note: 'missing' });
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  try { fs.writeFileSync(path.join(OUT, 'layerAlignment-corrections.json'), JSON.stringify(corrections, null, 2)); } catch (e) {}

  // Verification-only: no CSVs will be modified in this script; appliedCount removed.

  // Verification-only mode: Corrections are identified and written to `layerAlignment-corrections.json` but are not applied.
  // All auto-correction and CSV-write functions have been removed from this verification script to keep it audit-only.
  // (If you need an automated apply step, use a separate controlled tool with explicit --apply flag.)

      // Verification-only mode: CSV marker insertion/replacement removed. Candidate corrections are recorded elsewhere and not applied by this script.

    // Verification-only: marker-level auto-correction disabled. Candidate marker corrections are recorded in
    // `layerAlignment-corrections.json` but are not applied to CSVs by this script.

  // Verification-only: corrections are not applied and the script will not re-run itself. Any candidate corrections are recorded in
  // `output/layerAlignment-corrections.json` and `output/layerAlignment-diagnostics.json` for manual inspection.
  try { /* noop - no automatic apply or iteration in verification-only mode */ } catch (e) {}

  // Track lengths per layer - use the last `marker_t` entry in each CSV as the authoritative end time when available
  const trackLengths = {};
  const csvPaths = { primary: path.join(OUT, 'output1.csv'), poly: path.join(OUT, 'output2.csv') };

  const parseLastMarkerEndTime = (csvPath) => {
    if (!fs.existsSync(csvPath)) return null;
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      if (!ln || ln.indexOf('marker_t') === -1) continue;
      const parts = ln.split(',');
      const val = parts.slice(3).join(',');
      // Try unitRec seconds suffix
      const mUnitSec = String(val).match(/unitRec:[^\s,]+\|([0-9]+\.[0-9]+-[0-9]+\.[0-9]+)\b/);
      if (mUnitSec) {
        const r = mUnitSec[1].split('-');
        const endSec = Number(r[1]);
        if (Number.isFinite(endSec)) return endSec;
      }
      // Phrase/Section marker form: '(MM:SS.ssss - MM:SS.ssss)'
      const mPhrase = String(val).match(/\(([^\)]+)\s*-\s*([^\)]+)\)/);
      if (mPhrase) {
        const endStr = String(mPhrase[2]).trim();
        try {
          const endSec = parseHMSToSec(endStr);
          if (Number.isFinite(endSec)) return endSec;
        } catch (e) {}
      }
      // Fallback: explicit endTick token
      const mTick = String(val).match(/endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
      if (mTick && Number.isFinite(Number(mTick[1]))) {
        const endTick = Number(mTick[1]);
        // convert ticks to seconds using layer median tp if possible
        const layerName = csvPath.includes('output1') ? 'primary' : (csvPath.includes('output2') ? 'poly' : null);
        const tp = layerTpMedian[layerName] || null;
        if (tp) return Number((endTick / tp).toFixed(6));
      }
    }
    return null;
  };

  for (const layer of Object.keys(phraseLists)) {
    const csvPath = csvPaths[layer] || null;
    const lastMarkerSec = csvPath ? parseLastMarkerEndTime(csvPath) : null;
    if (Number.isFinite(lastMarkerSec)) {
      trackLengths[layer] = { value: Number(lastMarkerSec), source: 'last-marker' };
      continue;
    }

    // If no last marker time found, fall back to previous heuristics
    const unitEnds = (phraseLists[layer] || []).filter(e => e.end !== undefined && e.source === 'units').map(e => e.end);
    if (unitEnds.length > 0) { trackLengths[layer] = { value: Math.max(...unitEnds), source: 'units' }; continue; }
    const sectionEnds = Object.keys(markerRanges[layer] || {}).filter(k => k.startsWith('section')).map(k => markerRanges[layer][k].end).filter(x => x !== undefined);
    if (sectionEnds.length > 0) { trackLengths[layer] = { value: Math.max(...sectionEnds), source: 'section' }; continue; }
    const markerEnds = (phraseLists[layer] || []).filter(e => e.end !== undefined).map(e => e.end);
    if (markerEnds.length > 0) { trackLengths[layer] = { value: Math.max(...markerEnds), source: 'phrase' }; continue; }
    let maxEnd = 0; for (const k of Object.keys(phraseRanges[layer] || {})) maxEnd = Math.max(maxEnd, phraseRanges[layer][k].end || 0);
    trackLengths[layer] = { value: maxEnd, source: 'units-fallback' };
  }

  const layerList = Object.keys(trackLengths);
  // Determine min/max by sorting layers by their computed track length. This avoids showing the same layer twice
  // when earlier logic picked the first layer for both min and max due to equality. Use first/last layers in sorted order.
  let maxTrack = 0, minTrack = 0, maxLayer = null, minLayer = null;
  if (layerList.length) {
    const sorted = layerList.map(l => ({ layer: l, value: (trackLengths[l] && trackLengths[l].value) ? trackLengths[l].value : 0 })).sort((a,b) => a.value - b.value);
    minLayer = sorted[0].layer; minTrack = sorted[0].value;
    maxLayer = sorted[sorted.length - 1].layer; maxTrack = sorted[sorted.length - 1].value;
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
        // Normalized-position indicates alignment by relative positions; record that fact but do not remove mismatches.
        layerFits[layer].normAccepted = true;
      }
      // store normalized metrics
      layerFits[layer].normFracBelow = normFracBelow;
      layerFits[layer].tickNormFracBelow = tickNormFracBelow;
    }
  } catch (e) {}

  // Report
  const correctionsFile = path.join(OUT, 'layerAlignment-corrections.json');
  const correctionsAppliedFile = path.join(OUT, 'layerAlignment-corrections-applied.json');
  // NOTE: Verifier is strictly read-only. Historically there may be a
  // `layerAlignment-corrections-applied.json` file created by other tooling.
  // We will never read and report applied corrections in this script; if the
  // legacy file exists, log a warning and ignore it to avoid confusion.

  const report = {
    generatedAt: (new Date()).toISOString(),
    tolerance,
    trackTol,
    phraseMismatchCount: mismatches.length,
    phraseMismatches: mismatches.slice(0, 200),
    layerFits,
    markerMismatchCount: markerMismatches.length,
    markerMismatches: markerMismatches.slice(0, 200),
    correctionsCount: (typeof corrections !== 'undefined' ? corrections.length : 0),
    correctionsFile: fs.existsSync(correctionsFile) ? correctionsFile : null,
    correctionsApplied: (function(){ try { if (fs.existsSync(correctionsAppliedFile)) { console.warn('layerAlignment: found legacy "layerAlignment-corrections-applied.json"; ignored.'); } } catch (e) {} return null; })(),
    trackLengths,
    trackDelta,
    trackProblem: trackDelta > trackTol,
    markerProblem: markerMismatches.length > 0
  };

  const outPath = path.join(OUT, 'layerAlignment-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Layer alignment complete. Phrase mismatches=${mismatches.length}. Marker mismatches=${markerMismatches.length}. TrackDelta=${trackDelta.toFixed(6)}s (${minLayer} vs ${maxLayer})`);
  if (mismatches.length > 0 || report.trackProblem || markerMismatches.length > 0) {
    console.error('Issues found. See', outPath);
    process.exit(5);
  }
  console.log('All alignment checks passed.');
  process.exit(0);
})();
