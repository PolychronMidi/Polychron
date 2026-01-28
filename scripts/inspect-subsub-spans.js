const fs = require('fs');
const rpt = JSON.parse(fs.readFileSync('output/treewalker-report.json','utf8'));
const errs = (rpt.errors||[]).filter(e=>e.includes('unitType subsubdiv'));
function spanFromMsg(m){ const r = /\[(\d+),(\d+)\)/; const mRes = m.match(r); if(!mRes) return null; return Number(mRes[2]) - Number(mRes[1]); }
const spans = errs.map(e=>({msg:e,span:spanFromMsg(e)})).sort((a,b)=>b.span - a.span);
spans.slice(0,40).forEach(s=>console.log(s.span, s.msg));
console.log('TOTAL', errs.length);
