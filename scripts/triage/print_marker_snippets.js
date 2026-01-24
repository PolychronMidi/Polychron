const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(),'output');
const rpt = path.join(OUT,'layerAlignment-report.json');
if (!fs.existsSync(rpt)) { console.error('report not found'); process.exit(2); }
const report = JSON.parse(fs.readFileSync(rpt,'utf8'));
const mismatches = report.markerMismatches || [];
const CSV = { primary: path.join(OUT,'output1.csv'), poly: path.join(OUT,'output2.csv') };

function findLines(csvPath, matchStr, ctx=10) {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath,'utf8').split(/\r?\n/);
  const idx = lines.findIndex(l => l && l.indexOf(matchStr) !== -1);
  if (idx === -1) return [];
  const start = Math.max(0, idx - ctx);
  const end = Math.min(lines.length-1, idx + ctx);
  const out = [];
  for (let i = start; i <= end; i++) out.push({ lineNum: i+1, text: lines[i] });
  return out;
}

const out = [];
for (const m of mismatches) {
  const layer = m.layer;
  const csvPath = CSV[layer] || null;
  let searchStr = '';
  if (m.marker && m.marker.raw) searchStr = m.marker.raw.trim();
  // fallback: if key available, search for 'Section <n>/' or 'Phrase'
  if (!searchStr && m.key && m.key.match(/^s(\d+)/i)) {
    const si = Number(m.key.match(/^s(\d+)/i)[1])+0; // not adjusting
    searchStr = `Section ${si+1}/`;
  }
  const snippet = csvPath ? findLines(csvPath, searchStr, 12) : [];
  out.push({ layer, key: m.key, markerRaw: m.marker ? m.marker.raw : null, snippet });
}
const outPath = path.join(OUT,'layerAlignment-marker-snippets.json');
fs.writeFileSync(outPath, JSON.stringify(out,null,2));
console.log('Wrote', outPath);
console.log(out.map(o=>({layer:o.layer,key:o.key, lines: o.snippet.length})));
