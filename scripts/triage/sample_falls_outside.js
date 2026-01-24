const fs=require('fs');
const path=require('path');
const report = JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','..','output','unitTreeAudit-report.json'),'utf8'));
const canonical = JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','..','output','unitTreeAudit-canonicalization.json'),'utf8'));
const map = new Map(canonical.map(e=>[e.key,e]));
const errors = report.errors.filter(e=>e.includes('falls outside unit range'));
const samples = errors.slice(0,20).map(msg=>{
  // extract unit between 'for unit ' and ' in '
  const m = msg.match(/for unit ([^ ]+) in/);
  const unitWithRange = m ? m[1] : 'unknown';
  // strip trailing range after last '|' like '|1118036-1118571'
  const key = unitWithRange.replace(/\|\d+-\d+$/,'');
  const canon = map.get(key);
  return {msg,unitWithRange,key,canonical: canon ? {canonicalStart:canon.canonicalStart,canonicalEnd:canon.canonicalEnd,distinctRanges:canon.distinctRanges.slice(0,3),count:canon.count} : null};
});
console.log(JSON.stringify(samples,null,2));
console.log('\nTotal fallsOutside errors:', errors.length);
