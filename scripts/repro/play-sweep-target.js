const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const target = process.argv[2] || process.env.TARGET_PARENT;
if (!target) { console.error('Usage: node play-sweep-target.js <parentKey> [attempts] [playLimit]'); process.exit(2); }
const attempts = process.argv[3] ? Number(process.argv[3]) : 50;
const playLimit = process.argv[4] ? Number(process.argv[4]) : 48;
const safe = target.replace(/[^a-zA-Z0-9-_]/g,'_');
const hitPath = path.join(process.cwd(),'output',`repro-parent-hit-${safe}.ndjson`);

console.log(`Sweeping play for target=${target} attempts=${attempts} playLimit=${playLimit}`);
for (let i = 1; i <= attempts; i++) {
  console.log(`Play attempt ${i}/${attempts} ...`);
  const env = Object.assign({}, process.env, { PLAY_LIMIT: String(playLimit), TARGET_PARENT: target, INDEX_TRACES: '1' });
  const res = spawnSync(process.execPath, ['scripts/play-guard.js'], { env, encoding: 'utf8', stdio: ['inherit','pipe','pipe'] });
  if (fs.existsSync(hitPath)) {
    console.log(`Hit found on attempt ${i} -> ${hitPath}`);
    process.exit(0);
  }
}
console.log('No hit found after attempts');
process.exit(1);
