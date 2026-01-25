const fs = require('fs');
const path = require('path');

const OUT = path.join(process.cwd(), 'output');
const summaryPath = path.join(OUT, 'treewalker-overlap-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('treewalker-overlap-summary.json not found in output/. Run validate:csv first.');
  process.exit(2);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const top = summary.topParents || [];
const N = process.argv[2] ? Number(process.argv[2]) : 20;
const selected = top.slice(0, N);

const diagFiles = [
  'index-traces.ndjson',
  'unitIndex-anomalies-rich.ndjson',
  'unitTreeAudit-diagnostics.ndjson',
  'overlong-units.ndjson',
  'masterMap-weird-emissions.ndjson'
];

function safeName(parent) {
  return parent.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function anyFieldMatches(obj, parentPrefix, parts) {
  if (!obj || typeof obj !== 'object') return false;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === 'string') {
      if (cur.includes(parentPrefix) || parts.some(seg => cur.includes(seg))) return true;
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else if (typeof cur === 'object') {
      for (const k in cur) stack.push(cur[k]);
    }
  }
  return false;
}

function filterFileLinesParsed(filePath, parentPrefix, parts) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const matches = [];
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      if (obj.parent && (obj.parent === parentPrefix || parts.some(p => obj.parent && obj.parent.includes(p)))) {
        matches.push(l); continue;
      }
      // check common fields
      if (obj.unitA && String(obj.unitA).startsWith(parentPrefix)) { matches.push(l); continue; }
      if (obj.unitB && String(obj.unitB).startsWith(parentPrefix)) { matches.push(l); continue; }
      if (anyFieldMatches(obj, parentPrefix, parts)) { matches.push(l); continue; }
    } catch (e) {
      // fallback to string search for non-json lines
      if (l.includes(parentPrefix) || parts.some(seg => l.includes(seg))) matches.push(l);
    }
  }
  return matches;
}

function writeIfNonEmpty(dir, name, arr) {
  if (!arr || !arr.length) return false;
  fs.writeFileSync(path.join(dir, name), arr.join('\n') + '\n', 'utf8');
  return true;
}

if (!fs.existsSync(path.join(OUT, 'triage'))) fs.mkdirSync(path.join(OUT, 'triage'));
console.log('Starting triage for', selected.length, 'parents (writing to output/triage/)');

const results = [];
for (const p of selected) {
  const parent = p.parent;
  const safe = safeName(parent);
  const dir = path.join(OUT, 'triage', safe);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // write a summary.json for the parent
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(p, null, 2), 'utf8');

  // Build matchers: exact prefix or parts
  const parentPrefix = parent;
  const parts = parent.split('|');

  let totalMatches = 0;
  for (const f of diagFiles) {
    const fp = path.join(OUT, f);
    const matches = filterFileLinesParsed(fp, parentPrefix, parts);
    if (writeIfNonEmpty(dir, f, matches)) {
      console.log(`Wrote ${matches.length} matches for parent=${parent} file=${f}`);
      totalMatches += matches.length;
    } else {
      // Write a placeholder file to indicate we checked this diag
      fs.writeFileSync(path.join(dir, `${f}.checked`), `checked ${f} - 0 matches\n`, 'utf8');
    }
  }

  // also extract masterMap canonical entry if exists
  const masterJson = path.join(OUT, 'unitMasterMap.json');
  if (fs.existsSync(masterJson)) {
    try {
      const mm = JSON.parse(fs.readFileSync(masterJson, 'utf8'));
      const units = mm.units || [];
      const found = units.filter(u => String(u.key).startsWith(parentPrefix) || (u.examples && u.examples.some(e => String(e.raw || '').includes(parentPrefix))));
      if (found.length) {
        fs.writeFileSync(path.join(dir, 'masterMap-matched.json'), JSON.stringify(found, null, 2), 'utf8');
        totalMatches += found.length;
        console.log(`Wrote masterMap-matched.json for parent=${parent} found=${found.length}`);
      } else {
        fs.writeFileSync(path.join(dir, 'masterMap.checked'), `checked masterMap - 0 matches\n`, 'utf8');
      }
    } catch (e) { fs.writeFileSync(path.join(dir, 'masterMap.error'), String(e), 'utf8'); }
  } else {
    fs.writeFileSync(path.join(dir, 'masterMap.checked'), `masterMap not present\n`, 'utf8');
  }

  // Also select any repro-parent-<safe>.json that exists from earlier runs
  const reproJson = path.join(OUT, `repro-parent-${safe}.json`);
  if (fs.existsSync(reproJson)) {
    try { fs.copyFileSync(reproJson, path.join(dir, path.basename(reproJson))); totalMatches++; } catch (e) {}
  }

  // Ensure we always have a marker file indicating we ran triage for this parent
  fs.writeFileSync(path.join(dir, 'triage-run.txt'), `totalMatches=${totalMatches}\n`, 'utf8');

  results.push({ parent, safe, totalMatches, dir });
}

const resPath = path.join(OUT, 'triage', 'triage-index.json');
fs.writeFileSync(resPath, JSON.stringify(results, null, 2), 'utf8');
console.log('Triaged parents written to output/triage/ - index at output/triage/triage-index.json');
process.exit(0);
