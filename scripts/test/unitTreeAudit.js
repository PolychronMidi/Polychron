const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');

console.log('Starting unitTreeAudit.js ...');

// Read units from CSV marker_t records. Prefer human-readable 'Phrase/Measure/Beat ... endTick: N' markers to reconstruct reliable start/end boundaries; fall back to internal 'unitRec:<fullId>' markers when present.
function readUnitsFromCsv() {
  if (!fs.existsSync(OUT)) return [];
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT, f));
  const units = [];

  for (const f of files) {
    const fname = path.basename(f).toLowerCase();
    const layer = fname.includes('output1') ? 'primary' : fname.includes('output2') ? 'poly' : 'unknown';
    const txt = fs.readFileSync(f, 'utf8');
    const lines = txt.split(/\r?\n/);

    // Collect explicit endTick markers by type so we can derive starts deterministically
    const phraseEnds = [];
    const measureEnds = [];
    const beatEnds = [];

    // Keep unitRec entries to use as a fallback / higher-resolution mapping
    const unitRecEntries = [];

    for (const ln of lines) {
      if (!ln || !ln.startsWith('1,')) continue;
      const parts = ln.split(',');
      if (parts.length < 3) continue;

      // In some cases writers embed unit ids into the tick field like: "569798|layer1outro|135014-569798"
      // Extract inline unitRec info when present so we don't miss units used only inline in events.
      try {
        const tickField = String(parts[1] || '');
        if (tickField.includes('|')) {
          const after = tickField.split('|').slice(1).join('|');
          const seg = after.split('|');
          const last = seg[seg.length - 1] || '';
          if (last && last.includes('-')) {
            const r = last.split('-');
            const startTick = Number(r[0] || 0);
            const endTick = Number(r[1] || 0);
            if (Number.isFinite(startTick) && Number.isFinite(endTick)) {
              unitRecEntries.push({ unitId: after, layer, startTick, endTick, startTime: null, endTime: null, raw: `inline:${ln}` });
            }
          }
        }
      } catch (e) { /* swallow */ }

      const val = parts.slice(3).join(',');

      // unitRec entries (legacy internal markers)
      const mUnit = String(val).match(/unitRec:([^\s]+)/);
      if (mUnit) {
        const fullId = mUnit[1];
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
        unitRecEntries.push({ unitId: fullId, layer, startTick, endTick, startTime, endTime, raw: val });
        continue;
      }

      // Try to parse human-readable phrasing markers like: "Phrase X/Y Length: ... endTick: 135000"
      const mPhrase = String(val).match(/^\s*Phrase\b[\s\S]*?endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
      if (mPhrase) {
        phraseEnds.push({ layer, endTick: Math.round(Number(mPhrase[1])) , raw: val });
        continue;
      }

      const mMeasure = String(val).match(/^\s*Measure\b[\s\S]*?endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
      if (mMeasure) {
        measureEnds.push({ layer, endTick: Math.round(Number(mMeasure[1])), raw: val });
        continue;
      }

      const mBeat = String(val).match(/^\s*Beat\b[\s\S]*?endTick:\s*([0-9]+(?:\.[0-9]*)?)/i);
      if (mBeat) {
        beatEnds.push({ layer, endTick: Math.round(Number(mBeat[1])), raw: val });
        continue;
      }
    }

    // Convert end lists into units with deterministic starts (start = previous end or 0)
    const buildUnitsFromEnds = (arr, typeName) => {
      if (!arr || arr.length === 0) return [];
      arr.sort((a,b) => a.endTick - b.endTick);
      const out = [];
      let prevEnd = 0;
      for (let i = 0; i < arr.length; i++) {
        const end = Number(arr[i].endTick || 0);
        const start = prevEnd;
        const uid = `${layer}|${typeName}${i+1}|${start}-${end}`;
        out.push({ unitId: uid, layer, startTick: start, endTick: end, raw: arr[i].raw, type: typeName });
        prevEnd = end;
      }
      return out;
    };

    // Prefer phrase-level boundaries when available (largest granularity)
    const phraseUnits = buildUnitsFromEnds(phraseEnds, 'phrase');
    const measureUnits = buildUnitsFromEnds(measureEnds, 'measure');
    const beatUnits = buildUnitsFromEnds(beatEnds, 'beat');

    // Merge: phrase > measure > beat > unitRecEntries (unitRec is highest-resolution but only used if meaningful)
    units.push(...phraseUnits);
    units.push(...measureUnits);
    units.push(...beatUnits);

    // Canonicalize unitRec entries by their key (strip trailing range) and aggregate start/end
    if (unitRecEntries.length) {
      const agg = new Map();
      for (const u of unitRecEntries) {
        const seg = String(u.unitId).split('|');
        const range = seg[seg.length - 1] || '';
        const key = seg.slice(0, seg.length - 1).join('|');
        const s = Number.isFinite(Number(u.startTick)) ? Number(u.startTick) : NaN;
        const e = Number.isFinite(Number(u.endTick)) ? Number(u.endTick) : NaN;
        const st = Number.isFinite(Number(u.startTime)) ? Number(u.startTime) : NaN;
        const et = Number.isFinite(Number(u.endTime)) ? Number(u.endTime) : NaN;
        const existing = agg.get(key);
        if (!existing) {
          agg.set(key, { key, layer: u.layer, minStart: Number.isFinite(s) ? s : Infinity, maxEnd: Number.isFinite(e) ? e : -Infinity, minStartTime: Number.isFinite(st) ? st : Infinity, maxEndTime: Number.isFinite(et) ? et : -Infinity, examples: [{ start: s, end: e, startTime: st, endTime: et, raw: u.raw }], count: 1 });
        } else {
          if (Number.isFinite(s)) existing.minStart = Math.min(existing.minStart, s);
          if (Number.isFinite(e)) existing.maxEnd = Math.max(existing.maxEnd, e);
          if (Number.isFinite(st)) existing.minStartTime = Math.min(existing.minStartTime, st);
          if (Number.isFinite(et)) existing.maxEndTime = Math.max(existing.maxEndTime, et);
          existing.examples.push({ start: s, end: e, startTime: st, endTime: et, raw: u.raw });
          existing.count++;
        }
      }

      const conflicts = [];
      for (const [k, v] of agg.entries()) {
        if (!Number.isFinite(v.minStart)) v.minStart = 0;
        if (!Number.isFinite(v.maxEnd)) v.maxEnd = v.minStart;
        const canonicalId = `${k}|${Math.round(v.minStart)}-${Math.round(v.maxEnd)}`;
        const canonicalStartTime = Number.isFinite(v.minStartTime) && v.minStartTime !== Infinity ? Number(v.minStartTime) : null;
        const canonicalEndTime = Number.isFinite(v.maxEndTime) && v.maxEndTime !== -Infinity ? Number(v.maxEndTime) : null;
        units.push({ unitId: canonicalId, layer: v.layer, startTick: Math.round(v.minStart), endTick: Math.round(v.maxEnd), startTime: canonicalStartTime, endTime: canonicalEndTime, rawExamples: v.examples.slice(0,5), count: v.count });
        const distinctRanges = new Set(v.examples.map(x => `${x.start}-${x.end}`));
        if (distinctRanges.size > 1) {
          conflicts.push({ key: k, layer: v.layer, canonicalStart: v.minStart, canonicalEnd: v.maxEnd, canonicalStartTime: canonicalStartTime, canonicalEndTime: canonicalEndTime, distinctRanges: Array.from(distinctRanges).slice(0,10), examples: v.examples.slice(0,5), count: v.count });
        }
      }
      try {
        if (conflicts.length) fs.writeFileSync(path.join(OUT, 'unitTreeAudit-canonicalization.json'), JSON.stringify(conflicts, null, 2)); else try { fs.unlinkSync(path.join(OUT, 'unitTreeAudit-canonicalization.json')); } catch (_e) { /* swallow */ }
      } catch (_e) { /* swallow */ }
    }
  }

  return units;
}

function listCsvFiles() {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT).filter(f => f.endsWith('.csv')).map(f => path.join(OUT, f));
}

function parseCsvFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/);
  const events = [];
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(',');
    if (parts.length < 3) continue;
    const tickRaw = parts[1];
    const type = parts[2];
    events.push({ tickRaw, type, rawLine: ln });
  }
  return events;
}

function audit() {
  const strict = process.argv.includes('--strict') || process.env.UNIT_AUDIT_STRICT === '1';

  const units = readUnitsFromCsv();
  const unitMap = new Map();
  units.forEach(u => {
    if (!u || !u.unitId) return;
    unitMap.set(u.unitId, u);
  });

  const csvFiles = listCsvFiles();
  const report = { errors: [], warnings: [] };

  // Gap/overlap detection per unit granularity (only compare units of the same level)
  const gaps = [];
  const unitLevel = (u) => {
    if (u.type) return String(u.type).toLowerCase();
    if (!u.unitId) return 'unknown';
    const parts = String(u.unitId).split('|');
    for (let i = parts.length - 1; i >= 1; i--) {
      const m = String(parts[i]).match(/^(section|phrase|measure|beat|division|subdiv|subsubdiv)/i);
      if (m) return m[1].toLowerCase();
    }
    return 'unknown';
  };

  ['primary','poly'].forEach(layerName => {
    const layerUnits = units.filter(uu => uu.layer === layerName && Number.isFinite(Number(uu.startTick)) && Number.isFinite(Number(uu.endTick)));
    // Group by level
    const groups = {};
    // Further group by parent path so we only compare siblings (same parent context)
    const parentGroups = {};
    for (const u of layerUnits) {
      const lvl = unitLevel(u) || 'unknown';
      const parts = String(u.unitId || '').split('|');
      const parentKey = parts.slice(0, Math.max(1, parts.length - 1)).join('|');
      parentGroups[lvl] = parentGroups[lvl] || {};
      parentGroups[lvl][parentKey] = parentGroups[lvl][parentKey] || [];
      parentGroups[lvl][parentKey].push(u);
    }

    for (const lvl of Object.keys(parentGroups)) {
      for (const parentKey of Object.keys(parentGroups[lvl])) {
        const arr = parentGroups[lvl][parentKey].sort((a,b) => Number(a.startTick) - Number(b.startTick));
        for (let i = 0; i < arr.length - 1; i++) {
          const cur = arr[i];
          const next = arr[i+1];
          if (Number(next.startTick) > Number(cur.endTick)) {
            const gap = Number(next.startTick) - Number(cur.endTick);
            gaps.push({ layer: layerName, level: lvl, parent: parentKey, prevUnit: cur.unitId, prevEnd: cur.endTick, nextUnit: next.unitId, nextStart: next.startTick, gap });
            report.errors.push(`Unit gap in layer ${layerName} (${lvl} parent=${parentKey}): ${cur.unitId} -> ${next.unitId} gap=${gap} ticks`);
          } else if (Number(next.startTick) < Number(cur.endTick)) {
            const overlap = Number(cur.endTick) - Number(next.startTick);
            gaps.push({ layer: layerName, level: lvl, parent: parentKey, prevUnit: cur.unitId, prevEnd: cur.endTick, nextUnit: next.unitId, nextStart: next.startTick, overlap });
            report.errors.push(`Unit overlap in layer ${layerName} (${lvl} parent=${parentKey}): ${cur.unitId} -> ${next.unitId} overlap=${overlap} ticks`);
          }
        }
      }
    }
  });
  if (gaps.length) {
    try { const gapsPath = path.join(OUT, 'unitTreeAudit-gaps.json'); fs.writeFileSync(gapsPath, JSON.stringify(gaps, null, 2)); } catch (_e) { /* swallow */ }
  }

  if (strict) console.log('Unit tree audit running in STRICT mode: events after last unit will be reported as errors.');

  for (const file of csvFiles) {
    const layer = path.basename(file).toLowerCase().includes('output1') ? 'primary' : path.basename(file).toLowerCase().includes('output2') ? 'poly' : 'unknown';
    const events = parseCsvFile(file);
    for (const e of events) {
      let tickNum = null;
      let unitId = null;
      if (String(e.tickRaw).includes('|')) {
        const idx = String(e.tickRaw).indexOf('|');
        tickNum = Number(String(e.tickRaw).slice(0, idx));
        unitId = String(e.tickRaw).slice(idx + 1);
      } else {
        tickNum = Number(e.tickRaw);
      }
      if (!Number.isFinite(tickNum)) {
        report.errors.push(`Invalid numeric tick in ${path.basename(file)} line: ${e.rawLine}`);
        continue;
      }
      // Use integer-rounded tick for containment checks to avoid float rounding mismatches
      const tickInt = Math.round(Number(tickNum));

      // If no unitId present, try to find enclosing unit by tick
      let u = null;
      // If we match via a tolerant search (nearby unit), set this flag so we can avoid hard errors later
      let matchedWithTolerance = false;
      if (unitId) u = unitMap.get(unitId) || null;
      if (!u) {
        // find by containment: prefer the smallest (most granular) unit that contains the tick
        const candidates = units.filter(uu => uu.layer === layer && Number.isFinite(Number(uu.startTick)) && Number.isFinite(Number(uu.endTick)) && (tickInt >= Math.round(Number(uu.startTick)) && tickInt <= Math.round(Number(uu.endTick)))).map(uu => ({ ...uu, span: Math.round(Number(uu.endTick) - Number(uu.startTick)) }));
        if (candidates.length) {
          candidates.sort((a,b) => a.span - b.span);
          u = candidates[0];
        }
      }



      if (!u) {
        // No unit found — always treat as an error.
        const layerUnits = units.filter(uu => uu.layer === layer && Number.isFinite(Number(uu.endTick)));
        const lastEnd = layerUnits.length ? layerUnits.reduce((m,uu) => Math.max(m, Number(uu.endTick)), -Infinity) : -Infinity;
        if (Number.isFinite(lastEnd) && tickInt >= Number(lastEnd)) {
          report.errors.push(`Event after last unit in ${path.basename(file)} line: ${e.rawLine}`);
          continue;
        }
        // Otherwise it's simply missing mapping — report as error.
        report.errors.push(`Missing unit mapping for event in ${path.basename(file)} line: ${e.rawLine}`);
        continue;
      }

      // Allow note_off events to be after unit end
      const isOff = String(e.type || '').toLowerCase().includes('off');
      const start = Number(u.startTick || 0);
      const end = Number(u.endTick || 0);
      if (isOff) {
        if (!(tickInt >= start)) {
          report.errors.push(`note_off before unit start in ${path.basename(file)} line: ${e.rawLine}`);
        }
      } else {
        if (!(tickInt >= start && tickInt <= end)) {
          report.errors.push(`Event tick ${tickNum} for unit ${u.unitId} in ${path.basename(file)} falls outside unit range [${start},${end}] -> ${e.rawLine}`);
        }
      }
    }
  }

  // Output report
  const outPath = path.join(OUT, 'unitTreeAudit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Audit complete. Errors=${report.errors.length} Warnings=${report.warnings.length} Files=${csvFiles.length} Units=${units.length}`);
  if (report.errors.length > 0) {
    console.error('Errors found. See', outPath);
    process.exit(3);
  } else if (report.warnings.length > 0) {
    console.warn('Warnings found. See', outPath);
    process.exit(0);
  } else {
    console.log('All audits passed.');
    process.exit(0);
  }
}

audit();
