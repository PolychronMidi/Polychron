const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname,'..','..','output','unitTreeAudit-report.json');
const report = JSON.parse(fs.readFileSync(file,'utf8'));
const errors = report.errors || [];
const first20 = errors.slice(0,20);
console.log(JSON.stringify({totalErrors: errors.length, first20},null,2));
const summary = errors.reduce((acc,e)=>{
  if(e.includes('falls outside unit range')) acc.outside = (acc.outside||0)+1;
  else if(e.includes('Event after last unit')) acc.afterLast = (acc.afterLast||0)+1;
  else if(e.includes('note_off before unit start')) acc.noteOffBefore = (acc.noteOffBefore||0)+1;
  else acc.other = (acc.other||0)+1;
  return acc;
},{});
console.log('\nSummary counts:', summary);
