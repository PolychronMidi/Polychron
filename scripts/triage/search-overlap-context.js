const fs = require('fs');
const path = require('path');
function readLines(p){ try { return fs.readFileSync(p,'utf8').split(/\r?\n/); } catch(e){ return []; } }
const summaryPath = path.join('output','treewalker-overlap-summary.json');
if(!fs.existsSync(summaryPath)){ console.error('Missing', summaryPath); process.exit(1); }
const summary = JSON.parse(fs.readFileSync(summaryPath,'utf8'));
const tops = (summary.topParents || []).slice(0,10);
const sources = [path.join('output','index-traces.ndjson'), path.join('output','composer-creation.ndjson')];
for(const [i,p] of tops.entries()){
  console.log('\n== Parent ' + (i+1) + ': ' + p.parent + ' (count=' + p.count + ') ==');
  const ex = p.example || {};
  const targets = [ex.unitA, ex.unitB].filter(Boolean);
  for(const t of targets){
    console.log('\n-- Target: ' + t + '\n');
    for(const src of sources){
      const lines = readLines(src);
      let found=false;
      for(let idx=0; idx<lines.length; idx++){
        if(lines[idx].includes(t)){
          found=true;
          const start = Math.max(0, idx-5), end = Math.min(lines.length-1, idx+5);
          console.log('*** ' + path.basename(src) + ' match at line ' + (idx+1) + '\n' + lines.slice(start,end+1).join('\n') + '\n');
        }
      }
      if(!found) console.log('No match in ' + path.basename(src));
    }
  }
}
console.log('\nDone');
