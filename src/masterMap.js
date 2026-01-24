// masterMap.js - live master unit map builder (incremental)
const path = require('path');
const getFs = () => (typeof globalThis !== 'undefined' && globalThis.fs) ? globalThis.fs : require('fs');

const OUT_DIR = path.join(process.cwd(), 'output');
const NDJSON_PATH = path.join(OUT_DIR, 'unitMasterMap.ndjson');
const ATOMIC_JSON_PATH = path.join(OUT_DIR, 'unitMasterMap.json');
const ATOMIC_TMP = ATOMIC_JSON_PATH + '.tmp';

const agg = new Map();
let ndjsonStream = null;
let flushed = false;

function ensureOutDir() {
  const _fs = getFs(); if (!_fs.existsSync(OUT_DIR)) _fs.mkdirSync(OUT_DIR, { recursive: true });
}

function openNdjson() {
  if (ndjsonStream) return;
  try {
    ensureOutDir();
    ndjsonStream = getFs().createWriteStream(NDJSON_PATH, { flags: 'a' });
  } catch (e) {
    // best-effort
    ndjsonStream = null;
  }
}

function addUnit(u) {
  try {
    // u: { parts: Array, layer, startTick, endTick, startTime, endTime, raw }
    const parts = Array.isArray(u.parts) ? u.parts : (typeof u.parts === 'string' ? String(u.parts).split('|') : []);
    const key = parts.join('|');
    const startTick = Number(u.startTick || u.start || 0);
    const endTick = Number(u.endTick || u.end || 0);
    const startTime = (typeof u.startTime === 'number') ? u.startTime : (Number.isFinite(u.startTime) ? Number(u.startTime) : null);
    const endTime = (typeof u.endTime === 'number') ? u.endTime : (Number.isFinite(u.endTime) ? Number(u.endTime) : null);

    if (!agg.has(key)) {
      agg.set(key, {
        key,
        layer: u.layer,
        minStart: Number.isFinite(startTick) ? startTick : Infinity,
        maxEnd: Number.isFinite(endTick) ? endTick : -Infinity,
        minStartTime: Number.isFinite(startTime) ? startTime : Infinity,
        maxEndTime: Number.isFinite(endTime) ? endTime : -Infinity,
        examples: [{ start: startTick, end: endTick, startTime, endTime, raw: u.raw }],
        count: 1
      });
    } else {
      const existing = agg.get(key);
      existing.minStart = Math.min(existing.minStart, Number.isFinite(startTick) ? startTick : existing.minStart);
      existing.maxEnd = Math.max(existing.maxEnd, Number.isFinite(endTick) ? endTick : existing.maxEnd);
      if (Number.isFinite(startTime)) existing.minStartTime = Math.min(existing.minStartTime, startTime);
      if (Number.isFinite(endTime)) existing.maxEndTime = Math.max(existing.maxEndTime, endTime);
      existing.count = (existing.count || 0) + 1;
      if (existing.examples.length < 5) existing.examples.push({ start: startTick, end: endTick, startTime, endTime, raw: u.raw });
    }

    // Write raw emission to NDJSON for offline replay/triage
    try {
      openNdjson();
      const line = JSON.stringify({ when: new Date().toISOString(), parts, layer: u.layer, startTick, endTick, startTime, endTime, raw: u.raw }) + '\n';
      if (ndjsonStream && ndjsonStream.write) {
        ndjsonStream.write(line);
      } else if (typeof getFs().appendFileSync === 'function') {
        getFs().appendFileSync(NDJSON_PATH, line);
      } // else skip writing in test/mocked environments
    } catch (e) {
      // ignore
    }

    // Expose live master map on LM if present
    try {
      if (typeof LM !== 'undefined') {
        LM.masterMap = LM.masterMap || {};
        LM.masterMap._agg = agg; // expose internal map (not serialized)
      }
    } catch (e) {}

  } catch (e) {
    // swallow errors to avoid breaking time-critical code
  }
}

function getCanonical() {
  const out = [];
  for (const [k, v] of agg.entries()) {
    const canonicalStart = Number.isFinite(v.minStart) ? Math.round(v.minStart) : null;
    const canonicalEnd = Number.isFinite(v.maxEnd) ? Math.round(v.maxEnd) : null;
    const canonicalStartTime = Number.isFinite(v.minStartTime) && v.minStartTime !== Infinity ? v.minStartTime : null;
    const canonicalEndTime = Number.isFinite(v.maxEndTime) && v.maxEndTime !== -Infinity ? v.maxEndTime : null;
    out.push({ key: k, layer: v.layer, startTick: canonicalStart, endTick: canonicalEnd, startTime: canonicalStartTime, endTime: canonicalEndTime, count: v.count });
  }
  return out;
}

function finalize() {
  try {
    if (flushed) return;
    flushed = true;
    ensureOutDir();
    const canonical = getCanonical();
    const payload = { generated: new Date().toISOString(), version: 1, units: canonical, stats: { units: canonical.length } };
    // Write atomically: .tmp then rename
    getFs().writeFileSync(ATOMIC_TMP, JSON.stringify(payload, null, 2));
    try { getFs().renameSync(ATOMIC_TMP, ATOMIC_JSON_PATH); } catch (e) { /* fallback */ getFs().writeFileSync(ATOMIC_JSON_PATH, JSON.stringify(payload, null, 2)); }
    // also close ndjson stream
    try { if (ndjsonStream && ndjsonStream.end) ndjsonStream.end(); } catch (e) {}

    // Expose canonical map on LM
    try { if (typeof LM !== 'undefined') LM.masterMap = LM.masterMap || {}; LM.masterMap.canonical = canonical; } catch (e) {}
  } catch (e) {
    // swallow
  }
}

function reset() {
  // Test helper: clear internal aggregation and reopen streams
  try { agg.clear(); } catch (e) {}
  flushed = false;
  try { if (ndjsonStream && ndjsonStream.end) ndjsonStream.end(); ndjsonStream = null; } catch (e) {}
}

module.exports = { addUnit, finalize, getCanonical, reset };
