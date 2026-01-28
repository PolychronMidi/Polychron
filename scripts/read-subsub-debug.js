const fs = require('fs');
const p = 'output/time-debug.ndjson';
if(!fs.existsSync(p)) { console.error('missing'); process.exit(1); }
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const matched = lines.filter(l => l && l.includes('subsub-check'));
console.log('matches', matched.length);
matched.slice(-20).forEach(l => console.log(l));
