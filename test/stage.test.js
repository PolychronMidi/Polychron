// test/stage.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import the stage module which loads all dependencies
require('../stage');

describe('Stage Module', () => {
  beforeEach(() => {
    // Reset global state that stage.js modifies
    globalThis.c = [];
    globalThis.beatStart = 0;
    globalThis.beatCount = 0;
    globalThis.beatsUntilBinauralShift = 16;
    globalThis.firstLoop = 0;
    globalThis.flipBin = false;
    globalThis.crossModulation = 2.2;
    globalThis.lastCrossMod = 0;
    globalThis.subdivsOff = 0;
    globalThis.subdivsOn = 0;
    globalThis.velocity = 99;
    globalThis.tpSec = 960;
    globalThis.tpSubdiv = 100;
    globalThis.tpDiv = 400;
    globalThis.tpBeat = 1600;
    globalThis.subdivStart = 0;
    globalThis.beatRhythm = [1, 0, 1, 0];
    globalThis.divRhythm = [1, 1, 0];
    globalThis.subdivRhythm = [1, 0, 1];
    globalThis.beatsOn = 10;
    globalThis.beatsOff = 2;
    globalThis.divsOn = 5;
    globalThis.divsOff = 1;
    globalThis.subdivsOn = 20;
    globalThis.subdivsOff = 5;
    globalThis.subdivsPerMinute = 500;
    globalThis.balOffset = 0;
    globalThis.sideBias = 0;
    globalThis.lastUsedCHs = new Set();
    globalThis.lastUsedCHs2 = new Set();
    globalThis.lastUsedCHs3 = new Set();
  });

  describe('Global State Variables', () => {
    it('should have m (Math) defined', () => {
      expect(globalThis.m).toBeDefined();
      expect(globalThis.m.round(5.5)).toBe(6);
    });

    it('should have p (push) function defined', () => {
      expect(typeof globalThis.p).toBe('function');
      const arr = [];
      globalThis.p(arr, 1, 2, 3);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('should have clamp function defined', () => {
      expect(typeof globalThis.clamp).toBe('function');
      expect(globalThis.clamp(5, 0, 10)).toBe(5);
      expect(globalThis.clamp(-5, 0, 10)).toBe(0);
      expect(globalThis.clamp(15, 0, 10)).toBe(10);
    });

    it('should have modClamp function defined', () => {
      expect(typeof globalThis.modClamp).toBe('function');
      expect(globalThis.modClamp(5, 0, 9)).toBe(5);
      expect(globalThis.modClamp(10, 0, 9)).toBe(0);
      expect(globalThis.modClamp(-1, 0, 9)).toBe(9);
    });

    it('should have rf (randomFloat) function defined', () => {
      expect(typeof globalThis.rf).toBe('function');
      const val = globalThis.rf(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
    });

    it('should have ri (randomInt) function defined', () => {
      expect(typeof globalThis.ri).toBe('function');
      const val = globalThis.ri(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
      expect(Number.isInteger(val)).toBe(true);
    });

    it('should have ra (randomInRangeOrArray) function defined', () => {
      expect(typeof globalThis.ra).toBe('function');
      const arrVal = globalThis.ra([1, 2, 3, 4, 5]);
      expect([1, 2, 3, 4, 5]).toContain(arrVal);
    });

    it('should have rl (randomLimitedChange) function defined', () => {
      expect(typeof globalThis.rl).toBe('function');
      const val = globalThis.rl(50, -5, 5, 0, 100);
      expect(val).toBeGreaterThanOrEqual(45);
      expect(val).toBeLessThanOrEqual(55);
    });

    it('should have rv (randomVariation) function defined', () => {
      expect(typeof globalThis.rv).toBe('function');
      const val = globalThis.rv(100);
      expect(typeof val).toBe('number');
    });
  });

  describe('Channel Constants', () => {
    it('should have channel constants defined', () => {
      expect(globalThis.cCH1).toBe(0);
      expect(globalThis.cCH2).toBe(1);
      expect(globalThis.cCH3).toBe(11);
      expect(globalThis.lCH1).toBe(2);
      expect(globalThis.rCH1).toBe(3);
      expect(globalThis.drumCH).toBe(9);
    });

    it('should have source channels array', () => {
      expect(Array.isArray(globalThis.source)).toBe(true);
      expect(globalThis.source).toContain(0); // cCH1
      expect(globalThis.source).toContain(2); // lCH1
    });

    it('should have reflection channels array', () => {
      expect(Array.isArray(globalThis.reflection)).toBe(true);
      expect(globalThis.reflection).toContain(1); // cCH2
    });

    it('should have bass channels array', () => {
      expect(Array.isArray(globalThis.bass)).toBe(true);
      expect(globalThis.bass).toContain(11); // cCH3
    });
  });

  describe('Channel Mappings', () => {
    it('should have reflect mapping', () => {
      expect(globalThis.reflect[0]).toBe(1); // cCH1 -> cCH2
      expect(globalThis.reflect[2]).toBe(4); // lCH1 -> lCH3
      expect(globalThis.reflect[3]).toBe(5); // rCH1 -> rCH3
    });

    it('should have reflect2 mapping', () => {
      expect(globalThis.reflect2[0]).toBe(11); // cCH1 -> cCH3
      expect(globalThis.reflect2[2]).toBe(12); // lCH1 -> lCH5
      expect(globalThis.reflect2[3]).toBe(13); // rCH1 -> rCH5
    });
  });

  describe('Binaural Flip Mappings', () => {
    it('should have flipBinF mapping', () => {
      expect(Array.isArray(globalThis.flipBinF)).toBe(true);
      expect(globalThis.flipBinF).toContain(0);
      expect(globalThis.flipBinF).toContain(1);
      expect(globalThis.flipBinF).toContain(11);
    });

    it('should have flipBinT mapping', () => {
      expect(Array.isArray(globalThis.flipBinT)).toBe(true);
      expect(globalThis.flipBinT).toContain(0);
      expect(globalThis.flipBinT).toContain(6); // lCH2
      expect(globalThis.flipBinT).toContain(7); // rCH2
    });

    it('should have binauralL and binauralR arrays', () => {
      expect(Array.isArray(globalThis.binauralL)).toBe(true);
      expect(Array.isArray(globalThis.binauralR)).toBe(true);
      expect(globalThis.binauralL.length).toBe(6);
      expect(globalThis.binauralR.length).toBe(6);
    });
  });

  describe('Timing Variables', () => {
    it('should have tpSec defined', () => {
      expect(typeof globalThis.tpSec).toBe('number');
    });

    it('should have beat timing variables', () => {
      expect(typeof globalThis.tpBeat).toBe('number');
      expect(typeof globalThis.tpDiv).toBe('number');
      expect(typeof globalThis.tpSubdiv).toBe('number');
    });

    it('should have start position variables', () => {
      expect(typeof globalThis.beatStart).toBe('number');
      expect(typeof globalThis.divStart).toBe('number');
      expect(typeof globalThis.subdivStart).toBe('number');
    });
  });

  describe('Rhythm Variables', () => {
    it('should have beatRhythm array', () => {
      expect(Array.isArray(globalThis.beatRhythm)).toBe(true);
    });

    it('should have divRhythm array', () => {
      expect(Array.isArray(globalThis.divRhythm)).toBe(true);
    });

    it('should have subdivRhythm array', () => {
      expect(Array.isArray(globalThis.subdivRhythm)).toBe(true);
    });

    it('should have beatsOn/off counters', () => {
      expect(typeof globalThis.beatsOn).toBe('number');
      expect(typeof globalThis.beatsOff).toBe('number');
    });
  });

  describe('Binaural Variables', () => {
    it('should have binauralFreqOffset defined', () => {
      expect(typeof globalThis.binauralFreqOffset).toBe('number');
    });

    it('should have binauralPlus/binauralMinus defined', () => {
      expect(typeof globalThis.binauralPlus).toBe('number');
      expect(typeof globalThis.binauralMinus).toBe('number');
    });

    it('should have BINAURAL config', () => {
      expect(globalThis.BINAURAL).toBeDefined();
      expect(globalThis.BINAURAL.min).toBeDefined();
      expect(globalThis.BINAURAL.max).toBeDefined();
    });
  });

  describe('FX Variables', () => {
    it('should have FX array of valid MIDI CC numbers', () => {
      expect(Array.isArray(globalThis.FX)).toBe(true);
      globalThis.FX.forEach(cc => {
        expect(cc).toBeGreaterThanOrEqual(0);
        expect(cc).toBeLessThanOrEqual(127);
      });
    });

    it('should have OCTAVE config', () => {
      expect(globalThis.OCTAVE).toBeDefined();
      expect(globalThis.OCTAVE.min).toBeDefined();
      expect(globalThis.OCTAVE.max).toBeDefined();
    });
  });

  describe('Global State Variables', () => {
    it('should have velocity defined', () => {
      expect(typeof globalThis.velocity).toBe('number');
      expect(globalThis.velocity).toBeGreaterThan(0);
    });

    it('should have flipBin toggle', () => {
      expect(typeof globalThis.flipBin).toBe('boolean');
    });

    it('should have beatCount counter', () => {
      expect(typeof globalThis.beatCount).toBe('number');
    });

    it('should have crossModulation value', () => {
      expect(typeof globalThis.crossModulation).toBe('number');
    });
  });

  describe('allNotesOff', () => {
    it('should be defined as a function', () => {
      expect(typeof globalThis.allNotesOff).toBe('function');
    });

    it('should generate events for all channels', () => {
      const initialLength = globalThis.c.length;
      globalThis.allNotesOff(1000);
      expect(globalThis.c.length).toBeGreaterThan(initialLength);
    });

    it('should use control change 123', () => {
      globalThis.allNotesOff(1000);
      const allNotesOffEvent = globalThis.c.find(e => e.vals && e.vals[1] === 123);
      expect(allNotesOffEvent).toBeDefined();
    });
  });

  describe('Functions Exist', () => {
    it('should have setTuningAndInstruments function', () => {
      expect(typeof globalThis.setTuningAndInstruments).toBe('function');
    });

    it('should have setOtherInstruments function', () => {
      expect(typeof globalThis.setOtherInstruments).toBe('function');
    });

    it('should have setBinaural function', () => {
      expect(typeof globalThis.setBinaural).toBe('function');
    });

    it('should have stutterFade function', () => {
      expect(typeof globalThis.stutterFade).toBe('function');
    });

    it('should have stutterPan function', () => {
      expect(typeof globalThis.stutterPan).toBe('function');
    });

    it('should have stutterFX function', () => {
      expect(typeof globalThis.stutterFX).toBe('function');
    });

    it('should have setBalanceAndFX function', () => {
      expect(typeof globalThis.setBalanceAndFX).toBe('function');
    });

    it('should have crossModulateRhythms function', () => {
      expect(typeof globalThis.crossModulateRhythms).toBe('function');
    });

    it('should have setNoteParams function', () => {
      expect(typeof globalThis.setNoteParams).toBe('function');
    });

    it('should have playNotes function', () => {
      expect(typeof globalThis.playNotes).toBe('function');
    });

    it('should have playNotes2 function', () => {
      expect(typeof globalThis.playNotes2).toBe('function');
    });
  });

  describe('CSV Output', () => {
    it('should have c (csvRows) array', () => {
      expect(Array.isArray(globalThis.c)).toBe(true);
    });

    it('should be empty initially', () => {
      expect(globalThis.c.length).toBe(0);
    });
  });

  describe('Instrument Variables', () => {
    it('should have primaryInstrument defined', () => {
      expect(globalThis.primaryInstrument).toBeDefined();
    });

    it('should have bassInstrument defined', () => {
      expect(globalThis.bassInstrument).toBeDefined();
    });

    it('should have drumSets array', () => {
      expect(Array.isArray(globalThis.drumSets)).toBe(true);
    });
  });
});
      expect(globalThis.primaryInstrument).toBeDefined();
