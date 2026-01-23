import fs from 'fs';
import path from 'path';
import { registerWriterServices, grandFinale } from '../src/writer.js';

test('units manifest contains startTime and endTime values (seconds)', () => {
  const env: any = { container: { get: (k: string) => undefined, has: (k: string) => false }, fs: fs, PPQ: 480, tpSec: 480 };
  // minimal LM with one layer and a fake timing tree
  env.LM = { layers: { primary: { buffer: [], state: { tpSec: 480, sectionStart: 0 } } } };
  env.state = { timingTree: { primary: { children: { section: { '0': { children: { phrase: { '0': { phraseStart: 0, tpPhrase: 1920, unitHash: 'uh1', start: 0, end: 1920 } } } } } } } } };

  // Mock fs
  const fspath = path.resolve(process.cwd(), 'output', 'units.json');
  try { fs.unlinkSync(fspath); } catch (_e) {}
  grandFinale(env);

  const txt = fs.readFileSync('output/units.json', 'utf8');
  const jm = JSON.parse(txt);
  expect(Array.isArray(jm.units)).toBe(true);
  const u = jm.units.find((x: any) => x.unitHash === 'uh1');
  expect(u).toBeDefined();
  expect(typeof u.startTime).toBe('number');
  expect(typeof u.endTime).toBe('number');
});
