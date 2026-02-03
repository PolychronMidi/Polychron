// Integration tests for stage scheduling + MotifSpreader
// Verifies that playSubdivNotes pulls from beatMotifs and writes events into the global buffer `c`.

require('../src/writer'); // ensures `p` and `c` globals exist
require('../src/composers/motifSpreader');
require('../src/utils');
require('../src/stage'); // setup-stage shim should make this safe in test env

describe('stage integration: playSubdivNotes', () => {
  let origRf, origRv, origP;

  beforeEach(() => {
    // stub RNGs for deterministic behavior
    origRf = global.rf;
    origRv = global.rv;
    global.rf = () => 2; // deterministic rf
    global.rv = () => 0.01; // make gating condition true

    // stub p to capture calls
    origP = global.p;
    global._pCalls = [];
    global.p = (buffer, ...items) => { global._pCalls.push(...items); buffer.push(...items); };

    // reset global buffers
    if (Array.isArray(c)) c.length = 0;

    // minimal timing globals
    global.subdivStart = 0;
    global.tpSubdiv = 0; // ensure on = subdivStart
    global.tpBeat = 1; // beat length so beatKey = 0

    // small cross modulation so left/right compare passes
    global.crossModulation = 1;
    global.lastCrossMod = 0;

    // ensure layer manager with a single layer exists
    global.LM = { layers: { 0: { beatMotifs: { 0: [{ note: 60, groupId: 'g', seqIndex: 0, seqLen: 1 }] } } }, activeLayer: 0 };

    // Clear small state
    if (global.layer) delete global.layer;
  });

  afterEach(() => {
    global.rf = origRf;
    global.rv = origRv;
    if (Array.isArray(c)) c.length = 0;
    // restore p
    if (origP) global.p = origP;
    delete global._pCalls;
    // cleanup globals added in beforeEach
    delete global.subdivStart; delete global.tpSubdiv; delete global.tpBeat; delete global.LM; delete global.crossModulation; delete global.lastCrossMod;
  });

  it('writes scheduled note_on events into `c` buffer from beatMotifs', () => {
    // Call the deterministic test helper to schedule one beat
    const pushed = global.__test_playBeat(LM.layers[0], 0, 0, 1, 80, 90);
    expect(Array.isArray(pushed)).toBeTruthy();
    expect(pushed.length).toBeGreaterThan(0);

    // Also verify p was invoked
    expect(Array.isArray(global._pCalls)).toBeTruthy();
    const found60 = global._pCalls.some(ev => ev && Array.isArray(ev.vals) && ev.vals.includes(60));
    expect(found60).toBeTruthy();
  });

  it('respects layer.measureComposer.selectNoteWithLeading when present', () => {
    // replace beatMotifs bucket with two candidates
    global.LM.layers[0].beatMotifs[0] = [{ note: 61 }, { note: 67 }];
    // attach a simple measureComposer that always picks 67
    global.LM.layers[0].measureComposer = { selectNoteWithLeading: (_cands) => 67 };

    // Call the deterministic test helper with measureComposer attached
    const pushed = global.__test_playBeat(LM.layers[0], 0, 0, 1, 80, 90);
    // verify helper returned scheduled events
    expect(pushed.length).toBeGreaterThan(0);
    // verify p saw the events and at least one included 67
    const found67 = global._pCalls.some(ev => ev && Array.isArray(ev.vals) && ev.vals.includes(67));
    expect(found67).toBeTruthy();
  });
});
