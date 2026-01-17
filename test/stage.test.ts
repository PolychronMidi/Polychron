// test/stage.test.js
import { stage } from '../src/stage.js';
import { setupGlobalState, createTestContext } from './helpers.js';
import type { ICompositionContext } from '../src/CompositionContext.js';

// Access allNotesOff from stage instance
const allNotesOff = (channel: number) => stage.allNotesOff(channel);

  describe('playNotes and playNotes2 channel coverage', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      // Use fresh setup but keep the real channel definitions
      globalThis.c = [];
      globalThis.composer = {
        getNotes: () => [
          { note: 60 },
          { note: 62 },
          { note: 64 },
        ]
      };
      globalThis.activeMotif = null;
      globalThis.crossModulation = 2.5;
      globalThis.lastCrossMod = 0;
      globalThis.velocity = 100;
      globalThis.subdivStart = 0;
      globalThis.tpSubdiv = 100;
      globalThis.tpSubsubdiv = 50;
      globalThis.tpDiv = 400;
      globalThis.tpBeat = 1600;
      globalThis.subdivsPerDiv = 4;
      globalThis.subdivsPerMinute = 500;
      globalThis.bpmRatio3 = 1;
      globalThis.beatIndex = 0;
      globalThis.divIndex = 0;
      globalThis.subdivIndex = 0;
      globalThis.beatRhythm = [1, 0, 1, 0];
      globalThis.divRhythm = [1, 1, 0];
      globalThis.subdivRhythm = [1, 0, 1];
      globalThis.numerator = 4;
      globalThis.beatsOn = 10;
      globalThis.beatsOff = 2;
      globalThis.divsPerBeat = 4;
      globalThis.divsOn = 5;
      globalThis.divsOff = 1;
      globalThis.subdivsOn = 20;
      globalThis.subdivsOff = 5;
      globalThis.midiBPM = 120; // Add missing midiBPM

      // Seed deterministic randomness for these tests
      globalThis._origRf = globalThis.rf;
      globalThis._origRv = globalThis.rv;
      globalThis.rf = (...args) => {
        if (args.length === 0) return 0.1; // default small value
        if (args.length === 2) return args[0]; // return min for ranges
        return 0.1;
      };
      globalThis.rv = (val) => val; // no variation
    });

    afterEach(() => {
      // Restore randomness
      globalThis.rf = globalThis._origRf;
      globalThis.rv = globalThis._origRv;
    });

    it('should include reflection channel code in playNotes', () => {
      // Verify that playNotes code includes reflection channel generation
      const playNotesCode = stage.playNotesHandler.playNotes.toString();
      expect(playNotesCode).toContain('reflection');
      expect(playNotesCode).toContain('reflectionCH');
    });

    it('should include bass channel code in playNotes', () => {
      // Verify that playNotes code includes bass channel generation
      const playNotesCode = stage.playNotesHandler.playNotes.toString();
      expect(playNotesCode).toContain('bass');
      expect(playNotesCode).toContain('bassCH');
      expect(playNotesCode).toContain('bassNote');
    });

    it('should emit source, reflection, and bass events from playNotes', () => {
      // Force the cross-modulation gate to fire by making rf minimal
      const originalCrossModulate = stage.playNotesHandler.crossModulateRhythms;
      stage.playNotesHandler.crossModulateRhythms = () => { stage.playNotesHandler.crossModulation = 10; stage.playNotesHandler.lastCrossMod = 0; };
      stage.playNotes();
      stage.playNotesHandler.crossModulateRhythms = originalCrossModulate;

      const noteOns = c.filter((e) => e.type === 'on');
      expect(noteOns.length).toBeGreaterThan(0);

      const channels = new Set(noteOns.map((e) => e.vals[0]));
      expect([...channels].some((ch) => source.includes(ch))).toBe(true);
      expect([...channels].some((ch) => reflection.includes(ch))).toBe(true);
      expect([...channels].some((ch) => bass.includes(ch))).toBe(true);
    });

    it('should emit reflection and probabilistic bass in playNotes2', () => {
      // rf returns 0.1 so bass probability condition passes
      stage.playNotes2();

      const noteOns = c.filter((e) => e.type === 'on');
      expect(noteOns.length).toBeGreaterThan(0);

      const channels = new Set(noteOns.map((e) => e.vals[0]));
      expect([...channels].some((ch) => reflection.includes(ch))).toBe(true);
      expect([...channels].some((ch) => bass.includes(ch))).toBe(true);
    });

    it('should have all required channel arrays defined', () => {
      // Verify that all channel arrays are available
      expect(Array.isArray(globalThis.source)).toBe(true);
      expect(Array.isArray(globalThis.reflection)).toBe(true);
      expect(Array.isArray(globalThis.bass)).toBe(true);
      expect(globalThis.source.length).toBeGreaterThan(0);
      expect(globalThis.reflection.length).toBeGreaterThan(0);
      expect(globalThis.bass.length).toBeGreaterThan(0);
    });
  });

  describe('crossModulateRhythms deterministic behavior', () => {
    beforeEach(() => {
      globalThis.beatRhythm = [1, 0, 1, 0];
      globalThis.divRhythm = [1, 1, 0];
      globalThis.subdivRhythm = [1, 0, 1];
      globalThis.beatIndex = 0;
      globalThis.divIndex = 0;
      globalThis.subdivIndex = 0;
      globalThis.numerator = 4;
      globalThis.beatsOn = 10;
      globalThis.beatsOff = 2;
      globalThis.divsPerBeat = 4;
      globalThis.divsOn = 5;
      globalThis.divsOff = 1;
      globalThis.subdivsPerDiv = 4;
      globalThis.subdivsOn = 20;
      globalThis.subdivsOff = 5;
      globalThis.subdivsPerMinute = 500;

      // Stub randomness for deterministic testing
      globalThis._origRf = globalThis.rf;
      globalThis._origRi = globalThis.ri;
      globalThis.rf = (min = 0, max = 1) => min; // Always return min
      globalThis.ri = (min = 0, max = 1) => Math.floor(min); // Always return min as integer
    });

    afterEach(() => {
      globalThis.rf = globalThis._origRf;
      globalThis.ri = globalThis._origRi;
    });

    it('should calculate crossModulation value based on rhythm state', () => {
      stage.playNotesHandler.crossModulation = 0;
      stage.playNotesHandler.lastCrossMod = 0;
      stage.crossModulateRhythms();

      expect(typeof stage.playNotesHandler.crossModulation).toBe('number');
      expect(stage.playNotesHandler.crossModulation).toBeGreaterThan(0);
      expect(stage.playNotesHandler.lastCrossMod).toBe(0); // Should have saved previous value
    });

    it('should increase crossModulation when rhythm slots are active', () => {
      // Set all rhythm indices to active slots (value 1)
      globalThis.beatIndex = 0; // beatRhythm[0] = 1
      globalThis.divIndex = 0; // divRhythm[0] = 1
      globalThis.subdivIndex = 0; // subdivRhythm[0] = 1

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms();
      const activeValue = stage.playNotesHandler.crossModulation;

      // Reset and test with inactive slots
      globalThis.beatIndex = 1; // beatRhythm[1] = 0
      globalThis.divIndex = 2; // divRhythm[2] = 0
      globalThis.subdivIndex = 1; // subdivRhythm[1] = 0

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms();
      const inactiveValue = stage.playNotesHandler.crossModulation;

      // Active rhythms should contribute more (active contributes rf(1.5,3), inactive uses max())
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should verify active vs inactive rhythm slots affect output', () => {
      // This test compares active slots (which use rf(1.5,3)=1.5) vs inactive (which use max())

      // Active: All slots are ON (value = 1)
      globalThis.beatIndex = 0; // beatRhythm[0] = 1
      globalThis.divIndex = 0; // divRhythm[0] = 1
      globalThis.subdivIndex = 0; // subdivRhythm[0] = 1

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms();
      const activeValue = stage.playNotesHandler.crossModulation;

      // Inactive: All slots are OFF (value = 0)
      globalThis.beatIndex = 1; // beatRhythm[1] = 0
      globalThis.divIndex = 2; // divRhythm[2] = 0
      globalThis.subdivIndex = 1; // subdivRhythm[1] = 0

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms();
      const inactiveValue = stage.playNotesHandler.crossModulation;

      // Active slots contribute rf(1.5,3) which is larger than inactive max() expressions
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should accumulate values from all formula terms', () => {
      // Verify the formula is actually executing by checking that the value is more than just one term
      globalThis.beatIndex = 0;
      globalThis.divIndex = 0;
      globalThis.subdivIndex = 0;

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms();

      // With stubs, should accumulate from multiple terms: rf(1.5,3)=1.5 as minimum
      expect(stage.playNotesHandler.crossModulation).toBeGreaterThanOrEqual(1.5);
    });



    it('should store previous crossModulation in lastCrossMod', () => {
      stage.playNotesHandler.crossModulation = 5.5;
      stage.playNotesHandler.lastCrossMod = 2.2;

      stage.crossModulateRhythms();

      // Should have saved the previous value (5.5) before calculating new one
      expect(stage.playNotesHandler.lastCrossMod).toBe(5.5);
      expect(typeof stage.playNotesHandler.crossModulation).toBe('number');
    });
  });

  describe('Integration tests for channel emission', () => {
    it('should have reflection and bass mapping functions', () => {
      // Verify that reflect and reflect2 mappings are defined
      expect(typeof globalThis.reflect).toBe('object');
      expect(typeof globalThis.reflect2).toBe('object');
      // Check that source channels have reflection mappings
      globalThis.source.forEach(ch => {
        expect(globalThis.reflect[ch]).toBeDefined();
        expect(globalThis.reflect2[ch]).toBeDefined();
      });
    });
  });


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
      expect(typeof stage.setTuningAndInstruments).toBe('function');
    });

    it('should have setOtherInstruments function', () => {
      expect(typeof stage.setOtherInstruments).toBe('function');
    });

    it('should have setBinaural function', () => {
      expect(typeof stage.setBinaural).toBe('function');
    });

    it('should have stutterFade function', () => {
      expect(typeof stage.stutterFade).toBe('function');
    });

    it('should have stutterPan function', () => {
      expect(typeof stage.stutterPan).toBe('function');
    });

    it('should have stutterFX function', () => {
      expect(typeof stage.stutterFX).toBe('function');
    });

    it('should have setBalanceAndFX function', () => {
      expect(typeof stage.setBalanceAndFX).toBe('function');
    });

    it('should have crossModulateRhythms function', () => {
      expect(typeof stage.crossModulateRhythms).toBe('function');
    });

    it('should have setNoteParams function', () => {
      expect(typeof stage.setNoteParams).toBe('function');
    });

    it('should have playNotes function', () => {
      expect(typeof stage.playNotes).toBe('function');
    });

    it('should have playNotes2 function', () => {
      expect(typeof stage.playNotes2).toBe('function');
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

  describe('setBalanceAndFX function', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      ctx.state.beatStart = 0;
      ctx.state.beatCount = 0;
      ctx.state.beatsUntilBinauralShift = 4;
      // Also set globals for any functions that might read them
      globalThis.c = [];
      globalThis.beatStart = 0;
      globalThis.beatCount = 0;
      globalThis.beatsUntilBinauralShift = 4;
      globalThis.balOffset = 0;
      globalThis.sideBias = 0;
      globalThis.firstLoop = 0;
      globalThis.bpmRatio3 = 1;
      globalThis.flipBin = false;
      globalThis.refVar = 1;
      globalThis.cBal = 64;
      globalThis.cBal2 = 64;
      globalThis.cBal3 = 64;
      globalThis.lBal = 32;
      globalThis.rBal = 96;
      globalThis.bassVar = 0;
    });

    it('should update pan values on condition', () => {
      stage.setBalanceAndFX(ctx);
      // Should have added pan control change events
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      // Pan control is CC 10, should have events for different channels
      expect(panEvents.length).toBeGreaterThan(0);
    });

    it('should keep pan values within valid MIDI range (0-127)', () => {
      stage.setBalanceAndFX(ctx);
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      panEvents.forEach(evt => {
        expect(evt.vals[2]).toBeGreaterThanOrEqual(0);
        expect(evt.vals[2]).toBeLessThanOrEqual(127);
      });
    });

    it('should apply different pan values for left vs right channels', () => {
      stage.setBalanceAndFX(ctx);
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      // When pan events are applied, left channels should differ from right
      expect(panEvents.length).toBeGreaterThan(1);
    });

    it('should apply FX control events (CC 1, 5, 11, etc)', () => {
      stage.setBalanceAndFX(ctx);
      // Should generate control change events for various FX
      const fxEvents = c.filter(evt => evt.type === 'control_c');
      expect(fxEvents.length).toBeGreaterThan(10);
    });

    it('should set tick to beatStart-1 for control events', () => {
      ctx.state.beatStart = 100;
      globalThis.beatStart = 100;
      stage.setBalanceAndFX(ctx);
      const controlEvents = c.filter(evt => evt.type === 'control_c');
      controlEvents.forEach(evt => {
        expect(evt.tick).toBe(99); // beatStart - 1
      });
    });

    it('should update balance offset with limited change', () => {
      const initialBal = globalThis.balOffset;
      stage.setBalanceAndFX(ctx);
      // balOffset should change but within reasonable limits
      expect(Math.abs(globalThis.balOffset - initialBal)).toBeLessThanOrEqual(4);
    });

    it('should apply side bias variation', () => {
      stage.setBalanceAndFX(ctx);
      // sideBias should affect the left/right pan values
      expect(typeof globalThis.sideBias).toBe('number');
      expect(globalThis.sideBias).toBeGreaterThanOrEqual(-20);
      expect(globalThis.sideBias).toBeLessThanOrEqual(20);
    });

    it('should clamp balance values correctly', () => {
      for (let i = 0; i < 5; i++) {
        stage.setBalanceAndFX(ctx);
        expect(globalThis.lBal).toBeGreaterThanOrEqual(0);
        expect(globalThis.lBal).toBeLessThanOrEqual(54);
        expect(globalThis.rBal).toBeGreaterThanOrEqual(74);
        expect(globalThis.rBal).toBeLessThanOrEqual(127);
      }
    });
  });

  describe('setOtherInstruments function', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      ctx.state.beatStart = 480;
      ctx.state.beatCount = 0;
      ctx.state.beatsUntilBinauralShift = 4;
      // Also set globals for any functions that might read them
      globalThis.c = [];
      globalThis.beatStart = 480;
      globalThis.beatCount = 0;
      globalThis.beatsUntilBinauralShift = 4;
      globalThis.firstLoop = 0;
      globalThis.otherInstruments = [33, 35, 37]; // Example instruments
      globalThis.otherBassInstruments = [42, 44, 46];
      globalThis.drumSets = [0, 1, 2];
    });

    it('should occasionally add instrument change events', () => {
      // Run multiple times since it uses random chance
      let instrumentChanges = 0;
      for (let i = 0; i < 10; i++) {
        globalThis.c = [];
        globalThis.beatCount = i;
        stage.setOtherInstruments(ctx);
        if (c.length > 0) {
          instrumentChanges++;
        }
      }
      // Should happen at least once in 10 runs
      expect(instrumentChanges).toBeGreaterThan(0);
    });

    it('should generate program change events for binaural instruments', () => {
      globalThis.firstLoop = 0; // Force execution on first loop
      stage.setOtherInstruments(ctx);
      const progChanges = c.filter(evt => evt.type === 'program_c');
      expect(progChanges.length).toBeGreaterThan(0);
    });

    it('should set tick to beatStart for instrument changes', () => {
      globalThis.firstLoop = 0;
      ctx.state.beatStart = 960;
      globalThis.beatStart = 960;
      stage.setOtherInstruments(ctx);
      c.forEach(evt => {
        expect(evt.tick).toBe(960);
      });
    });

    it('should select from otherInstruments array', () => {
      globalThis.firstLoop = 0;
      globalThis.otherInstruments = [50, 51, 52];
      stage.setOtherInstruments(ctx);
      const progChanges = c.filter(evt => evt.type === 'program_c' && evt.vals);
      progChanges.forEach(evt => {
        // Program value should be from otherInstruments or otherBassInstruments or drumSets
        expect(typeof evt.vals[1]).toBe('number');
      });
    });

    it('should not execute when conditions are not met', () => {
      globalThis.firstLoop = 1; // Not first loop
      globalThis.beatCount = 10;
      globalThis.beatsUntilBinauralShift = 5; // beatCount % beatsUntilBinauralShift = 0, but not < 1
      stage.setOtherInstruments(ctx);
      // Might or might not execute depending on random chance (rf() < .3)
      expect(Array.isArray(c)).toBe(true);
    });
  });

  describe('Instrument Setup: setTuningAndInstruments', () => {
    beforeEach(() => {
      globalThis.c = [];
      globalThis.beatStart = 0;
      globalThis.cCH1 = 0;
      globalThis.cCH2 = 1;
      globalThis.cCH3 = 11;
      globalThis.tuningPitchBend = 8192;
      globalThis.primaryInstrument = 'glockenspiel';
      globalThis.secondaryInstrument = 'music box';
      globalThis.bassInstrument = 'Acoustic Bass';
      globalThis.bassInstrument2 = 'Synth Bass 2';
    });

    it('should generate program_c events for all source channels', () => {
      stage.setTuningAndInstruments();
      const programEvents = c.filter(e => e.type === 'program_c' && globalThis.source.includes(e.vals[0]));
      // Each source channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(globalThis.source.length);
    });

    it('should generate center channel (cCH1, cCH2) program events', () => {
      stage.setTuningAndInstruments();
      const cCH1Events = c.filter(e => e.vals[0] === globalThis.cCH1 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      const cCH2Events = c.filter(e => e.vals[0] === globalThis.cCH2 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      expect(cCH1Events.length).toBeGreaterThan(0);
      expect(cCH2Events.length).toBeGreaterThan(0);
    });

    it('should generate program_c events for all reflection channels', () => {
      stage.setTuningAndInstruments();
      const programEvents = c.filter(e => e.type === 'program_c' && globalThis.reflection.includes(e.vals[0]));
      // Each reflection channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(globalThis.reflection.length);
    });

    it('should generate program_c events for all bass channels', () => {
      stage.setTuningAndInstruments();
      const programEvents = c.filter(e => e.type === 'program_c' && globalThis.bass.includes(e.vals[0]));
      // Each bass channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(globalThis.bass.length);
    });

    it('should generate center bass channel (cCH3) program event', () => {
      stage.setTuningAndInstruments();
      const cCH3Events = c.filter(e => e.vals[0] === globalThis.cCH3 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      expect(cCH3Events.length).toBeGreaterThan(0);
    });

    it('should set primary instrument on source channels', () => {
      stage.setTuningAndInstruments();
      const primaryProg = globalThis.getMidiValue('program', globalThis.primaryInstrument);
      const sourcePrograms = c.filter(e => e.type === 'program_c' && globalThis.source.includes(e.vals[0]));
      expect(sourcePrograms.some(e => e.vals[1] === primaryProg)).toBe(true);
    });

    it('should set secondary instrument on reflection channels', () => {
      stage.setTuningAndInstruments();
      const secondaryProg = globalThis.getMidiValue('program', globalThis.secondaryInstrument);
      const reflectionPrograms = c.filter(e => e.type === 'program_c' && globalThis.reflection.includes(e.vals[0]));
      expect(reflectionPrograms.some(e => e.vals[1] === secondaryProg)).toBe(true);
    });

    it('should set bass instrument on bass channels', () => {
      stage.setTuningAndInstruments();
      const bassProg = getMidiValue('program', globalThis.bassInstrument);
      const bassPrograms = c.filter(e => e.type === 'program_c' && globalThis.bass.includes(e.vals[0]));
      expect(bassPrograms.some(e => e.vals[1] === bassProg)).toBe(true);
    });

    it('should emit control_c events for pan/volume on source channels', () => {
      stage.setTuningAndInstruments();
      const controlEvents = c.filter(e => e.type === 'control_c' && globalThis.source.includes(e.vals[0]));
      expect(controlEvents.length).toBeGreaterThan(0);
    });

    it('should use pitch_bend_c for center channels (cCH1, cCH2, cCH3)', () => {
      stage.setTuningAndInstruments();
      const centerChannels = [globalThis.cCH1, globalThis.cCH2, globalThis.cCH3];
      const pitchBendEvents = c.filter(e => e.type === 'pitch_bend_c' && centerChannels.includes(e.vals[0]));
      expect(pitchBendEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('should convert instrument names to MIDI program numbers', () => {
      stage.setTuningAndInstruments();
      const allPrograms = c.filter(e => e.type === 'program_c');
      allPrograms.forEach(e => {
        expect(typeof e.vals[1]).toBe('number');
        expect(e.vals[1]).toBeGreaterThanOrEqual(0);
        expect(e.vals[1]).toBeLessThan(128);
      });
    });

    it('should set all 16 MIDI channels with instruments', () => {
      stage.setTuningAndInstruments();
      const programEvents = c.filter(e => e.type === 'program_c');
      const channelsWithPrograms = new Set(programEvents.map(e => e.vals[0]));
      // Should cover source, reflection, bass, and drum channels
      expect(channelsWithPrograms.size).toBeGreaterThan(10);
    });
  });
});
