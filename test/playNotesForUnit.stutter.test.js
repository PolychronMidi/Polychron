require('../src/playNotesForUnit');
import { describe, it, expect, beforeEach } from 'vitest';

describe('playNotesForUnit - stutter scheduling', () => {
  beforeEach(() => {
    global.rf = () => 0.6; // gate will allow stutter calls
    global.c = [];
    global.LM = { activeLayer: 'primary', layers: { primary: { beatMotifs: { 0: [{ note: 60 }] } } } };
    global.tpBeat = 480; global.tpSubdiv = 120; global.tpDiv = 240; global.tpSubsubdiv = 60;
    global.bpmRatio3 = 1;
    // Provide test scheduler
    global.__test_scheduleNoteCascade = function(manager, opts) { return 1; };
    if (typeof global.noteCascade === 'undefined' || !global.noteCascade) global.noteCascade = {};
    global.noteCascade.scheduleNoteCascade = global.__test_scheduleNoteCascade;
  });

  it('calls noteCascade.scheduleNoteCascade when enableStutter=true', () => {
    let called = 0;
    const orig = noteCascade.scheduleNoteCascade;
    noteCascade.scheduleNoteCascade = (m, opts) => { called++; return orig(m, opts); };

    const scheduled = playNotesForUnit('subdiv', { on: 0, enableStutter: true, velocity: 80, binVel: 40 });
    expect(scheduled).toBeGreaterThan(0);
    expect(called).toBeGreaterThanOrEqual(1);

    // restore
    noteCascade.scheduleNoteCascade = orig;
  });
});
