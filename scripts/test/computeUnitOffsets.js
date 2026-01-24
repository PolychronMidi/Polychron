#!/usr/bin/env node
// computeUnitOffsets.js
// Compute per-layer median offset vs primary for unit starts on matching phrase keys

const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const UNITS = path.join(OUT, 'units.json');

if (!fs.existsSync(UNITS)) { console.error('units.json missing. Run npm run play.'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
const units = manifest.units || [];

// Build map: layer -> key -> {startTimes: []}
const byLayerKey = {};
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
    byLayerKey[u.layer] = byLayerKey[u.layer] || {};
    byLayerKey[u.layer][key] = byLayerKey[u.layer][key] || [];
    byLayerKey[u.layer][key].push(Number(u.startTime || 0));
  } catch (e) {}
}

const layers = Object.keys(byLayerKey);
if (!layers.includes('primary')) {
  console.warn('No primary layer found. Offsets computed relative to first layer.');
}
const primary = layers.includes('primary') ? 'primary' : layers[0];

// Collect matching keys present in primary and other layers
const keys = Object.keys(byLayerKey[primary] || {});
const offsets = {}; // layer -> [deltas]
for (const l of layers) {
  if (l === primary) continue;
  offsets[l] = [];
  for (const k of keys) {
    if (!byLayerKey[l] || !byLayerKey[l][k]) continue;
    // compare median of starts per key
    const primArr = byLayerKey[primary][k] || [];
    const layArr = byLayerKey[l][k] || [];
    if (!primArr.length || !layArr.length) continue;
    const prim = primArr.reduce((a,b)=>a+b,0)/primArr.length;
    const lay = layArr.reduce((a,b)=>a+b,0)/layArr.length;
    offsets[l].push(prim - lay);
  }
}

const median = arr => { if (!arr || arr.length===0) return null; const a = arr.slice().sort((x,y)=>x-y); const m = Math.floor(a.length/2); return (a.length%2===1)?a[m]:((a[m-1]+a[m])/2); };
const summary = { generatedAt: (new Date()).toISOString(), primary, perLayer: {} };
for (const l of Object.keys(offsets)) {
  summary.perLayer[l] = { count: offsets[l].length, medianOffset: median(offsets[l]), offsetsSample: offsets[l].slice(0,20) };
}

const out = path.join(OUT, 'unitOffsets.json');
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log('Wrote', out);
process.exit(0);
