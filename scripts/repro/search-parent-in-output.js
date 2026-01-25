const fs = require('fs');
const path = require('path');
const parent = process.argv[2];
if (!parent) { console.error('usage: node search-parent-in-output.js <parentPrefix>'); process.exit(2); }
const OUT = path.join(process.cwd(), 'output');
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.ndjson') || f.endsWith('.json'));
for (const f of files) {
  const fp = path.join(OUT, f);
  let cnt = 0;
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    for (const l of lines) if (l.includes(parent)) cnt++;
  } catch (e) { cnt = -1; }
  console.log(`${f}: ${cnt}`);
}
