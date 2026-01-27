// scripts/check-postfix-guards.js
// Scan output CSVs and fail if any non-marker rows contain a tick field with a '|' postfix
const fs = require('fs');
const path = require('path');
const outDir = path.join(process.cwd(), 'output');
let failed = false;
if (!fs.existsSync(outDir)) process.exit(0);
const files = fs.readdirSync(outDir).filter(f => f.endsWith('.csv'));
for (const f of files) {
  const p = path.join(outDir, f);
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  for (const ln of lines) {
    const parts = ln.split(',');
    if (parts.length < 3) continue;
    const tickField = parts[1] || '';
    const type = (parts[2] || '').toLowerCase();
    if (type !== 'marker_t' && tickField.indexOf('|') !== -1) {
      console.error(`Forbidden tick postfix found in ${f}: ${ln}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('Postfix guard scan passed.');
