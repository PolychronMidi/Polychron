/*
Extract surrounding traces for top Treewalker overlaps.
Usage: node scripts/triage/extract-overlap-context.js [N]
Creates files under output/triage/overlap-<i>-<safeParent>.ndjson with context lines
from index-traces.ndjson and composer-creation.ndjson for the example units.
*/
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(p, 'utf8');
const outDir = path.join('output','triage');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const N = Number(process.argv[2] || 50);
const summaryPath = path.join('output','treewalker-overlap-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('Missing', summaryPath);
  process.exit(1);
}
const summary = JSON.parse(read(summaryPath));
const parents = (summary.topParents || []).slice(0, 10);
const sources = ['output/index-traces.ndjson','output/composer-creation.ndjson'];
function safeName(s){ return s.replace(/[^a-z0-9_-]/gi,'_').slice(0,140); }
function writeContextForString(srcPath, match, destPath){
  if (!fs.existsSync(srcPath)) return;
  const lines = read(srcPath).split('\n');
  for(let i=0;i<lines.length;i++){
    if (lines[i].includes(match)){
      const start = Math.max(0,i-N);
      const end = Math.min(lines.length-1,i+N);
      const chunk = lines.slice(start,end+1).join('\n');
      fs.appendFileSync(destPath, `\n--- match: ${match} in ${path.basename(srcPath)} at line ${i+1} ---\n`);
      fs.appendFileSync(destPath, chunk + '\n');
    }
  }
}
parents.forEach((p,idx)=>{
  const parent = p.parent || p;
  const name = `${idx+1}_${safeName(parent)}`;
  const dest = path.join(outDir, `overlap-${name}.ndjson`);
  fs.writeFileSync(dest, `parent: ${parent}\ncount: ${p.count || 0}\n`);
  const example = p.example || {};
  const fields = [example.unitA, example.unitB, parent];
  fields.forEach(f => {
    if (!f) return;
    sources.forEach(s => writeContextForString(s, f, dest));
  });
  console.log('wrote', dest);
});
console.log('done');
