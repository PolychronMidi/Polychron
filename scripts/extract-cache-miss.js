// scripts/extract-cache-miss.js
// Reads output/index-traces.ndjson and writes composer:cache:miss entries for beat/div keys

const fs = require('fs');
const path = require('path');

const tracesPath = path.join(process.cwd(), 'output', 'index-traces.ndjson');
const outPath = path.join(process.cwd(), 'output', 'cache-miss-compact.ndjson');

if (!fs.existsSync(tracesPath)) {
  console.error('No traces file found at', tracesPath); process.exit(2);
}

const lines = fs.readFileSync(tracesPath, 'utf8').split(/\r?\n/).filter(Boolean);
const hits = [];
for (const l of lines) {
  try {
    const j = JSON.parse(l);
    if (j && j.tag === 'composer:cache:miss' && typeof j.key === 'string') {
      if (j.key.startsWith('beat:') || j.key.startsWith('div:')) {
        hits.push(j);
      }
    }
  } catch (e) {
    // ignore parse errors
  }
}

try { fs.writeFileSync(outPath, hits.map(h => JSON.stringify(h)).join('\n') + (hits.length ? '\n' : '')); } catch(e) { console.error('Failed write:', e); process.exit(3); }

console.log(`Wrote ${hits.length} high-level composer:cache:miss entries to ${outPath}`);
if (hits.length) console.log('Sample:', JSON.stringify(hits.slice(0,5), null, 2));
process.exit(0);
