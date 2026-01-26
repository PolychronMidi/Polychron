const fs = require('fs');
const rpt = JSON.parse(fs.readFileSync('output/treewalker-report.json','utf8'));
const errs = (rpt.errors||[]).filter(e=>e.includes('unitType subsubdivision'));
const large = errs.filter(e=>{
  const m = e.match(/\[(\d+),(\d+)\)/);
  if (!m) return false;
  return (Number(m[2]) - Number(m[1])) > 60000;
});
console.log('LARGE COUNT', large.length);
large.forEach(l=>console.log(l));
