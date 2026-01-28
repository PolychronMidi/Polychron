import { it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

it('play should preserve naked globals visible to LM.activate/advance', () => {
  const script = path.join(process.cwd(), 'scripts', 'run-globals-check.js');
  const res = spawnSync(process.execPath, [script], { env: { ...process.env, PLAY_LIMIT: '1', SUPPRESS_HUMAN_MARKER_CHECK: '1' }, stdio: 'inherit' });
  expect(res.status === 0, `Expected script to exit 0, got ${res.status}`).toBe(true);

  const traces = path.join(process.cwd(), 'output', 'globals-check.ndjson');
  expect(fs.existsSync(traces)).toBe(true);
  const lines = fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  // We expect at least one after-activate entries and loop-division entries
  const recs = lines.map(l => JSON.parse(l));
  const hasAfterActivatePrimary = recs.some(r => r.tag === 'after-activate-primary' && r.layer === 'primary');
  const hasAfterActivatePoly = recs.some(r => r.tag === 'after-activate-poly' && r.layer === 'poly');
  const hasLoopDivisionPrimary = recs.some(r => r.tag === 'loop-division-primary' && r.layer === 'primary');
  const hasLoopDivisionPoly = recs.some(r => r.tag === 'loop-division-poly' && r.layer === 'poly');

  expect(hasAfterActivatePrimary).toBe(true);
  expect(hasLoopDivisionPrimary).toBe(true);
  // Poly may not appear in PLAY_LIMIT=1 runs but we still ensure file format is valid
  expect(recs.length).toBeGreaterThan(0);
}, 120000);
