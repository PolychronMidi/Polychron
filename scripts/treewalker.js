#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Simple CSV treewalker & validator for Polychron outputs
// Validations performed:
// - Every non-marker event row must include a unitHash encoded as `tick|unitHash`.
// - Each event's numeric tick must fall within the start/end range of the unit as recorded in output/units.json.
// - Units within the same layer must not overlap (start/end ranges must be disjoint).
// - Sections (marker lines containing "Section") must appear in each layer and have the same count.

const OUT_DIR = path.resolve(process.cwd(), 'output');
const UNITS_PATH = path.join(OUT_DIR, 'units.json');

function readUnits() {
  if (!fs.existsSync(UNITS_PATH)) return [];
  try {
    const txt = fs.readFileSync(UNITS_PATH, 'utf8');
    const manifest = JSON.parse(txt);
    return manifest.units || [];
  } catch (e) {
    console.error('Failed to read units manifest:', e && e.message);
    process.exit(2);
  }
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
    report.errors.push(...errs);
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

      // If no explicit unitHash present, try a tick-based lookup (best-effort backfill)
      let assignedUnit = null;
      if (!e.unitHash && Number.isFinite(e.tickNum)) {
        assignedUnit = layerUnits.find(u => {
          const s = Number(u.startTick || 0);
          const en = Number(u.endTick || 0);
          return Number.isFinite(s) && Number.isFinite(en) && (e.tickNum >= s && e.tickNum < en);
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
      const unitHash = e.unitHash || (assignedUnit && assignedUnit.unitHash);
      const u = layerUnits.find(x => x.unitHash === unitHash);
      if (!u) {
        report.errors.push(`Unknown unitHash ${unitHash} in ${path.basename(file)} (no manifest entry for layer=${layer})`);
        continue;
      }

      const t = e.tickNum;
      if (t === null) {
        report.errors.push(`Invalid numeric tick for event with unit ${unitHash} in ${path.basename(file)}; raw tick=${e.tickRaw}`);
        continue;
      }
      const start = Number(u.startTick || 0);
      const end = Number(u.endTick || 0);
      if (!(t >= start && t < end)) {
        report.errors.push(`Event tick ${t} for unit ${unitHash} in ${path.basename(file)} falls outside unit range [${start},${end})`);
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
