require('../src/playNotesForUnit');
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('playNotesForUnit - subdiv', () => {
  let origRf, origRm, origC, origLM;

  beforeEach(() => {
    origRf = global.rf;
    global.rf = () => 0.4; // deterministic gating
    origC = global.c;
    global.c = [];
    origLM = global.LM;
    global.LM = { activeLayer: 'primary', layers: { primary: { beatMotifs: { 0: [{ note: 60 }, { note: 64 }] } } } };

    // MotifSpreader
    if (!global.MotifSpreader) global.MotifSpreader = { getBeatMotifPicks: (layer, beatKey, max) => (layer.beatMotifs[beatKey] || []).slice(0, max) };

    // timing
    global.tpBeat = 480; global.tpSubdiv = 120; global.tpDiv = 240; global.tpSubsubdiv = 60;
    global.bpmRatio3 = 1;
  });

  afterEach(() => {
    global.rf = origRf; global.c = origC; global.LM = origLM;
  });

  it('schedules events for subdiv unit', () => {
    const scheduled = playNotesForUnit('subdiv', { on: 0, enableStutter: false, velocity: 80, binVel: 40 });
    expect(scheduled).toBeGreaterThan(0);
    expect(global.c.length).toBeGreaterThan(0);
    const ons = global.c.filter(e => e.type === 'on');
    expect(ons.length).toBeGreaterThan(0);
  });
});
