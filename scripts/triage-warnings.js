import fs from 'fs';
const j = JSON.parse(fs.readFileSync('output/treewalker-report.json', 'utf8'));
const counts = {};
j.warnings.forEach(w => {
  const m = w.match(/Backfilled missing unitHash for event at tick (\d+) in output1.csv/);
  if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
});
const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,40);
console.log('Top ticks by backfilled count:');
top.forEach(([t,c]) => console.log(t, c));
