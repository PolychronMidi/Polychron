import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

it('stable when composer.getSubdivisions flips within a division', () => {
  const out = path.join(process.cwd(), 'output');
  const traces = path.join(out, 'index-traces.ndjson');
  try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) { /* swallow */ }

  // Run Node with a composer that flips its subdivisions on successive calls
  const script = `composer = { getDivisions: () => 1, getSubdivisions: (function(){let i=0; return function(){ return (i++ % 2 === 0) ? 7 : 1; } })() };
process.env.PLAY_LIMIT='1'; process.env.INDEX_TRACES='1'; require('./src/play.js');`;

  const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env }, stdio: 'inherit' });
  if (res.error) throw res.error;

  // Read traces and assert there are no division entries where subdivIndex >= subdivsPerDiv
  const exists = fs.existsSync(traces);
  const lines = exists ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  const divisionEntries = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).filter(e => e.tag === 'time:division-entry');

  const bad = divisionEntries.filter(e => Number.isFinite(e.subdivIndex) && Number.isFinite(e.subdivsPerDiv) && (e.subdivIndex >= e.subdivsPerDiv));

  expect(bad.length, `Found ${bad.length} division entries with subdivIndex >= subdivsPerDiv. Sample: ${bad.slice(0,3).map(x=>JSON.stringify(x)).join('\n')}`).toBe(0);
});
