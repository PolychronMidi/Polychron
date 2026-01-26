import { expect, it } from 'vitest';

it('subdivision siblings do not overlap within same parent', () => {
  process.env.PLAY_LIMIT = '1';
  require('../src/play.js');
  const LM = globalThis.LM;
  expect(LM).toBeDefined();
  const violations = [];
  for (const layerName of Object.keys(LM.layers)) {
    const units = (LM.layers[layerName].state.units || []).filter(u => u.unitType === 'subdivision');
    // group by parent (section|phrase|measure|beat|div)
    const groups = {};
    for (const u of units) {
      const key = `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}`;
      groups[key] = groups[key] || [];
      groups[key].push(u);
    }
    for (const k of Object.keys(groups)) {
      const arr = groups[k].sort((a,b)=>a.startTick - b.startTick);
      for (let i=1;i<arr.length;i++) {
        if (arr[i].startTick < arr[i-1].endTick) {
          violations.push(`Overlap in ${layerName} parent ${k}: ${arr[i-1].key}[${arr[i-1].startTick},${arr[i-1].endTick}) overlaps ${arr[i].key}[${arr[i].startTick},${arr[i].endTick})`);
        }
      }
    }
  }
  expect(violations.length).toBe(0);
});
