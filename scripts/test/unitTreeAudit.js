#!/usr/bin/env node
// Copied from root scripts/unitTreeAudit.js into scripts/test for test tooling and CI
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.cwd(), 'output');
const UNITS_PATH = path.join(OUT, 'units.json');

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

  const units = readUnits();
  const unitMap = new Map();
  units.forEach(u => {
    if (!u || !u.unitId) return;
    unitMap.set(u.unitId, u);
  });

  const csvFiles = listCsvFiles();
  const report = { errors: [], warnings: [] };
  if (strict) console.log('Unit tree audit running in STRICT mode: events after last unit will be reported as warnings.');

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

      // If no unitId present, try to find enclosing unit by tick
      let u = null;
      if (unitId) u = unitMap.get(unitId) || null;
      if (!u) {
        // find by containment
        const found = units.find(uu => uu.layer === layer && Number.isFinite(Number(uu.startTick)) && Number.isFinite(Number(uu.endTick)) && (tickNum >= Number(uu.startTick) && tickNum < Number(uu.endTick)));
        if (found) {
          u = found;
        }
      }

      if (!u) {
        // If the event is after the last known unit for this layer, treat it as a warning when strict mode is enabled.
        const layerUnits = units.filter(uu => uu.layer === layer && Number.isFinite(Number(uu.endTick)));
        const lastEnd = layerUnits.length ? layerUnits.reduce((m,uu) => Math.max(m, Number(uu.endTick)), -Infinity) : -Infinity;
        if (Number.isFinite(lastEnd) && tickNum >= Number(lastEnd)) {
          if (strict) {
            report.warnings.push(`Event after last unit in ${path.basename(file)} line: ${e.rawLine}`);
          }
          // Non-strict mode: silently ignore events after the last unit.
          continue;
        }

        report.errors.push(`Missing unit mapping for event in ${path.basename(file)} line: ${e.rawLine}`);
        continue;
      }

      // Allow note_off events to be after unit end
      const isOff = String(e.type || '').toLowerCase().includes('off');
      const start = Number(u.startTick || 0);
      const end = Number(u.endTick || 0);
      if (isOff) {
        if (!(tickNum >= start)) {
          report.errors.push(`note_off before unit start in ${path.basename(file)} line: ${e.rawLine}`);
        }
      } else {
        if (!(tickNum >= start && tickNum < end)) {
          report.errors.push(`Event tick ${tickNum} for unit ${u.unitId} in ${path.basename(file)} falls outside unit range [${start},${end}) -> ${e.rawLine}`);
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
