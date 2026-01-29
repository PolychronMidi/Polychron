// repro-collect-play-failures.js
// Run a short play run repeatedly and collect NDJSON artifacts when failures/CRITICALs occur.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNS = Number(process.env.REPRO_RUNS || 5);
const PLAY_LIMIT = process.env.PLAY_LIMIT || '1';
const OUT = path.join(process.cwd(), 'output');
const ART = path.join(process.cwd(), 'tmp', 'repro-artifacts');
if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });

function collectArtifacts(tag) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(ART, `${tag}-${ts}`);
  fs.mkdirSync(dest, { recursive: true });
  const files = ['critical-errors.ndjson','time-debug.ndjson','beat-boundary-debug.ndjson','measure-boundary-debug.ndjson','phrase-boundary-debug.ndjson','index-traces.ndjson','writer.ndjson','overlap-dupes.ndjson','duplicate-skip.ndjson'];
  for (const f of files) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, path.join(dest, f)); } catch (e) { /* swallow */ }
    }
  }
  // copy output CSVs
  ['output1.csv','output2.csv','unitMasterMap.json','unitMasterMap.ndjson'].forEach(fn => { try { const p = path.join(OUT, fn); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dest, fn)); } catch (e) { /* swallow */ } });
  console.log('Collected artifacts to', dest);
}

console.log(`Running ${RUNS} short play runs (PLAY_LIMIT=${PLAY_LIMIT}) and collecting failures.`);
for (let i = 0; i < RUNS; i++) {
  console.log(`Run ${i+1}/${RUNS}...`);
  const res = spawnSync(process.execPath, [path.join('scripts','play-guard.js')], { env: Object.assign({}, process.env, { PLAY_LIMIT }), encoding: 'utf8', timeout: 120000 });
  console.log('exit', res && res.status, 'signal', res && res.signal);
  const critPath = path.join(OUT, 'critical-errors.ndjson');
  let hasCritical = false;
  try {
    if (fs.existsSync(critPath)) {
      const lines = fs.readFileSync(critPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        console.error(`Run ${i+1}: Detected ${lines.length} CRITICALs`);
        hasCritical = true;
      }
    }
  } catch (e) { /* swallow */ }

  if (res && typeof res.status === 'number' && res.status !== 0) {
    console.error(`Run ${i+1}: play-guard exited non-zero: ${res.status}`);
    collectArtifacts(`exit-${res.status}`);
  } else if (hasCritical) {
    collectArtifacts(`critical-run-${i+1}`);
  } else {
    console.log(`Run ${i+1}: OK`);
  }
}

console.log('Done. Check', ART, 'for collected artifacts.');
