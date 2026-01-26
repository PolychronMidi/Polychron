import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

it('subsubdivision units are within their subdivision parent bounds', () => {
  const outDir = path.join(process.cwd(), 'output');

  // Run a fast play in-process so we can inspect global LM (avoid child processes)
  process.env.PLAY_LIMIT = '1';
  require('../src/play.js');

  // Inspect LM layer units
  const LM = globalThis.LM;
  expect(LM).toBeDefined();
  for (const layerName of Object.keys(LM.layers)) {
    const units = LM.layers[layerName].state.units || [];
    // Build an index of subdivision parents keyed by section/phrase/measure/beat/div/subdiv
    const subdivIndex = {};
    for (const u of units) {
      if (u.unitType === 'subdivision') {
        const key = `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}|${u.subdivIndex}`;
        subdivIndex[key] = u;
      }
    }

    const violations = [];
    for (const u of units) {
      if (u.unitType === 'subsubdivision') {
        const pkey = `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}|${u.subdivIndex}`;
        const parent = subdivIndex[pkey];
        if (!parent) {
          violations.push(`Missing parent subdiv for subsub unit ${u.key || ''}`);
          continue;
        }
        if (!Number.isFinite(u.startTick) || !Number.isFinite(u.endTick)) {
          violations.push(`Non-finite ticks for ${u.key || ''}`);
        }
        if (u.startTick < parent.startTick) violations.push(`startTick < parent.startTick for ${u.key || ''} (${u.startTick} < ${parent.startTick})`);
        if (u.endTick > parent.endTick) violations.push(`endTick > parent.endTick for ${u.key || ''} (${u.endTick} > ${parent.endTick})`);
        if (u.endTick <= u.startTick) violations.push(`endTick <= startTick for ${u.key || ''} (${u.startTick} >= ${u.endTick})`);
      }
    }

    expect(violations.length).toBe(0);
  }
});
