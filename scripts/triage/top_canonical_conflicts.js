const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname,'..','..','output','unitTreeAudit-canonicalization.json');
const out = JSON.parse(fs.readFileSync(file,'utf8'));
const conflicts = out.filter(e => (e.count && e.count>1) || (e.distinctRanges && e.distinctRanges.length>1));
conflicts.sort((a,b)=> (b.count||0)-(a.count||0));
const top = conflicts.slice(0,20);
console.log(JSON.stringify(top.map(e=>({key:e.key,layer:e.layer,count:e.count,distinctRanges:e.distinctRanges,examples:e.examples.slice(0,2)})),null,2));
console.log('\nTotal conflicts:', conflicts.length);
