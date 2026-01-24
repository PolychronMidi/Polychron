const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const diagPath = path.join(OUT, 'layerAlignment-diagnostics.json');
if (!fs.existsSync(diagPath)) { console.error('Diagnostics not found:', diagPath); process.exit(2); }
const diag = JSON.parse(fs.readFileSync(diagPath,'utf8'));
const mismatches = (diag.mismatches || []).map(m => ({ layer: m.layer, key: m.report && m.report.key, delta: Math.abs(m.report && m.report.delta || 0), report: m.report }));
mismatches.sort((a,b) => b.delta - a.delta);
const top = mismatches.slice(0, 40);
const outPath = path.join(OUT,'layerAlignment-top-mismatches.json');
fs.writeFileSync(outPath, JSON.stringify(top, null, 2));
console.log('Wrote', outPath);
console.log(top.map(t => ({layer: t.layer, key: t.key, delta: Number(t.delta.toFixed(6))})).slice(0,20));
