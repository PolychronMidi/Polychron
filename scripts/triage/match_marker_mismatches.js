const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const reportPath = path.join(OUT, 'layerAlignment-report.json');
if (!fs.existsSync(reportPath)) {
  console.error('Report not found:', reportPath);
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath,'utf8'));
const mismatches = report.markerMismatches || [];
const csvFiles = {
  primary: path.join(OUT,'output1.csv'),
  poly: path.join(OUT,'output2.csv')
};

const csvCache = {};
for (const k of Object.keys(csvFiles)) {
  try { csvCache[k] = fs.readFileSync(csvFiles[k],'utf8').split(/\r?\n/); } catch (e) { csvCache[k] = []; }
}

const diagFiles = ['unitTreeAudit-diagnostics.ndjson','unitTreeAudit-suspicious-units.ndjson'];
const diagLines = [];
for (const f of diagFiles) {
  const p = path.join(OUT,f);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean);
  lines.forEach(l => diagLines.push({file:f,line:l}));
}

const results = mismatches.map((m, idx) => {
  const layer = m.layer;
  const marker = m.marker || {};
  const endTick = marker.endTick;
  const sectionIdx = marker.sectionIdx;
  const matches = [];
  const fileLines = csvCache[layer] || [];
  for (let i=0;i<fileLines.length;i++){
    const ln = fileLines[i];
    if (!ln || !ln.startsWith('1,')) continue;
    if (String(ln).toLowerCase().includes('marker_t')){
      // either search by endTick or by section token
      if (endTick && ln.includes(`endTick: ${endTick}`)) matches.push({lineNum:i+1, line:ln});
      else if (typeof sectionIdx !== 'undefined' && sectionIdx !== null) {
        const token = `Section ${sectionIdx+1}/`;
        if (ln.includes(token) || ln.includes(`section${sectionIdx+1}`) || ln.includes(`section${sectionIdx}`)) matches.push({lineNum:i+1, line:ln});
      }
    }
  }

  // Also search for nearby unitRec entries in the CSV (same file) within +/- 30 lines of the first match
  const unitRecNearby = [];
  if (matches.length) {
    const firstIdx = matches[0].lineNum-1;
    const start = Math.max(0, firstIdx-30);
    const end = Math.min(fileLines.length-1, firstIdx+30);
    for (let i=start;i<=end;i++){
      const ln = fileLines[i];
      if (!ln) continue;
      if (ln.toLowerCase().includes('marker_t') && ln.includes('unitRec:')) unitRecNearby.push({lineNum:i+1,line:ln});
    }
  }

  // Diagnostics matching by endTick or section index
  const diagMatches = diagLines.filter(d => (endTick && d.line.includes(String(endTick))) || (typeof sectionIdx !== 'undefined' && d.line.includes(`section${sectionIdx}`) || (typeof sectionIdx !== 'undefined' && d.line.includes(`section${sectionIdx+1}`)))).slice(0,5);

  return { idx, layer, key: m.key, marker, matches, unitRecNearby, diagMatches };
});

const outPath = path.join(OUT,'layerAlignment-triage.json');
fs.writeFileSync(outPath, JSON.stringify(results,null,2));
console.log('Wrote triage file:', outPath);
console.log('Examples (first 6):');
console.log(JSON.stringify(results.slice(0,6),null,2));
