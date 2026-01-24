const fs=require('fs');
const path=require('path');
const file = path.resolve(__dirname,'..','..','output','unitTreeAudit-canonicalization.json');
const arr = JSON.parse(fs.readFileSync(file,'utf8'));
const counts = arr.reduce((m,e)=>{m[e.layer]=(m[e.layer]||0)+1; return m;},{})
console.log(JSON.stringify(counts,null,2));
console.log('Total:',arr.length);
