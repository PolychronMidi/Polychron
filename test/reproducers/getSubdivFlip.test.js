import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

it('stable when composer.getSubdivs flips within a division', () => {
  const out = path.join(process.cwd(), 'output');
  const traces = path.join(out, 'index-traces.ndjson');
  try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) { /* swallow */ }

  // Run Node with a composer module that flips its subdivs on successive calls by using a temporary override module
  const tmp = path.join(process.cwd(), 'tmp', `composer-override-getSubdivFlip-${Date.now()}.js`);
  try { fs.mkdirSync(path.dirname(tmp), { recursive: true }); } catch (_e) { /* swallow */ }
  fs.writeFileSync(tmp, "module.exports = { getDivisions: () => 1, getSubdivs: (function(){let i=0; return function(){ return (i++ % 2 === 0) ? 7 : 1; } })(), getSubsubdivs: () => 1, getMeter: () => [4,4] };", 'utf8');

  const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'play-guard.js')], { env: Object.assign({}, process.env, { COMPOSER_OVERRIDE_MODULE: tmp, PLAY_LIMIT: '1', INDEX_TRACES: '1' }), stdio: 'inherit' });
  try { fs.unlinkSync(tmp); } catch (e) { /* swallow */ }
  if (res && res.error) throw res.error;

  // Read traces and assert there are no division entries where subdivIndex >= subdivsPerDiv
  const exists = fs.existsSync(traces);
  const lines = exists ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  const divisionEntries = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).filter(e => e.tag === 'time:division-entry');

  const bad = divisionEntries.filter(e => Number.isFinite(e.subdivIndex) && Number.isFinite(e.subdivsPerDiv) && (e.subdivIndex >= e.subdivsPerDiv));

  expect(bad.length, `Found ${bad.length} division entries with subdivIndex >= subdivsPerDiv. Sample: ${bad.slice(0,3).map(x=>JSON.stringify(x)).join('\n')}`).toBe(0);
});
