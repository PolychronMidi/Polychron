const fs = require('fs'); const path = require('path'); const traces = path.join(process.cwd(), 'output', 'index-traces.ndjson'); try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) {}

// Flapping composer: getDivisions alternates between 3 and 1
composer = { getDivisions: (function () { let i = 0; return function () { return (i++ % 2 === 0) ? 3 : 1; }; })(), getSubdivisions: () => 2, getSubsubdivs: () => 1 };
// Enable tracing by default for reproducer; do not force PLAY_LIMIT so we can run full plays locally
if (!process.env.INDEX_TRACES) process.env.INDEX_TRACES = '1';
require('../src/play.js');

const lines = fs.existsSync(traces) ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
const recs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const divisionEntries = recs.filter(r => r.tag === 'time:division-entry');
const bad = divisionEntries.filter(e => Number.isFinite(e.divIndex) && Number.isFinite(e.divsPerBeat) && (e.divIndex >= e.divsPerBeat));
console.log('divisionEntries', divisionEntries.length, 'badCount', bad.length);
if (bad.length > 0) {
  console.error('Bad samples:', bad.slice(0,5));
  process.exit(2);
} else {
  console.log('No bad division entries found');
}
