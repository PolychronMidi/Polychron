import fs from 'fs';
const lines = fs.readFileSync('output/output1.csv','utf8').split('\n');
const samples = lines.filter(l=>l.includes(',8400,'));
const counts = {};
const missing = {};
samples.forEach(l=>{
  const cols = l.split(',');
  const et = cols[2]||'';
  counts[et] = (counts[et]||0)+1;
  // unitHash is last column when there are >=7 columns
  if(!cols[6]) missing[et] = (missing[et]||0)+1;
});
console.log('totalLines', samples.length);
console.log('eventCounts', counts);
console.log('missingByEvent', missing);
console.log('sampleLines');
console.log(samples.slice(0,30).join('\n'));
