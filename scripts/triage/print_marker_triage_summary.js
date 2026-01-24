const fs = require('fs');
const path = require('path');
const inPath = path.join(process.cwd(),'output','layerAlignment-triage.json');
if (!fs.existsSync(inPath)) { console.error('triage file missing'); process.exit(2); }
const arr = JSON.parse(fs.readFileSync(inPath,'utf8'));
const out = arr.map(e => {
  const firstMatch = (e.matches && e.matches[0]) ? {lineNum: e.matches[0].lineNum, line: e.matches[0].line.substr(0,200)} : null;
  const firstUnit = (e.unitRecNearby && e.unitRecNearby[0]) ? {lineNum: e.unitRecNearby[0].lineNum, line: e.unitRecNearby[0].line.substr(0,200)} : null;
  const firstDiag = (e.diagMatches && e.diagMatches[0]) ? {file: e.diagMatches[0].file, line: e.diagMatches[0].line.substr(0,200)} : null;
  return { idx: e.idx, layer: e.layer, key: e.key, marker: e.marker, match: firstMatch, unitRecNearby: firstUnit, diagSample: firstDiag };
});
console.log(JSON.stringify(out,null,2));
