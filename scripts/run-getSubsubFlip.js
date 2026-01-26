const fs = require('fs'); const path = require('path'); const traces = path.join(process.cwd(), 'output', 'index-traces.ndjson'); try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) {}
const logGate = require('../src/logGate'); const { writeDebugFile } = require('../src/logGate');

// Flapping composer: getSubsubdivs alternates between 2 and 1
globalThis.composer = { getDivisions: () => 1, getSubdivisions: () => 2, getSubsubdivs: (function () { let i = 0; return function () { return (i++ % 2 === 0) ? 2 : 1; }; })() };
// Enable tracing by default for reproducer; do not force PLAY_LIMIT so we can run full plays locally
if (!process.env.INDEX_TRACES) process.env.INDEX_TRACES = '1';
// Run the play engine as a child process so we do NOT import the main module into this script (avoids side-effects during tests)
const { spawnSync } = require('child_process');
const playPath = require.resolve('../src/play.js');
const env = Object.assign({}, process.env, { INDEX_TRACES: process.env.INDEX_TRACES || '1', PLAY_LIMIT: process.env.PLAY_LIMIT || '1' });
const res = spawnSync(process.execPath, [playPath], { env, stdio: 'inherit' });
if (res.error) { console.error('play process execution failed', res.error); process.exit(1); }
if (res.status !== 0) process.exit(res.status);

const lines = fs.existsSync(traces) ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
const recs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const preAnoms = recs.filter(r => r.tag === 'time:pre-anomaly');
const bad = preAnoms.filter(e => Number.isFinite(e.subsubdivIndex) && Number.isFinite(e.subsubdivsPerSub) && (e.subsubdivIndex > e.subsubdivsPerSub));
if (logGate.isEnabled('repro')) console.log('preAnoms', preAnoms.length, 'badCount', bad.length);
if (bad.length > 0) {
  try { writeDebugFile('repro-errors.ndjson', { when: new Date().toISOString(), bad: bad.slice(0,5) }, 'repro'); } catch (e) {}
  if (logGate.isEnabled('repro')) console.error('Bad samples:', bad.slice(0,5));
  process.exit(2);
} else {
  if (logGate.isEnabled('repro')) console.log('No bad pre-anomaly subsubdivision entries found');
}
