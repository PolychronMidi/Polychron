const fs = require('fs');
const path = require('path');

const OUT = path.join(process.cwd(), 'output');
const SUMMARY = path.join(OUT, 'treewalker-overlap-summary.json');
console.log('[collect-topParents-bundles] starting - looking for', SUMMARY);
if (!fs.existsSync(SUMMARY)) {
  console.error('treewalker-overlap-summary.json missing in output/ - run validate:csv first');
  process.exit(2);
}
const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'));
const top = summary.topParents || [];
const N = process.argv[2] ? Number(process.argv[2]) : 20;
const selected = top.slice(0, N);

const filesToScan = [ 'index-traces.ndjson', 'unitIndex-anomalies-rich.ndjson', 'overlong-units.ndjson', 'unitTreeAudit-diagnostics.ndjson', 'unitMasterMap-overlap-fix.ndjson' ];

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

const aggregate = [];
ensureDir(path.join(OUT, 'triage'));

for (const p of selected) {
  const parent = p.parent;
  const safe = parent.replace(/[^a-zA-Z0-9-_]/g, '_');
  const dir = path.join(OUT, 'triage', safe);
  ensureDir(dir);
  const report = { parent, safe, counts: {}, example: p.example };

  for (const fname of filesToScan) {
    const fpath = path.join(OUT, fname);
    const outF = path.join(dir, fname);
    let count = 0;
    try {
      if (fs.existsSync(fpath)) {
        const txt = fs.readFileSync(fpath, 'utf8');
        const lines = txt.split(/\r?\n/).filter(Boolean);
        const matches = lines.filter(l => l.includes(parent) || l.includes(JSON.stringify(parent)) || l.includes(parent.replace(/\|/g,'\\|')));
        if (matches.length) fs.writeFileSync(outF, matches.join('\n') + '\n', 'utf8');
        count = matches.length;
      }
    } catch (e) { /* ignore per-file errors */ }
    report.counts[fname] = count;
  }

  // Also collect any masterMap canonical entries that include the parent key prefix
  const mmJson = path.join(OUT, 'unitMasterMap.json');
  const mmNd = path.join(OUT, 'unitMasterMap.ndjson');
  report.counts.unitMasterMap_json = 0; report.counts.unitMasterMap_ndjson = 0;
  try {
    if (fs.existsSync(mmJson)) {
      const mt = JSON.parse(fs.readFileSync(mmJson, 'utf8'));
      const units = (mt && Array.isArray(mt.units)) ? mt.units : [];
      const matches = units.filter(u => u.key && u.key.startsWith(parent));
      if (matches.length) fs.writeFileSync(path.join(dir, 'unitMasterMap.json'), JSON.stringify(matches, null, 2));
      report.counts.unitMasterMap_json = matches.length;
    }
  } catch (e) { /* swallow */ }
  try {
    if (fs.existsSync(mmNd)) {
      const txt = fs.readFileSync(mmNd, 'utf8');
      const lines = txt.split(/\r?\n/).filter(Boolean);
      const matches = lines.filter(l => l.includes(parent));
      if (matches.length) fs.writeFileSync(path.join(dir, 'unitMasterMap.ndjson'), matches.join('\n') + '\n');
      report.counts.unitMasterMap_ndjson = matches.length;
    }
  } catch (e) { /* swallow */ }

  // Write a minimal per-parent summary
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
  aggregate.push(report);
}

fs.writeFileSync(path.join(OUT, 'triage', 'topParents-bundles-summary.json'), JSON.stringify({ generated: (new Date()).toISOString(), total: aggregate.length, parents: aggregate }, null, 2));
console.log('Bundles written to output/triage (summary at output/triage/topParents-bundles-summary.json)');
process.exit(0);
