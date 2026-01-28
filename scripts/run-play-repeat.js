const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const runs = Number(process.argv[2] || 20);
const outDir = path.join(process.cwd(), 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (let i = 1; i <= runs; i++) {
  console.log(`=== RUN ${i}/${runs} ===`);
  try {
    const res = execSync('npm run play --silent', { env: process.env, encoding: 'utf8', stdio: 'pipe', maxBuffer: 200 * 1024 * 1024 });
    fs.writeFileSync(path.join(outDir, `play-run-${i}.out.log`), res, 'utf8');
    console.log(`run ${i} succeeded`);
  } catch (e) {
    const stdout = e.stdout ? String(e.stdout) : '';
    const stderr = e.stderr ? String(e.stderr) : '';
    fs.writeFileSync(path.join(outDir, `play-run-${i}.fail.stdout.log`), stdout, 'utf8');
    fs.writeFileSync(path.join(outDir, `play-run-${i}.fail.stderr.log`), stderr, 'utf8');
    console.error(`run ${i} failed`);
    // copy diagnostic files if present
    try { const dbg = fs.readFileSync(path.join(outDir, 'beat-boundary-debug.ndjson'), 'utf8'); fs.writeFileSync(path.join(outDir, `beat-boundary-debug-run-${i}.ndjson`), dbg, 'utf8'); } catch (_) { /* ignore */ }
    process.exit(i);
  }
}
console.log('All runs succeeded');
process.exit(0);
