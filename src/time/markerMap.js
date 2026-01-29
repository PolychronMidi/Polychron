const fs = require('fs');
const path = require('path');
const { writeDebugFile } = require('../logGate');
const TEST = require('../test-hooks');

/**
 * Return CSV path for a layer name.
 * @param {string} layerName
 */
const _csvPathForLayer = (layerName) => {
  if (layerName === 'primary') return path.join(process.cwd(), 'output', 'output1.csv');
  if (layerName === 'poly') return path.join(process.cwd(), 'output', 'output2.csv');
  return path.join(process.cwd(), 'output', `output${layerName}.csv`);
};

const _markerCache = {}; // layerName -> { mtime, map }

/**
 * Load marker map from a CSV buffer file for the given layer.
 * Returns a map: key -> { startSec, endSec, tickStart, tickEnd, raw }
 */
const loadMarkerMapForLayer = (layerName) => {
  const p = _csvPathForLayer(layerName);
  try {
    const stat = fs.existsSync(p) ? fs.statSync(p) : null;
    const mtime = stat ? stat.mtimeMs : null;
    const cacheEntry = _markerCache[layerName];
    if (cacheEntry && cacheEntry.mtime === mtime && cacheEntry.map) return cacheEntry.map;
    const map = {};
    if (!fs.existsSync(p)) { _markerCache[layerName] = { mtime, map: {} }; return map; }
    const txt = fs.readFileSync(p, 'utf8');
    const lines = txt.split(new RegExp('\\r?\\n'));
    for (const ln of lines) {
      if (!ln || !ln.startsWith('1,')) continue;
      const partsLine = ln.split(','); if (partsLine.length < 4) continue;
      const tkn = partsLine[2]; if (String(tkn).toLowerCase() !== 'marker_t') continue;
      const val = partsLine.slice(3).join(',');
      const m = String(val).match(/unitRec:([^\s,]+)/);
      if (!m) continue;
      const full = m[1];
      const seg = full.split('|');
      let sStart = null, sEnd = null, tickStart = null, tickEnd = null;
      for (let i = seg.length - 1; i >= 0; i--) {
        const s = seg[i];
        if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { const r = s.split('-'); sStart = Number(r[0]); sEnd = Number(r[1]); continue; }
        if (/^\d+-\d+$/.test(s)) { const r = s.split('-'); tickStart = Number(r[0]); tickEnd = Number(r[1]); continue; }
      }
      let baseSeg = seg.slice();
      while (baseSeg.length && (/^\d+\.\d+-\d+\.\d+$/.test(baseSeg[baseSeg.length-1]) || /^\d+-\d+$/.test(baseSeg[baseSeg.length-1]))) baseSeg.pop();
      const key = baseSeg.join('|');
      if (sStart !== null && sEnd !== null) {
        if (!map[key] || (map[key] && (sStart < map[key].startSec))) map[key] = { startSec: sStart, endSec: sEnd, tickStart, tickEnd, raw: full };
      } else if (tickStart !== null && tickEnd !== null) {
        if (!map[key] || (!map[key].startSec && tickStart < (map[key].tickStart || Infinity))) map[key] = { startSec: null, endSec: null, tickStart, tickEnd, raw: full };
      }
    }
    _markerCache[layerName] = { mtime, map };
    if (TEST) {
      TEST._markerCache = TEST._markerCache || {};
      TEST._markerCache[layerName] = { mtime, keys: Object.keys(map) };
    }
    return map;
  } catch (e) {
    _markerCache[layerName] = { mtime: null, map: {} };
    return {};
  }
};

/**
 * Find marker seconds or tick bounds for a parts array in the layer's marker map.
 */
const findMarkerSecs = (layerName, partsArr) => {
  const map = loadMarkerMapForLayer(layerName);
  try { writeDebugFile('time-debug.ndjson', { tag: 'markerMap-keys', layerName, keys: Object.keys(map).slice(0,20) }); } catch (_e) { /* swallow */ }
  if (!map) return null;
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && Number.isFinite(map[k].startSec)) return map[k];
    const kNorm = partsArr.slice(0, len).map(p => String(p).replace(/\/1$/, '')).join('|');
    if (kNorm !== k && map[kNorm] && Number.isFinite(map[kNorm].startSec)) return map[kNorm];
  }
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && (Number.isFinite(map[k].tickStart) && Number.isFinite(map[k].tickEnd))) return map[k];
    const kNorm = partsArr.slice(0, len).map(p => String(p).replace(/\/\d+$/, '')).join('|');
    if (kNorm !== k && map[kNorm] && (Number.isFinite(map[kNorm].tickStart) && Number.isFinite(map[kNorm].tickEnd))) return map[kNorm];
  }
  return null;
};

const clearMarkerCache = (layerName) => { try { delete _markerCache[layerName]; } catch (e) { /* swallow */ } };

try { if (TEST) { TEST.loadMarkerMapForLayer = loadMarkerMapForLayer; TEST.findMarkerSecs = findMarkerSecs; TEST.clearMarkerCache = clearMarkerCache; } } catch (e) { /* swallow */ }

module.exports = { _csvPathForLayer, loadMarkerMapForLayer, findMarkerSecs, clearMarkerCache };
