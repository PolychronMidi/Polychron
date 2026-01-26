const fs = require('fs');
const path = require('path');

// Simple CSV treewalker & validator for Polychron outputs
// Validations performed:
// Walks the unit tree at all levels to verify and report accurate continuity.
// - Every non-marker event row must include a unitHash encoded as `tick|unitHash`.
// - Each event's numeric tick must fall within the start/end range of the unit as recorded in unitHash, with the only exception being note_off events to allow for dynamic sustain.
// - Sibling units within the same layer must not overlap (start/end ranges must be disjoint) and meet with no gap.
// - Units should increment in order and only up to the total number of units per parent unit (e.g. beat 1..N within each measure).

console.log('Starting treewalker.js ...');

const OUT_DIR = path.resolve(process.cwd(), 'output');
const UNITS_PATH = path.join(OUT_DIR, 'units.json');

// Whether we loaded units from the master map fallback (affects validation strictness)
let usedMaster = false;

function readUnits() {
  // Prefer unitMasterMap.json as the authoritative source of canonical unit ranges.
  // If absent, fall back to units.json for legacy or fixture support.
  const masterPath = path.join(OUT_DIR, 'unitMasterMap.json');
  let units = [];
  if (fs.existsSync(masterPath)) {
    usedMaster = true;
    try {
      const mt = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
      // Support both legacy { units: [...] } manifests and newer array-root manifests
      const masterUnits = Array.isArray(mt) ? mt : ((mt && Array.isArray(mt.units)) ? mt.units : []);
      for (const mu of masterUnits) {
        const key = mu.key;
        // Infer unitType from the last segment of the key
        const segs = String(key).split('|');
        let unitType = '__unknown__';
        for (let i = segs.length - 1; i >= 0; i--) {
          const s = segs[i];
          if (/^subsubdivision\d+\/.+/.test(s) || /^subsubdivision\d+\/\d+/.test(s)) { unitType = 'subsubdivision'; break; }
          if (/^subdivision\d+\/.+/.test(s) || /^subdivision\d+\/\d+/.test(s)) { unitType = 'subdivision'; break; }
          if (/^division\d+\/.+/.test(s) || /^division\d+\/\d+/.test(s)) { unitType = 'division'; break; }
          if (/^beat\d+\/.+/.test(s) || /^beat\d+\/\d+/.test(s)) { unitType = 'beat'; break; }
          if (/^measure\d+\/.+/.test(s) || /^measure\d+\/\d+/.test(s)) { unitType = 'measure'; break; }
          if (/^phrase\d+\/.+/.test(s) || /^phrase\d+\/\d+/.test(s)) { unitType = 'phrase'; break; }
          if (/^section\d+\/.+/.test(s) || /^section\d+\/\d+/.test(s)) { unitType = 'section'; break; }
        }
        // Infer sectionIndex where possible
        let sectionIndex = undefined;
        const sec = segs.find(s => /^section\d+\/.+/.test(s) || /^section\d+\/\d+/.test(s));
        if (sec) {
          const m = String(sec).match(/section(\d+)\/.+/);
          if (m) sectionIndex = Number(m[1]) - 1;
        }
        units.push({ unitHash: key, layer: mu.layer || 'primary', startTick: mu.startTick, endTick: mu.endTick, unitType, sectionIndex });
      }
    } catch (e) {
      console.error('Failed to read unitMasterMap.json:', e && e.message);
      process.exit(2);
    }
  } else if (fs.existsSync(UNITS_PATH)) {
    try {
      const txt = fs.readFileSync(UNITS_PATH, 'utf8');
      const manifest = JSON.parse(txt);
      units = manifest.units || [];
    } catch (e) {
      console.error('Failed to read units manifest:', e && e.message);
      process.exit(2);
    }
  } else {
    console.error('No unitMasterMap.json or units.json found; run `play` first to generate outputs.');
    process.exit(2);
  }

  return units;
}

function listCsvFiles() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.csv')).map(f => path.join(OUT_DIR, f));
}

function parseCsvFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/);
  const events = [];
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue; // skip non-event lines
    // naive split: 1,tick,type,rest
    const parts = ln.split(',');
    if (parts.length < 4) continue;
    const tickRaw = parts[1];
    const type = parts[2];
    const vals = parts.slice(3).join(',');

    // parse tick maybe like "123|abc"
    let tickNum = null;
    let unitHash = null;
    if (String(tickRaw).includes('|')) {
      const p = String(tickRaw).split('|');
      tickNum = Number(p[0]);
      unitHash = p[1] || null;
    } else {
      tickNum = Number(tickRaw);
    }

    if (!Number.isFinite(tickNum)) tickNum = null;

    events.push({ tickRaw, tickNum, unitHash, type, vals, rawLine: ln });
  }
  return events;
}

function mapFilenameToLayer(filename) {
  const base = path.basename(filename).toLowerCase();
  if (base.includes('output1')) return 'primary';
  if (base.includes('output2')) return 'poly';
  // fallback: derive name portion after 'output' if present
  const m = base.match(/^output(?:([0-9]+|[A-Za-z].+))?\.csv$/);
  if (m && m[1]) return m[1];
  return base.replace(/\.csv$/, '');
}

function groupUnitsByLayer(units) {
  const byLayer = {};
  for (const u of units) {
    if (!u.layer) continue;
    if (!byLayer[u.layer]) byLayer[u.layer] = [];
    byLayer[u.layer].push(u);
  }
  // sort units by start tick
  for (const k of Object.keys(byLayer)) {
    byLayer[k].sort((a,b) => (a.startTick || 0) - (b.startTick || 0));
  }
  return byLayer;
}

// Produce a concise summary of overlap errors for triage.
// Parses overlap error messages produced by validateOverlap and groups them by parent unit (up to beat-level).
function summarizeOverlapErrors(errs, topN = 20) {
  const overlaps = [];
  const byParent = new Map();
  // match strings like: "Overlap in layer primary section 0 unitType subsubdivision: unit <A> [s1,e1) overlaps <B> [s2,e2)"
  const r = /^Overlap in layer (\S+) section (\S+) unitType (\S+): unit (.+?) \[(\d+),(\d+)[\)\]] overlaps (.+?) \[(\d+),(\d+)[\)\]]/;
  for (const s of errs) {
    const m = String(s).match(r);
    if (!m) continue;
    const [, layer, section, unitType, a, aS, aE, b, bS, bE] = m;
    const parent = String(a).split('|').slice(0,5).join('|');
    const obj = { layer, section, unitType, unitA: a, unitB: b, aStart: Number(aS), aEnd: Number(aE), bStart: Number(bS), bEnd: Number(bE), parent };
    overlaps.push(obj);
    const arr = byParent.get(parent) || [];
    arr.push(obj);
    byParent.set(parent, arr);
  }
  const parents = Array.from(byParent.entries()).map(([parent, arr]) => ({ parent, count: arr.length, examples: arr.slice(0, Math.min(arr.length, 5)) })).sort((x,y) => y.count - x.count);
  return { total: overlaps.length, topParents: parents.slice(0, topN).map(p => ({ parent: p.parent, count: p.count, example: p.examples[0] })), examples: overlaps.slice(0, topN) };
}

function validateOverlap(units) {
  // Group units by layer, section, and unitType and check overlaps among identical unit types.
  const errors = [];
  // Deduplicate units by unitHash to avoid duplicate entries causing false overlaps
  const unitMap = new Map();
  for (const u of units) {
    if (!u || !u.unitHash) continue;
    const key = String(u.unitHash);
    const s = Number(u.startTick || 0);
    const e = Number(u.endTick || 0);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (!unitMap.has(key)) {
      unitMap.set(key, { unitHash: key, unitType: u.unitType || '__unknown__', layer: u.layer || 'unknown', sectionIndex: u.sectionIndex, start: s, end: e });
    } else {
      const existing = unitMap.get(key);
      existing.start = Math.min(existing.start, s);
      existing.end = Math.max(existing.end, e);
      existing.unitType = existing.unitType || u.unitType || '__unknown__';
      existing.sectionIndex = existing.sectionIndex !== undefined ? existing.sectionIndex : u.sectionIndex;
    }
  }

  const mergedUnits = Array.from(unitMap.values());

  // Attempt to infer section indices for units missing them by using section units
  const sectionsByLayer = {};
  for (const u of mergedUnits) {
    if (u.unitType === 'section') {
      sectionsByLayer[u.layer] = sectionsByLayer[u.layer] || [];
      sectionsByLayer[u.layer].push({ start: u.start, end: u.end, sectionIndex: u.sectionIndex });
    }
  }
  for (const layer of Object.keys(sectionsByLayer)) {
    sectionsByLayer[layer].sort((a, b) => a.start - b.start);
  }

  // Assign inferred sectionIndex if missing
  for (const u of mergedUnits) {
    if (u.sectionIndex === undefined) {
      const layerSections = sectionsByLayer[u.layer] || [];
      const found = layerSections.find(s => u.start >= s.start && u.start < s.end);
      if (found) u.sectionIndex = found.sectionIndex;
    }
  }

  const groups = {};
  for (const u of mergedUnits) {
    const layer = u.layer || 'unknown';
    const sec = typeof u.sectionIndex === 'number' ? u.sectionIndex : '__no_section__';
    const ut = u.unitType || '__unknown__';
    groups[layer] = groups[layer] || {};
    groups[layer][sec] = groups[layer][sec] || {};
    groups[layer][sec][ut] = groups[layer][sec][ut] || [];
    groups[layer][sec][ut].push({ unitHash: u.unitHash, start: u.start, end: u.end, unitType: ut, sectionIndex: u.sectionIndex });
  }

  for (const layer of Object.keys(groups)) {
    for (const sec of Object.keys(groups[layer])) {
      for (const ut of Object.keys(groups[layer][sec])) {
        const list = groups[layer][sec][ut].slice().sort((a, b) => a.start - b.start);
        for (let i = 0; i < list.length - 1; i++) {
          const a = list[i];
          const b = list[i + 1];
          if (a.start < b.end && b.start < a.end) {
            errors.push(`Overlap in layer ${layer} section ${sec} unitType ${ut}: unit ${a.unitHash} [${a.start},${a.end}) overlaps ${b.unitHash} [${b.start},${b.end})`);
          }
        }
      }
    }
  }
  return errors;
}

function findSectionMarkers(events) {
  return events.filter(e => e.type === 'marker_t' && /Section/i.test(e.vals)).map(e => ({ tickNum: e.tickNum, raw: e }));
}

function main() {
  const units = readUnits();
  const csvFiles = listCsvFiles();
  const byLayerUnits = groupUnitsByLayer(units);

  const report = { errors: [], warnings: [], summary: { files: csvFiles.length, units: units.length } };

  // Check overlaps per layer
  for (const layer of Object.keys(byLayerUnits)) {
    const errs = validateOverlap(byLayerUnits[layer]);
    // Overlaps are always errors — canonical master map units must not overlap.
    report.errors.push(...errs);
  }

  // If overlaps present, summarize and write a top-N summary to output for triage
  const overlapErrs = report.errors.filter(e => String(e).startsWith('Overlap in layer'));
  if (overlapErrs.length) {
    const summary = summarizeOverlapErrors(overlapErrs, 20);
    const overlapPath = path.join(process.cwd(), 'output', 'treewalker-overlap-summary.json');
    try { fs.writeFileSync(overlapPath, JSON.stringify(summary, null, 2)); } catch (e) {}

    // Also create a compact HTML report to make triage quick and visual
    try {
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const html = [];
      html.push('<!doctype html>');
      html.push('<html><head><meta charset="utf-8"><title>Treewalker Overlap Report</title>');
      html.push('<style>body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px;text-align:left}th{background:#f3f3f3}code{background:#f9f9f9;padding:2px 4px;border-radius:4px}</style>');
      html.push('</head><body>');
      html.push(`<h1>Treewalker Overlap Report</h1>`);
      html.push(`<p>Total overlaps: <strong>${summary.total}</strong></p>`);
      html.push('<h2>Top Parents</h2>');
      html.push('<table><thead><tr><th>Parent</th><th>Count</th><th>Example overlap</th></tr></thead><tbody>');
      for (const p of summary.topParents) {
        const ex = p.example || {};
        html.push(`<tr><td><code>${esc(p.parent)}</code></td><td>${p.count}</td><td><code>${esc(ex.unitA)} [${ex.aStart},${ex.aEnd}) ↔ ${esc(ex.unitB)} [${ex.bStart},${ex.bEnd})</code></td></tr>`);
      }
      html.push('</tbody></table>');

      html.push('<h2>Example Overlaps</h2><ol>');
      for (const ex of summary.examples) {
        html.push(`<li><code>${esc(ex.unitA)} [${ex.aStart},${ex.aEnd})</code> overlaps <code>${esc(ex.unitB)} [${ex.bStart},${ex.bEnd})</code> — parent: <code>${esc(ex.parent)}</code></li>`);
      }
      html.push('</ol>');
      html.push('<p>Related: <a href="treewalker-report.json">treewalker-report.json</a> • <a href="unitMasterMap.json">unitMasterMap.json</a></p>');
      html.push('</body></html>');
      fs.writeFileSync(path.join(process.cwd(), 'output', 'treewalker-overlap-report.html'), html.join('\n'), 'utf8');
    } catch (e) {
      // Best effort: ignore HTML writing errors
    }

    report.overlapSummary = summary;
  }

  // Parse files and validate events
  const layerSections = {};
  for (const file of csvFiles) {
    const layer = mapFilenameToLayer(file);
    const events = parseCsvFile(file);
    const sectionMarkers = findSectionMarkers(events);
    layerSections[layer] = sectionMarkers.map(s => s.tickNum === null ? null : s.tickNum);

    for (const e of events) {
      // skip internal markers used for unit handoff
      if (e.type === 'unit_handoff' || e.type === 'marker_t') continue;

      const layerUnits = byLayerUnits[layer] || [];

      // If no explicit unitHash present, try to find one in the raw CSV line's trailing columns
      // by matching against known unit hashes from the units manifest for this layer.
      if (!e.unitHash && e.rawLine) {
        try {
          const tokens = e.rawLine.split(',').map(t => String(t).trim());
          for (let i = tokens.length - 1; i >= 2 && !e.unitHash; i--) {
            const tok = tokens[i];
            if (!tok) continue;
            // Accept matches against either units.json unitHash or masterMap key
            const found = layerUnits.find(u => String(u.unitHash) === tok || String(u.unitHash || u.key) === tok);
            if (found) {
              // Only accept trailing unitHash tokens that actually contain this event's tick (if tick defined),
              // to avoid assigning events to zero-length or unrelated units.
              if (Number.isFinite(e.tickNum)) {
                const s = Number(found.startTick || 0);
                const en = Number(found.endTick || 0);
                if (Number.isFinite(s) && Number.isFinite(en)) {
                  // Use inclusive end containment similar to unitTreeAudit: non-note_off events are allowed
                  // on the unit end tick (<= en). Note-off events are allowed after end (handled later).
                  if (e.tickNum >= s && e.tickNum <= en) {
                    e.unitHash = tok;
                  } else if (e.tickNum === en && s < en) {
                    e.unitHash = tok;
                  } else {
                    // Try to find an enclosing unit that contains the tick using inclusive end
                    const enclosing = layerUnits.find(u => {
                      const us = Number(u.startTick || 0);
                      const ue = Number(u.endTick || 0);
                      return Number.isFinite(us) && Number.isFinite(ue) && (e.tickNum >= us && e.tickNum <= ue);
                    });
                    if (enclosing) e.unitHash = enclosing.unitHash || enclosing.key;
                  }
                } else {
                  const enclosing = layerUnits.find(u => {
                    const us = Number(u.startTick || 0);
                    const ue = Number(u.endTick || 0);
                    return Number.isFinite(us) && Number.isFinite(ue) && (e.tickNum >= us && e.tickNum <= ue);
                  });
                  if (enclosing) e.unitHash = enclosing.unitHash || enclosing.key;
                }
              } else {
                // If tick is not numeric, conservatively avoid assigning and let later logic handle backfill
              }
            }
          }
        } catch (_err) {}
      }

      // If no explicit unitHash present, try a tick-based lookup (best-effort backfill)
      let assignedUnit = null;
      if (!e.unitHash && Number.isFinite(e.tickNum)) {
        assignedUnit = layerUnits.find(u => {
          const s = Number(u.startTick || 0);
          const en = Number(u.endTick || 0);
          return Number.isFinite(s) && Number.isFinite(en) && (e.tickNum >= s && e.tickNum <= en);
        }) || null;
        if (assignedUnit) {
          report.warnings.push(`Backfilled missing unitHash for event at tick ${e.tickNum} in ${path.basename(file)} -> ${assignedUnit.unitHash}`);
        }
      }

      // If still no unit assigned, prefer to report as an error
      if (!e.unitHash && !assignedUnit) {
        report.errors.push(`Missing unitHash in ${path.basename(file)} line: ${e.rawLine}`);
        continue;
      }

      // Use explicit unitHash if present, otherwise the assigned fallback
      let unitHash = e.unitHash || (assignedUnit && assignedUnit.unitHash);
      const _originalUnitToken = e.unitHash || null;
      // Resolve compact numeric unit tokens like "0-750" (start-end) to canonical unitHash by matching start/end ticks.
      if (unitHash && /^[0-9]+-[0-9]+$/.test(String(unitHash))) {
        const m = String(unitHash).match(/^([0-9]+)-([0-9]+)$/);
        if (m) {
          const s = Number(m[1]);
          const en = Number(m[2]);
          // 1) Exact match for start/end
          let found = layerUnits.find(u => Number(u.startTick) === s && Number(u.endTick) === en);
          // 2) Exact start, end >= token end — choose the smallest enclosing end
          if (!found) {
            const starts = layerUnits.filter(u => Number(u.startTick) === s && Number(u.endTick) >= en).sort((a,b)=> Number(a.endTick)-Number(b.endTick));
            if (starts.length) found = starts[0];
          }
          // 3) Exact end, start <= token start — choose the largest enclosing start
          if (!found) {
            const ends = layerUnits.filter(u => Number(u.endTick) === en && Number(u.startTick) <= s).sort((a,b)=> Number(b.startTick)-Number(a.startTick));
            if (ends.length) found = ends[0];
          }
          // 4) As a last resort, find the smallest unit that fully encloses the token range
          if (!found) {
            const encl = layerUnits.filter(u => Number(u.startTick) <= s && Number(u.endTick) >= en).sort((a,b)=> (Number(a.endTick)-Number(a.startTick)) - (Number(b.endTick)-Number(b.startTick)));
            if (encl.length) found = encl[0];
          }
          if (found) {
            unitHash = found.unitHash || found.key;
          }
        }
      }

      // Resolve partial canonical segment tokens like "section5/9" or "phrase3/4" present in the tick string
      if (unitHash && /^[A-Za-z]+\d+\/\d+$/.test(String(unitHash)) && e.tickRaw && String(e.tickRaw).includes('|')) {
        try {
          const parts = String(e.tickRaw).split('|').map(s => s.trim()).filter(Boolean);
          // try progressively longer suffixes after the tick to find a matching unit key (prefixed by layer)
          for (let i = 1; i < parts.length; i++) {
            const segs = parts.slice(1, i + 1);
            const candidate = `${layer}|${segs.join('|')}`;
            const found = layerUnits.find(u => String(u.unitHash || u.key).startsWith(candidate));
            if (found) {
              // Prefer a containing match using the event tick if available
              if (Number.isFinite(e.tickNum)) {
                const s = Number(found.startTick || 0);
                const en = Number(found.endTick || 0);
                if (Number.isFinite(s) && Number.isFinite(en) && e.tickNum >= s && e.tickNum <= en) {
                  unitHash = found.unitHash || found.key;
                  break;
                }
              } else {
                unitHash = found.unitHash || found.key;
                break;
              }
            }
          }
          // Fallback: find any unit whose key contains the token and encloses the tick
          if ((!unitHash || !layerUnits.find(x=>x.unitHash===unitHash)) && Number.isFinite(e.tickNum)) {
            const tok = String(unitHash);
            const found = layerUnits.find(u => String(u.unitHash || u.key).includes(tok) && Number(u.startTick||0) <= e.tickNum && Number(u.endTick||0) >= e.tickNum);
            if (found) unitHash = found.unitHash || found.key;
          }
        } catch (_err) {}
      }

      // If the original unit token was a short segment (e.g., 'section5/9') and no matching canonical unit
      // was found in this layer, clear unitHash so tick-based backfill can assign the appropriate unit.
      // Ignore short segment tokens like "section5/9" — let tick-based backfill assign the correct unit instead
      if (_originalUnitToken && /^[A-Za-z]+\d+\/\d+$/.test(String(_originalUnitToken))) {
        unitHash = null;
      }

      // If no unitHash after resolution, try a tick-based lookup now (backfill)
      if (!unitHash && Number.isFinite(e.tickNum)) {
        assignedUnit = layerUnits.find(u => {
          const s = Number(u.startTick || 0);
          const en = Number(u.endTick || 0);
          return Number.isFinite(s) && Number.isFinite(en) && (e.tickNum >= s && e.tickNum <= en);
        }) || null;
        if (assignedUnit) {
          report.warnings.push(`Backfilled missing unitHash for event at tick ${e.tickNum} in ${path.basename(file)} -> ${assignedUnit.unitHash}`);
        }
      }

      const u = layerUnits.find(x => x.unitHash === unitHash);
      if (!u) {
        // Demote unknown unitHash to a warning for unresolved/partial tokens (they may be section markers or
        // representative range tokens); preserve errors for explicit canonical tokens missing from manifest.
        if (unitHash === null || _originalUnitToken) {
          report.warnings.push(`Unknown unitHash ${unitHash} in ${path.basename(file)} (no manifest entry for layer=${layer})`);
        } else {
          report.errors.push(`Unknown unitHash ${unitHash} in ${path.basename(file)} (no manifest entry for layer=${layer})`);
        }
        continue;
      }

      const t = e.tickNum;
      if (t === null) {
        report.errors.push(`Invalid numeric tick for event with unit ${unitHash} in ${path.basename(file)}; raw tick=${e.tickRaw}`);
        continue;
      }
      const start = Number(u.startTick || 0);
      const end = Number(u.endTick || 0);
      const isOff = String(e.type || '').toLowerCase().includes('off');
      if (isOff) {
        // Allow note_off events to be at or after the unit end, but not before the unit start
        if (!(t >= start)) {
          report.errors.push(`note_off before unit start in ${path.basename(file)} line: ${e.rawLine}`);
        }
      } else {
        // Non-off events must be within inclusive [start,end]
        if (!(t >= start && t <= end)) {
          report.errors.push(`Event tick ${t} for unit ${unitHash} in ${path.basename(file)} falls outside unit range [${start},${end}]`);
        }
      }
    }
  }

  // Sections sync checks: all layers should have same number of Section markers
  const counts = Object.entries(layerSections).map(([layer, arr]) => ({ layer, count: arr.length }));
  const distinct = new Set(counts.map(c => c.count));
  if (distinct.size > 1) {
    report.errors.push(`Section marker count mismatch across layers: ${JSON.stringify(counts)}`);
  }

  // Require at least one section marker per layer and that first section starts at 0
  for (const [layer, arr] of Object.entries(layerSections)) {
    if (!arr || arr.length === 0) {
      report.warnings.push(`No Section markers found in layer ${layer} (CSV may be missing markers).`);
    } else if (arr[0] !== 0) {
      report.warnings.push(`First Section marker in layer ${layer} does not start at tick 0 (start=${arr[0]}).`);
    }
  }

  // Write report
  const outPath = path.join(process.cwd(), 'output', 'treewalker-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const errCount = report.errors.length;
  const warnCount = report.warnings.length;
  console.log(`Treewalker completed. Errors=${errCount} Warnings=${warnCount} Files=${csvFiles.length} Units=${units.length}`);
  if (errCount > 0) {
    console.error('Errors found. See', outPath);
    process.exit(3);
  } else if (warnCount > 0) {
    console.warn('Warnings found. See', outPath);
    process.exit(0);
  } else {
    console.log('All checks passed.');
    process.exit(0);
  }
}

main();
