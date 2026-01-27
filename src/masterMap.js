// masterMap.js - live master unit map builder (incremental)
const path = require('path');
const getFs = () => (typeof fs !== 'undefined') ? fs : require('fs');
const { writeDebugFile, writeDetectedOverlap } = require('./logGate');

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
    const _perfStart = process.hrtime.bigint();
    // u: { parts: Array, layer, startTick, endTick, startTime, endTime, raw }
    const parts = Array.isArray(u.parts) ? u.parts : (typeof u.parts === 'string' ? String(u.parts).split('|') : []);
    const key = parts.join('|');
    const startTick = Number(u.startTick || u.start || 0);
    const endTick = Number(u.endTick || u.end || 0);
    const startTime = (typeof u.startTime === 'number') ? u.startTime : (Number.isFinite(u.startTime) ? Number(u.startTime) : null);
    const endTime = (typeof u.endTime === 'number') ? u.endTime : (Number.isFinite(u.endTime) ? Number(u.endTime) : null);

    // Heuristic diagnostics to catch weird emissions (e.g., zero start for later measures, excessively large spans)
    try {
      const _fs = require('fs'); const _path = require('path');
      if (startTick === 0 && /measure\d+\/.+/.test(key) && !/measure1\//.test(key)) {
        try { writeDebugFile('masterMap-weird-emissions.ndjson', { when: new Date().toISOString(), reason: 'zero-start-with-non-first-measure', key, startTick, endTick, parts, raw: u.raw }); } catch (e) { /* swallow */ }
      }
      if (Number.isFinite(startTick) && Number.isFinite(endTick) && (endTick - startTick) > 100000) {
        try { writeDebugFile('masterMap-weird-emissions.ndjson', { when: new Date().toISOString(), reason: 'very-long-duration', key, startTick, endTick, duration: endTick - startTick, parts, raw: u.raw }); } catch (e) { /* swallow */ }
      }
    } catch (e) { /* swallow */ }

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
      if (ndjsonStream && typeof ndjsonStream.write === 'function' && !ndjsonStream.writableEnded && !ndjsonStream.destroyed) {
        ndjsonStream.write(line);
      } else if (typeof getFs().appendFileSync === 'function') {
        getFs().appendFileSync(NDJSON_PATH, line);
      } // else skip writing in test/mocked environments
    } catch (e) {
      // ignore
    }

    // Temporary overlap detector (guarded by env vars) — used to capture deterministic repro info
    try {
      if (process.env.ENABLE_OVERLAP_DETECT === '1') {
        const targetPrefix = process.env.TARGET_PARENT || null;
        const partsJoined = parts.join('|');
        if (!targetPrefix || partsJoined.startsWith(targetPrefix)) {
          for (const [otherKey, otherVal] of agg.entries()) {
            if (otherKey === key) continue;
            const otherStart = Number.isFinite(otherVal.minStart) ? otherVal.minStart : (otherVal.examples && otherVal.examples.length ? otherVal.examples[0].start : null);
            const otherEnd = Number.isFinite(otherVal.maxEnd) ? otherVal.maxEnd : (otherVal.examples && otherVal.examples.length ? otherVal.examples[0].end : null);
            if (Number.isFinite(otherStart) && Number.isFinite(otherEnd) && Number.isFinite(startTick) && Number.isFinite(endTick)) {
              if (startTick < otherEnd && otherStart < endTick) {
                try {
                  const _fs = require('fs'); const _path = require('path');
                  const payload = { when: new Date().toISOString(), detectedFor: targetPrefix || '<any>', key, parts, startTick, endTick, conflictingKey: otherKey, otherStart, otherEnd, stack: (new Error()).stack };
                  try { writeDetectedOverlap(payload, null); } catch (e) { /* swallow */ }

                  // Verbose trace: include composer cache snapshot (if available) and recent index-traces for richer context
                  try {
                    const verbose = Object.assign({}, payload);                    try {
                      const layerName = (u && u.layer) ? u.layer : null;
                      if (layerName && typeof LM !== 'undefined' && LM.layers && LM.layers[layerName] && LM.layers[layerName].state) {
                        verbose.composerCache = LM.layers[layerName].state._composerCache || null;
                      } else {
                        verbose.composerCache = null;
                      }
                    } catch (_e) { verbose.composerCache = null; }

                    // Attach last 40 lines of index-traces.ndjson for context (if present)
                    try {
                      const itPath = _path.join(process.cwd(), 'output', 'index-traces.ndjson');
                      if (_fs.existsSync(itPath)) {
                        const txt = String(_fs.readFileSync(itPath, 'utf8') || '');
                        const lines = txt.trim().split(new RegExp('\\r?\\n')).filter(Boolean);
                        verbose.recentIndexTraces = lines.slice(Math.max(0, lines.length - 40));
                      } else {
                        verbose.recentIndexTraces = null;
                      }
                    } catch (_e) { verbose.recentIndexTraces = null; }

                    try { writeDebugFile('detected-overlap-verbose.ndjson', verbose); } catch (_e) { /* swallow */ }
                  } catch (_e) { /* swallow */ }

                } catch (e) { /* swallow */ }
                if (process.env.OVERLAP_FAIL_FAST === '1') {
                  throw new Error('Overlap detected between ' + key + ' and ' + otherKey);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // If fail-fast triggered, let it bubble up
      if (process.env.OVERLAP_FAIL_FAST === '1') throw e;
    }

    // Expose live master map on LM if present
    try {
      if (typeof LM !== 'undefined') {
        LM.masterMap = LM.masterMap || {};
        LM.masterMap._agg = agg; // expose internal map (not serialized)
      }
    } catch (e) { /* swallow */ }

    try {
      const _durMs = Number(process.hrtime.bigint() - _perfStart) / 1e6;
      if (_durMs > 5) {
        try { writeDebugFile('perf-addUnit.ndjson', { when: new Date().toISOString(), key, durationMs: _durMs }, 'perf'); } catch (e) { /* swallow */ }
      }
    } catch (e) { /* swallow */ }

  } catch (e) {
    // swallow errors to avoid breaking time-critical code
  }
}

function getCanonical() {
  const out = [];
  for (const [k, v] of agg.entries()) {
    // Prefer non-zero example-derived starts/ends where available to avoid spurious 0-starts or wide max ranges
    const exStarts = (v.examples || []).map(x => Number.isFinite(Number(x.start)) ? Math.round(Number(x.start)) : null).filter(n => Number.isFinite(n));
    const exEnds = (v.examples || []).map(x => Number.isFinite(Number(x.end)) ? Math.round(Number(x.end)) : null).filter(n => Number.isFinite(n));
    let canonicalStart = null;
    let canonicalEnd = null;
    if (exStarts.length) {
      // prefer smallest positive start if present, else smallest start
      const pos = exStarts.filter(s => s > 0);
      canonicalStart = pos.length ? Math.min(...pos) : Math.min(...exStarts);
    } else if (Number.isFinite(v.minStart)) {
      canonicalStart = Math.round(v.minStart);
    }
    if (exEnds.length) {
      // prefer smallest end that is >= canonicalStart when possible to avoid spanning gaps
      if (canonicalStart !== null) {
        const valid = exEnds.filter(e => e >= canonicalStart);
        canonicalEnd = valid.length ? Math.max(...valid) : Math.max(...exEnds);
      } else {
        canonicalEnd = Math.max(...exEnds);
      }
    } else if (Number.isFinite(v.maxEnd)) {
      canonicalEnd = Math.round(v.maxEnd);
    }

    const canonicalStartTime = Number.isFinite(v.minStartTime) && v.minStartTime !== Infinity ? v.minStartTime : null;
    const canonicalEndTime = Number.isFinite(v.maxEndTime) && v.maxEndTime !== -Infinity ? v.maxEndTime : null;
    out.push({ key: k, layer: v.layer, startTick: canonicalStart, endTick: canonicalEnd, startTime: canonicalStartTime, endTime: canonicalEndTime, count: v.count, examples: v.examples || [] });
  }

  // Overlap trimming removed — prefer to surface overlaps for source fixes
  // (previously performed trimming/fixes here were removed to keep master map faithful to emissions)
  // DO NOT RESTORE THIS FEATURE, IT IS AN EXAMPLE OF ANTI-PATTERN.


  return out;
}

function finalize() {
  try {
    if (flushed) return;
    flushed = true;
    ensureOutDir();
    const canonical = getCanonical();
    // Historically this file was an array of canonical units; maintain that shape for tests that expect iterable root.
    const payloadArray = canonical;
    // also write a small companion meta file for diagnostic stats, preserving previous object shape if needed
    const meta = { generated: new Date().toISOString(), version: 3, stats: { units: canonical.length } };
    // Write atomically: .tmp then rename (array payload)
    getFs().writeFileSync(ATOMIC_TMP, JSON.stringify(payloadArray, null, 2));
    try { getFs().renameSync(ATOMIC_TMP, ATOMIC_JSON_PATH); } catch (e) { /* fallback */ getFs().writeFileSync(ATOMIC_JSON_PATH, JSON.stringify(payloadArray, null, 2)); }
    try { getFs().writeFileSync(path.join(OUT_DIR, 'unitMasterMap.meta.json'), JSON.stringify(meta, null, 2)); } catch (e) { /* swallow */ }
    // also close ndjson stream
    try { if (ndjsonStream && ndjsonStream.end) ndjsonStream.end(); } catch (e) { /* swallow */ }

    // Expose canonical map on LM
    try { if (typeof LM !== 'undefined') LM.masterMap = LM.masterMap || {}; LM.masterMap.canonical = canonical; } catch (e) { /* swallow */ }
  } catch (e) {
    // swallow
  }
}

function reset() {
  // Test helper: clear internal aggregation and reopen streams
  try { agg.clear(); } catch (e) { /* swallow */ }
  flushed = false;
  try { if (ndjsonStream && ndjsonStream.end) ndjsonStream.end(); ndjsonStream = null; } catch (e) { /* swallow */ }
}

module.exports = { addUnit, finalize, getCanonical, reset };
