import { expect, it } from 'vitest';

it('finds subsubdivision units with span > 60000 in LM state for diagnosis', () => {
  process.env.PLAY_LIMIT = '1';
  require('../src/play.js');
  expect(LM).toBeDefined();
  const large = [];
  for (const layerName of Object.keys(LM.layers)) {
    const units = LM.layers[layerName].state.units || [];
    for (const u of units) {
      if (u.unitType === 'subsubdivision') {
        const span = u.endTick - u.startTick;
        if (span > 60000) large.push({ layer: layerName, key: u.key, start: u.startTick, end: u.endTick, span, parent: `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}|${u.subdivIndex}` });
      }
    }
  }
  // Print diagnostics to help developer triage
  large.forEach(l => console.log('LARGE_UNIT', l));
  expect(large.length).toBe(0);
});
