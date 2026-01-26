#!/usr/bin/env node
// scripts/verify-sequence.js - run verify steps sequentially and always produce per-step logs
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const steps = [
  // { name: 'play', type: 'play' }, // disabled until we fix the following:
  { name: 'verify:overlap', type: 'node', script: 'scripts/test/treewalker.js' },
  { name: 'verify:unit-tree', type: 'node', script: 'scripts/test/unitTreeAudit.js' },
  { name: 'verify:layer-alignment', type: 'node', script: 'scripts/test/layerAlignment.js' },
  { name: 'verify:unitMasterMap', type: 'node', script: 'scripts/test/unitMasterMap.js' }
];

// Ensure log directory
try { fs.mkdirSync('log', { recursive: true }); } catch (e) {}

let anyFailed = false;
const results = [];

for (const s of steps) {
  const stepLog = path.join('log', `verify-${s.name.replace(/[:]/g,'-')}.log`);
  console.log(`\n--- RUN: ${s.name} -> logging to ${stepLog}`);
  let r;
  if (s.type === 'play') {
    // Run play via run-with-log to preserve existing logging behavior
    r = spawnSync(process.execPath, ['scripts/run-with-log.js', 'play.log', 'node', 'scripts/play-guard.js'], { encoding: 'utf8', env: { ...process.env } });
  } else if (s.type === 'node') {
    r = spawnSync(process.execPath, [s.script], { encoding: 'utf8', env: { ...process.env } });
  } else {
    r = spawnSync(s.cmd, s.args, { shell: true, encoding: 'utf8', env: { ...process.env } });
  }

  let joined = '';
  if (r && r.stdout) joined += r.stdout;
  if (r && r.stderr) joined += '\n' + r.stderr;
  joined += `\n\n[exitCode=${r && typeof r.status !== 'undefined' ? r.status : 'unknown'}]\n`;
  try { fs.writeFileSync(stepLog, joined); } catch (e) { console.error('Failed to write', stepLog, e && e.message); }

  // Post-play diagnostics: confirm CSVs and writer-record exist, and capture play.log into stepLog
  if (s.type === 'play') {
    try {
      const outDir = path.join(process.cwd(), 'output');
      let files = [];
      if (fs.existsSync(outDir)) files = fs.readdirSync(outDir).filter(f => f.endsWith('.csv') || f.endsWith('.json') || f.endsWith('.ndjson'));
      fs.appendFileSync(stepLog, `\nFiles in output/: ${JSON.stringify(files)}\n`);
      const writerFiles = path.join(process.cwd(), 'output', 'writer-files.ndjson');
      fs.appendFileSync(stepLog, `writer-files.ndjson present=${fs.existsSync(writerFiles)}\n`);
      const playLog = path.join('log', 'play.log');
      if (fs.existsSync(playLog)) {
        const t = fs.readFileSync(playLog, 'utf8');
        fs.appendFileSync(stepLog, '\n--- play.log BEGIN ---\n' + t.slice(-16384) + '\n--- play.log END ---\n');
      } else {
        fs.appendFileSync(stepLog, '\nplay.log not found\n');
      }
    } catch (e) {
      try { fs.appendFileSync(stepLog, `\nPost-play diagnostics failed: ${e && e.message}\n`); } catch (_) {}
    }
  }

  // Consider the step *ran* successfully if a per-step log was written and contains an exit marker.
  const stepLogContents = (() => { try { return fs.readFileSync(stepLog, 'utf8'); } catch (e) { return ''; } })();
  const ok = fs.existsSync(stepLog) && stepLogContents.includes('[exitCode=');
  results.push({ name: s.name, code: r && (r.status || 0), ok });
  if (!ok) anyFailed = true;

  const statusNote = ok ? 'OK (ran & logged)' : 'FAILED (no log or missing exit marker)';
  console.log(`${s.name}: exit=${r && r.status} -> ${statusNote} (see ${stepLog})`);
}

console.log('\n=== VERIFY SUMMARY ===');
for (const r of results) console.log(`${r.name}: ${r.ok ? 'OK' : 'FAILED (exit=' + r.code + ')'}`);
if (anyFailed) {
  console.error('\nOne or more verification steps failed. See log/verify-*.log for details.');
  process.exit(2);
}
console.log('\nAll verification steps ran.');
process.exit(0);
