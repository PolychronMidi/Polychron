import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// This test reproduces the CRITICAL boundary:beat condition and ensures it remains
// visible (not silently masked). It will be used as a regression test while we
// fix the upstream cause.

describe('Boundary: beat CRITICAL regression', () => {
  const OUT = path.join(process.cwd(), 'output');

  beforeEach(() => {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
    // ensure output CSVs are not present to avoid marker interference
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) { /* swallow */ }
    try { fs.unlinkSync(path.join(OUT, 'output2.csv')); } catch (e) { /* swallow */ }
    // reset LM to a clean state
    if (typeof LM !== 'undefined' && LM) { LM.layers = {}; LM.activeLayer = null; }
    // deterministic defaults
    m = Math; LOG = 'none';
  });

  it('setUnitTiming should throw CRITICAL when beat bounds fall outside measure', () => {
    // Setup a minimal environment that will produce invalid beat bounds
    // Intentionally create inconsistent values: numerator=1 but beatIndex=5 so beat falls beyond measure
    sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 5;
    tpSec = 1000; tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
    numerator = 1; denominator = 4; measuresPerPhrase = 1;

    // minimal composer stub
    composer = { getDivisions: () => 1, getSubdivs: () => 1, getSubsubdivs: () => 1, getMeter: () => [1,4] };

    // ensure MIDI timing values
    BPM = 120; PPQ = 480; if (typeof getMidiTiming === 'function') getMidiTiming();

    // Minimal LM stub (avoid importing play.js in-process in tests)
    if (typeof LM === 'undefined' || !LM) {
      LM = { layers: {}, activeLayer: null, register: (name, id, opts, cb) => {
        LM.layers[name] = { state: { units: [], _composerCache: {} }, buffer: [] };
        return { state: LM.layers[name].state, buffer: LM.layers[name].buffer };
      } };
    }
    LM.register && LM.register('primary', 'c1', {}, () => {});

    // Require runtime modules so setUnitTiming is available
    require('../src/writer.js'); require('../src/time.js'); require('../src/rhythm.js');

    // We expect a CRITICAL error indicating beat boundary is outside parent measure
    expect(() => {
      setUnitTiming('beat');
    }).toThrow(/CRITICAL:.*boundary:beat|Computed beat bounds fall outside parent measure bounds/);
  });
});
