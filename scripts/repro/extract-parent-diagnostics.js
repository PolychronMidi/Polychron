const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let parentArg = args[0] || process.env.TARGET_PARENT;
if (!parentArg) {
  console.error('Usage: node extract-parent-diagnostics.js <parentKey> | b64:<base64> or set TARGET_PARENT');
  process.exit(2);
}
if (String(parentArg).startsWith('b64:')) {
  try { parentArg = Buffer.from(String(parentArg).slice(4), 'base64').toString('utf8'); } catch (e) { }
}
const safe = parentArg.replace(/[^a-zA-Z0-9-_]/g, '_');
const outDir = path.join(process.cwd(), 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const idxTraces = path.join(outDir, 'index-traces.ndjson');
const anomalies = path.join(outDir, 'unitIndex-anomalies-rich.ndjson');
const overlong = path.join(outDir, 'overlong-units.ndjson');

const outIdx = path.join(outDir, `repro-parent-${safe}-index-traces.ndjson`);
const outAnom = path.join(outDir, `repro-parent-${safe}-anomalies.ndjson`);
const outOver = path.join(outDir, `repro-parent-${safe}-overlong.ndjson`);

function filterFile(inPath, outPath, matcher) {
  if (!fs.existsSync(inPath)) return 0;
  const txt = fs.readFileSync(inPath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const filtered = lines.filter(l => matcher(l));
  if (filtered.length) fs.writeFileSync(outPath, filtered.join('\n') + '\n', 'utf8');
  return filtered.length;
}

const parentKey = parentArg;
console.log('Extracting diagnostics for parent:', parentKey);
const idxCount = filterFile(idxTraces, outIdx, l => l.includes(parentKey) || l.includes(`"unitId":"${parentKey}`));
const anomCount = filterFile(anomalies, outAnom, l => l.includes(parentKey) || l.includes(`"unitId":"${parentKey}`));
const overCount = filterFile(overlong, outOver, l => l.includes(parentKey) || l.includes(`"fullId":"${parentKey}`) || l.includes(parentKey));
console.log(`Wrote ${idxCount} index-traces, ${anomCount} anomalies, ${overCount} overlong lines to output/ for parent ${safe}`);
if (!idxCount && !anomCount && !overCount) process.exit(1);
process.exit(0);
