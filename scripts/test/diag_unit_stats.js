const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.cwd(), 'output');
const units = JSON.parse(fs.readFileSync(path.join(OUT, 'units.json'), 'utf8')).units;
const layers = [...new Set(units.map(u => u.layer))];
const out = {};
for (const l of layers) {
  const arr = units.filter(u => u.layer === l);
  out[l] = { maxUnitEnd: Math.max(...arr.map(a => a.endTime || 0)), maxUnitStart: Math.max(...arr.map(a => a.startTime || 0)) };
}
fs.writeFileSync(path.join(OUT, 'unit_stats.json'), JSON.stringify(out, null, 2));
console.log('Wrote output/unit_stats.json');
