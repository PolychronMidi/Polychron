const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const parentArg = process.argv[2] || process.env.TARGET_PARENT;
if (!parentArg) { console.error('Usage: node repro-parent-sweep.js <parentKey> [attempts]'); process.exit(2); }
const safe = parentArg.replace(/[^a-zA-Z0-9-_]/g,'_');
const attempts = process.argv[3] ? Number(process.argv[3]) : (process.env.ATTEMPTS ? Number(process.env.ATTEMPTS) : 50);
const playLimit = process.argv[4] ? Number(process.argv[4]) : (process.env.PLAY_LIMIT ? Number(process.env.PLAY_LIMIT) : 48);

console.log(`Sweeping parent=${parentArg} attempts=${attempts} playLimit=${playLimit}`);
for (let i = 1; i <= attempts; i++) {
  console.log(`Attempt ${i}/${attempts} ...`);
  const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), 'env:' + parentArg, String(playLimit)], { env: { ...process.env, PLAY_LIMIT: String(playLimit), INDEX_TRACES: '1' }, encoding: 'utf8' });
  const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
  if (fs.existsSync(outFile)) {
    try {
      const obj = JSON.parse(fs.readFileSync(outFile,'utf8'));
      if (obj && obj.unitCount && obj.unitCount > 0) {
        console.log(`Success on attempt ${i}: unitCount=${obj.unitCount} overlapCount=${obj.overlapCount}`);
        // Extract diagnostics
        spawnSync(process.execPath, [path.join('scripts','repro','extract-parent-diagnostics.js'), 'env:' + parentArg], { encoding: 'utf8' });
        process.exit(0);
      }
    } catch (e) { /* swallow */ }
  }
}
console.log('Sweep complete - no reproductions found');
process.exit(1);
