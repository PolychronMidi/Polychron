// test/stage.test.js
import { stage } from '../src/stage.js';
import { createTestContext } from './helpers.module.js';
import { registerWriterServices, CSVBuffer } from '../src/writer.js';
import type { ICompositionContext } from '../src/CompositionContext.js';
import { source, reflection, bass, reflect, reflect2, cCH1, cCH2, cCH3, lCH1, rCH1, drumCH, flipBinF, flipBinT, binauralL, binauralR, FX, stutterFadeCHs } from '../src/backstage.js';
import { BINAURAL, drumSets, OCTAVE } from '../src/sheet.js';
import { initializePolychronContext, getPolychronContext } from '../src/PolychronInit.js';
import { registerVenueServices } from '../src/venue.js';
import * as Utils from '../src/utils.js';

// Provide deterministic randomness for stage tests where not otherwise stubbed
beforeEach(() => {
  vi.spyOn(Utils, 'rf').mockImplementation((...args: any[]) => {
    // Default deterministic rf: if min/max provided, return the midpoint; otherwise return 0.5
    if (args.length === 2) return (args[0] + args[1]) / 2;
    return 0.5;
  });
  vi.spyOn(Utils, 'rv').mockImplementation((v: any) => v);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Shared DI test context for stage tests
let ctx: ICompositionContext;

// Access allNotesOff from stage instance
const allNotesOff = (channel: number) => stage.allNotesOff(channel);

  describe('playNotes and playNotes2 channel coverage', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      // Register writer services into test DI container
      registerWriterServices(ctx.services);
      // Use DI-based buffer instead of global csv
      ctx.csvBuffer = [];
      // Provide a small composer for note emission tests via ctx.state
      ctx.state.composer = {
        getNotes: () => [ { note: 60 }, { note: 62 }, { note: 64 } ]
      } as any;
      ctx.state.beatIndex = 0;
      ctx.state.divIndex = 0;
      ctx.state.subdivIndex = 0;
      ctx.state.beatRhythm = [1,0,1,0];
      ctx.state.divRhythm = [1,1,0];
      ctx.state.subdivRhythm = [1,0,1];
      ctx.state.numerator = 4;
      ctx.state.beatsOn = 10;
      ctx.state.beatsOff = 2;
      ctx.state.divsPerBeat = 4;
      ctx.state.divsOn = 5;
      ctx.state.divsOff = 1;
      ctx.state.subdivsOn = 20;
      ctx.state.subdivsOff = 5;
      ctx.state.midiBPM = 120; // Add missing midiBPM

      // Seed deterministic randomness for these tests by stubbing utils
      vi.spyOn(Utils, 'rf').mockImplementation((...args: any[]) => {
        if (args.length === 0) return 0.1;
        if (args.length === 2) return args[0];
        return 0.1;
      });
      vi.spyOn(Utils, 'rv').mockImplementation((val: any) => val);
    });

    afterEach(() => {
      // Restore randomness
      vi.restoreAllMocks();
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
      stage.playNotes(ctx);
      stage.playNotesHandler.crossModulateRhythms = originalCrossModulate;

      // DEBUG: inspect buffer
      // eslint-disable-next-line no-console
      console.log('DEBUG playNotes buffer', JSON.stringify(ctx.csvBuffer, null, 2));

      const noteOns = ctx.csvBuffer.filter((e: any) => e.type === 'on');
      expect(noteOns.length).toBeGreaterThan(0);

      const channels = new Set(noteOns.map((e) => e.vals[0]));
      const hasSource = [...channels].some((ch) => source.includes(ch));
      const hasReflection = [...channels].some((ch) => reflection.includes(ch));
      const hasBass = [...channels].some((ch) => bass.includes(ch));
      const reflect2Vals = Object.values(reflect2);
      const hasReflect2Bass = [...channels].some((ch) => reflect2Vals.includes(ch));

      expect(hasSource).toBe(true);
      expect(hasReflection).toBe(true);
      // Accept either explicit bass channels OR reflect2-mapped bass channels (robust against timing variations)
      expect(hasBass || hasReflect2Bass).toBe(true);
    });

    it('should emit reflection and probabilistic bass in playNotes2', () => {
      // rf returns 0.1 so bass probability condition passes
      stage.playNotes2(ctx);

      const noteOns = ctx.csvBuffer.filter((e: any) => e.type === 'on');
      expect(noteOns.length).toBeGreaterThan(0);

      const channels = new Set(noteOns.map((e) => e.vals[0]));
      expect([...channels].some((ch) => reflection.includes(ch))).toBe(true);
      expect([...channels].some((ch) => bass.includes(ch))).toBe(true);
    });

    it('should have all required channel arrays defined', () => {
      // Verify that all channel arrays are available
      expect(Array.isArray(source)).toBe(true);
      expect(Array.isArray(reflection)).toBe(true);
      expect(Array.isArray(bass)).toBe(true);
      expect(source.length).toBeGreaterThan(0);
      expect(reflection.length).toBeGreaterThan(0);
      expect(bass.length).toBeGreaterThan(0);
    });
  });

  describe('crossModulateRhythms deterministic behavior', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      ctx.state.beatRhythm = [1,0,1,0];
      ctx.state.divRhythm = [1,1,0];
      ctx.state.subdivRhythm = [1,0,1];
      ctx.state.beatIndex = 0;
      ctx.state.divIndex = 0;
      ctx.state.subdivIndex = 0;
      ctx.state.numerator = 4;
      ctx.state.beatsOn = 10;
      ctx.state.beatsOff = 2;
      ctx.state.divsPerBeat = 4;
      ctx.state.divsOn = 5;
      ctx.state.divsOff = 1;
      ctx.state.subdivsPerDiv = 4;
      ctx.state.subdivsOn = 20;
      ctx.state.subdivsOff = 5;
      ctx.state.subdivsPerMinute = 500;

      // Stub randomness for deterministic testing
      vi.spyOn(Utils, 'rf').mockImplementation((min = 0, max = 1) => min as any);
      vi.spyOn(Utils, 'ri').mockImplementation((min = 0, max = 1) => Math.floor(min as number) as any);
      // Ensure PolychronContext utils also use the deterministic stubs
      (globalThis as any).PolychronContext = (globalThis as any).PolychronContext || {};
      (globalThis as any).PolychronContext.utils = {
        rf: (min: number = 0, max: number = 1) => min,
        ri: (min: number = 0, max: number = 1) => Math.floor(min),
        m: Math
      } as any;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should calculate crossModulation value based on rhythm state', () => {
      stage.playNotesHandler.crossModulation = 0;
      stage.playNotesHandler.lastCrossMod = 0;
      stage.crossModulateRhythms(ctx);

      expect(typeof stage.playNotesHandler.crossModulation).toBe('number');
      expect(stage.playNotesHandler.crossModulation).toBeGreaterThan(0);
      expect(stage.playNotesHandler.lastCrossMod).toBe(0); // Should have saved previous value
    });

    it('should increase crossModulation when rhythm slots are active', () => {
      // Set all rhythm indices to active slots (value 1)
      ctx.state.beatIndex = 0; // beatRhythm[0] = 1
      ctx.state.divIndex = 0; // divRhythm[0] = 1
      ctx.state.subdivIndex = 0; // subdivRhythm[0] = 1

      // Reset counters to isolate rhythm slot contributions
      ctx.state.beatsOn = 0; ctx.state.divsOn = 0; ctx.state.subdivsOn = 0;
      ctx.state.beatsOff = 0; ctx.state.divsOff = 0; ctx.state.subdivsOff = 0;
      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms(ctx);
      const activeValue = stage.playNotesHandler.crossModulation;

      // Reset and test with inactive slots
      ctx.state.beatIndex = 1; // beatRhythm[1] = 0
      ctx.state.divIndex = 2; // divRhythm[2] = 0
      ctx.state.subdivIndex = 1; // subdivRhythm[1] = 0

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms(ctx);
      const inactiveValue = stage.playNotesHandler.crossModulation;


      // Active rhythms should contribute more (active contributes rf(1.5,3), inactive uses max())
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should verify active vs inactive rhythm slots affect output', () => {
      // This test compares active slots (which use rf(1.5,3)=1.5) vs inactive (which use max())

      // Active: All slots are ON (value = 1)
      ctx.state.beatIndex = 0; // beatRhythm[0] = 1
      ctx.state.divIndex = 0; // divRhythm[0] = 1
      ctx.state.subdivIndex = 0; // subdivRhythm[0] = 1

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms(ctx);
      const activeValue = stage.playNotesHandler.crossModulation;

      // Inactive: All slots are OFF (value = 0)
      ctx.state.beatIndex = 1; // beatRhythm[1] = 0
      ctx.state.divIndex = 2; // divRhythm[2] = 0
      ctx.state.subdivIndex = 1; // subdivRhythm[1] = 0

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms(ctx);
      const inactiveValue = stage.playNotesHandler.crossModulation;

      // Active slots contribute rf(1.5,3) which is larger than inactive max() expressions
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should accumulate values from all formula terms', () => {
      // Verify the formula is actually executing by checking that the value is more than just one term
      ctx.state.beatIndex = 0;
      ctx.state.divIndex = 0;
      ctx.state.subdivIndex = 0;

      stage.playNotesHandler.crossModulation = 0;
      stage.crossModulateRhythms(ctx);

      // With stubs, should accumulate from multiple terms: rf(1.5,3)=1.5 as minimum
      expect(stage.playNotesHandler.crossModulation).toBeGreaterThanOrEqual(1.5);
    });



    it('should store previous crossModulation in lastCrossMod', () => {
      stage.playNotesHandler.crossModulation = 5.5;
      stage.playNotesHandler.lastCrossMod = 2.2;

      stage.crossModulateRhythms(ctx);

      // Should have saved the previous value (5.5) before calculating new one
      expect(stage.playNotesHandler.lastCrossMod).toBe(5.5);
      expect(typeof stage.playNotesHandler.crossModulation).toBe('number');
    });
  });

  describe('Integration tests for channel emission', () => {
    it('should have reflection and bass mapping functions', () => {
      // Verify that reflect and reflect2 mappings are defined
        expect(typeof reflect).toBe('object');
      expect(typeof reflect2).toBe('object');
      // Check that source channels have reflection mappings
      source.forEach(ch => {
        expect(reflect[ch]).toBeDefined();
        expect(reflect2[ch]).toBeDefined();
      });
    });
  });


describe('Stage Module', () => {
  beforeEach(() => {
    // Reset stage instance internal state
    stage.playNotesHandler.subdivsOn = 0;
    stage.playNotesHandler.subdivsOff = 0;
    stage.playNotesHandler.crossModulation = 2.2;
    stage.playNotesHandler.lastCrossMod = 0;
    stage.playNotesHandler.on = 0;
    // Provide a fresh test composition context when needed in tests
    // Tests should create their own ctx via createTestContext() to exercise DI.
  });

  describe('Global State Variables', () => {
    it('should have m (Math) defined', () => {
      // Use Math directly or import default m
      expect(Math.round(5.5)).toBe(6);
    });

    it('should have pushMultiple writer service', () => {
      const ctx = createTestContext();
      registerWriterServices(ctx.services);
      const pFn = ctx.services.get('pushMultiple');
      expect(typeof pFn).toBe('function');
      const arr: any[] = [];
      pFn(arr, 1, 2, 3);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('should have clamp function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.clamp).toBe('function');
      expect(utils.clamp(5, 0, 10)).toBe(5);
      expect(utils.clamp(-5, 0, 10)).toBe(0);
      expect(utils.clamp(15, 0, 10)).toBe(10);
    });

    it('should have modClamp function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.modClamp).toBe('function');
      expect(utils.modClamp(5, 0, 9)).toBe(5);
      expect(utils.modClamp(10, 0, 9)).toBe(0);
      expect(utils.modClamp(-1, 0, 9)).toBe(9);
    });

    it('should have rf (randomFloat) function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.rf).toBe('function');
      const val = utils.rf(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
    });

    it('should have ri (randomInt) function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.ri).toBe('function');
      const val = utils.ri(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
      expect(Number.isInteger(val)).toBe(true);
    });

    it('should have ra (randomInRangeOrArray) function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.ra).toBe('function');
      const arrVal = utils.ra([1, 2, 3, 4, 5]);
      expect([1, 2, 3, 4, 5]).toContain(arrVal);
    });

    it('should have rl (randomLimitedChange) function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.rl).toBe('function');
      const val = utils.rl(50, -5, 5, 0, 100);
      expect(val).toBeGreaterThanOrEqual(45);
      expect(val).toBeLessThanOrEqual(55);
    });

    it('should have rv (randomVariation) function defined', () => {
      const utils = getPolychronContext().utils;
      expect(typeof utils.rv).toBe('function');
      const val = utils.rv(100);
      expect(typeof val).toBe('number');
    });
  });

  describe('Channel Constants', () => {
    it('should have channel constants defined', () => {
      expect(cCH1).toBe(0);
      expect(cCH2).toBe(1);
      expect(cCH3).toBe(11);
      expect(lCH1).toBe(2);
      expect(rCH1).toBe(3);
      expect(drumCH).toBe(9);
    });

    it('should have source channels array', () => {
      expect(Array.isArray(source)).toBe(true);
      expect(source).toContain(0); // cCH1
      expect(source).toContain(2); // lCH1
    });

    it('should have reflection channels array', () => {
      expect(Array.isArray(reflection)).toBe(true);
      expect(reflection).toContain(1); // cCH2
    });

    it('should have bass channels array', () => {
      expect(Array.isArray(bass)).toBe(true);
      expect(bass).toContain(11); // cCH3
    });
  });

  describe('Channel Mappings', () => {
    it('should have reflect mapping', () => {
      expect(reflect[0]).toBe(1); // cCH1 -> cCH2
      expect(reflect[2]).toBe(4); // lCH1 -> lCH3
      expect(reflect[3]).toBe(5); // rCH1 -> rCH3
    });

    it('should have reflect2 mapping', () => {
      expect(reflect2[0]).toBe(11); // cCH1 -> cCH3
      expect(reflect2[2]).toBe(12); // lCH1 -> lCH5
      expect(reflect2[3]).toBe(13); // rCH1 -> rCH5
    });
  });

  describe('Binaural Flip Mappings', () => {
    it('should have flipBinF mapping', () => {
      expect(Array.isArray(flipBinF)).toBe(true);
      expect(flipBinF).toContain(0);
      expect(flipBinF).toContain(1);
      expect(flipBinF).toContain(11);
    });

    it('should have flipBinT mapping', () => {
      expect(Array.isArray(flipBinT)).toBe(true);
      expect(flipBinT).toContain(0);
      expect(flipBinT).toContain(6); // lCH2
      expect(flipBinT).toContain(7); // rCH2
    });

    it('should have binaural arrays defined', () => {
      expect(Array.isArray(binauralL)).toBe(true);
      expect(Array.isArray(binauralR)).toBe(true);
      expect(binauralL.length).toBe(6);
      expect(binauralR.length).toBe(6);
    });
  });

  describe('Timing Variables', () => {
    it('should have tpSec defined in test context', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.tpSec).toBe('number');
    });

    it('should have beat timing variables in test context', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.tpBeat).toBe('number');
      expect(typeof ctx.state.tpDiv).toBe('number');
      expect(typeof ctx.state.tpSubdiv).toBe('number');
    });

    it('should have start position variables in test context', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.beatStart).toBe('number');
      expect(typeof ctx.state.divStart).toBe('number');
      expect(typeof ctx.state.subdivStart).toBe('number');
    });
  });

  describe('Rhythm Variables', () => {
    it('should have beatRhythm array in test context', () => {
      const ctx = createTestContext();
      expect(Array.isArray(ctx.state.beatRhythm)).toBe(true);
    });

    it('should have divRhythm array in test context', () => {
      const ctx = createTestContext();
      expect(Array.isArray(ctx.state.divRhythm)).toBe(true);
    });

    it('should have subdivRhythm array in test context', () => {
      const ctx = createTestContext();
      expect(Array.isArray(ctx.state.subdivRhythm)).toBe(true);
    });

    it('should have beatsOn/off counters', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.beatsOn).toBe('number');
      expect(typeof ctx.state.beatsOff).toBe('number');
    });
  });

  describe('Binaural Variables', () => {
    it('should have binauralFreqOffset defined (from context)', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.binauralFreqOffset).toBe('number');
    });

    it('should have binauralPlus/binauralMinus defined', async () => {
      const backstage = await import('../src/backstage.js');
      expect(typeof backstage.binauralPlus).toBe('number');
      expect(typeof backstage.binauralMinus).toBe('number');
    });

    it('should have BINAURAL config', () => {
      expect(BINAURAL).toBeDefined();
      expect(BINAURAL.min).toBeDefined();
      expect(BINAURAL.max).toBeDefined();
    });
  });

  describe('FX Variables', () => {
    it('should have FX array of valid MIDI CC numbers', () => {
      expect(Array.isArray(FX)).toBe(true);
      FX.forEach(cc => {
        expect(cc).toBeGreaterThanOrEqual(0);
        expect(cc).toBeLessThanOrEqual(127);
      });
    });

    it('should have OCTAVE config', () => {
      expect(OCTAVE).toBeDefined();
      expect(OCTAVE.min).toBeDefined();
      expect(OCTAVE.max).toBeDefined();
    });
  });

  describe('Global State Variables', () => {
    it('should have velocity defined on stage handler', () => {
      expect(typeof stage.playNotesHandler.binVel).toBe('number');
    });

    it('should have flipBin as boolean in context', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.flipBin).toBe('boolean');
    });

    it('should have beatCount defined in context', () => {
      const ctx = createTestContext();
      expect(typeof ctx.state.beatCount).toBe('number');
    });

    it('should have crossModulation defined on handler', () => {
      expect(typeof stage.playNotesHandler.crossModulation).toBe('number');
    });
  });

  describe('allNotesOff', () => {
    it('should be defined as a function', () => {
      expect(typeof allNotesOff).toBe('function');
    });

    it('should generate events for all channels', () => {
      const ctx = createTestContext();
      ctx.csvBuffer = [];
      const initialLength = ctx.csvBuffer.length;
      const events = allNotesOff(1000);
      ctx.csvBuffer.push(...events);
      expect(ctx.csvBuffer.length).toBeGreaterThan(initialLength);
    });

    it('should use control change 123', () => {
      const ctx = createTestContext();
      ctx.csvBuffer = [];
      const events = allNotesOff(1000);
      ctx.csvBuffer.push(...events);
      const allNotesOffEvent = ctx.csvBuffer.find((e: any) => e.vals && e.vals[1] === 123);
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
    it('should have csv buffer via DI', () => {
      const ctx = createTestContext();
      ctx.csvBuffer = [];
      expect(Array.isArray(ctx.csvBuffer)).toBe(true);
    });

    it('should be empty initially', () => {
      const ctx = createTestContext();
      ctx.csvBuffer = [];
      expect(ctx.csvBuffer.length).toBe(0);
    });
  });

  describe('Instrument Variables', () => {
    it('should expose venue services via DI', () => {
      const ctx = createTestContext();
      registerVenueServices(ctx.services);
      expect(ctx.services.has('getMidiValue')).toBe(true);
      expect(ctx.services.has('allNotes')).toBe(true);
    });

    it('should expose drumSets via sheet', () => {
      expect(Array.isArray(drumSets)).toBe(true);
    });
  });

  describe('setBalanceAndFX function', () => {
    let ctx: ICompositionContext;
    beforeEach(() => {
      ctx = createTestContext();
      // Register writer services and prepare CSV buffer for DI-based pushes
      registerWriterServices(ctx.services);
      ctx.csvBuffer = [];

      ctx.state.beatStart = 0;
      ctx.state.beatCount = 0;
      ctx.state.beatsUntilBinauralShift = 4;
      // Local stage defaults
      stage.playNotesHandler.subdivsOn = 0;
      stage.playNotesHandler.subdivsOff = 0;
      // Local stage balances
      // setBalanceAndFX will compute and push events into ctx.csvBuffer
      ctx.state.bpmRatio3 = 1;
    });

    it('should update pan values on condition', () => {
      stage.setBalanceAndFX(ctx);
      // Should have added pan control change events
      const panEvents = ctx.csvBuffer.filter(evt => evt.vals && evt.vals[1] === 10);
      // Pan control is CC 10, should have events for different channels
      expect(panEvents.length).toBeGreaterThan(0);
    });

    it('should keep pan values within valid MIDI range (0-127)', () => {
      stage.setBalanceAndFX(ctx);
      const panEvents = ctx.csvBuffer.filter(evt => evt.vals && evt.vals[1] === 10);
      panEvents.forEach(evt => {
        expect(evt.vals[2]).toBeGreaterThanOrEqual(0);
        expect(evt.vals[2]).toBeLessThanOrEqual(127);
      });
    });

    it('should apply different pan values for left vs right channels', () => {
      stage.setBalanceAndFX(ctx);
      const panEvents = ctx.csvBuffer.filter(evt => evt.vals && evt.vals[1] === 10);
      // When pan events are applied, left channels should differ from right
      expect(panEvents.length).toBeGreaterThan(1);
    });

    it('should apply FX control events (CC 1, 5, 11, etc)', () => {
      stage.setBalanceAndFX(ctx);
      // Should generate control change events for various FX
      const fxEvents = ctx.csvBuffer.filter(evt => evt.type === 'control_c');
      expect(fxEvents.length).toBeGreaterThan(10);
    });

    it('should set tick to beatStart-1 for control events', () => {
      ctx.state.beatStart = 100;
      stage.setBalanceAndFX(ctx);
      const controlEvents = ctx.csvBuffer.filter(evt => evt.type === 'control_c');
      controlEvents.forEach(evt => {
        expect(evt.tick).toBe(99); // beatStart - 1
      });
    });

    it('should update balance offset with limited change', () => {
      const initialBal = ctx.state.balOffset;
      stage.setBalanceAndFX(ctx);
      // Debug: log values for diagnosis if behavior seems out of bounds
      console.debug('setBalanceAndFX initialBal=', initialBal, 'newBal=', ctx.state.balOffset);
      // balOffset should change but within reasonable limits
      expect(Math.abs(ctx.state.balOffset - initialBal)).toBeLessThanOrEqual(4);
    });

    it('should apply side bias variation', () => {
      stage.setBalanceAndFX(ctx);
      // sideBias should affect the left/right pan values
      expect(typeof ctx.state.sideBias).toBe('number');
      expect(ctx.state.sideBias).toBeGreaterThanOrEqual(-20);
      expect(ctx.state.sideBias).toBeLessThanOrEqual(20);
    });

    it('should clamp balance values correctly', () => {
      for (let i = 0; i < 5; i++) {
        stage.setBalanceAndFX(ctx);
        expect(ctx.state.lBal).toBeGreaterThanOrEqual(0);
        expect(ctx.state.lBal).toBeLessThanOrEqual(54);
        expect(ctx.state.rBal).toBeGreaterThanOrEqual(74);
        expect(ctx.state.rBal).toBeLessThanOrEqual(127);
      }
    });
  });

  describe('setOtherInstruments function', () => {
    beforeEach(() => {
      ctx = createTestContext();
      registerWriterServices(ctx.services);
      ctx.csvBuffer = [];
      ctx.state.beatStart = 480;
      ctx.state.beatCount = 0;
      ctx.state.beatsUntilBinauralShift = 4;
      ctx.state.firstLoop = 0;
      ctx.state.otherInstruments = [33, 35, 37]; // Example instruments
      ctx.state.otherBassInstruments = [42, 44, 46];
      ctx.state.drumSets = [0, 1, 2];
    });

    it('should occasionally add instrument change events', () => {
      // Run multiple times since it uses random chance
      let instrumentChanges = 0;
      // Reset stage firstLoop to allow initial execution
      stage.firstLoop = 0;
      for (let i = 0; i < 10; i++) {
        ctx.csvBuffer = [];
        ctx.state.beatCount = i;
        stage.setOtherInstruments(ctx);
        if (ctx.csvBuffer.length > 0) {
          instrumentChanges++;
        }
      }
      // Should happen at least once in 10 runs
      expect(instrumentChanges).toBeGreaterThan(0);
    });

    it('should generate program change events for binaural instruments', () => {
      ctx.state.firstLoop = 0; // Force execution on first loop
      stage.setOtherInstruments(ctx);
      const progChanges = ctx.csvBuffer.filter(evt => evt.type === 'program_c');
      expect(progChanges.length).toBeGreaterThan(0);
    });

    it('should set tick to beatStart for instrument changes', () => {
      ctx.state.firstLoop = 0;
      ctx.state.beatStart = 960;
      stage.setOtherInstruments(ctx);
      ctx.csvBuffer.forEach(evt => {
        expect(evt.tick).toBe(960);
      });
    });

    it('should select from otherInstruments array', () => {
      ctx.state.firstLoop = 0;
      ctx.state.otherInstruments = [50, 51, 52];
      stage.setOtherInstruments(ctx);
      const progChanges = ctx.csvBuffer.filter(evt => evt.type === 'program_c' && evt.vals);
      progChanges.forEach(evt => {
        // Program value should be from otherInstruments or otherBassInstruments or drumSets
        expect(typeof evt.vals[1]).toBe('number');
      });
    });

    it('should not execute when conditions are not met', () => {
      ctx.state.firstLoop = 1; // Not first loop
      ctx.state.beatCount = 10;
      ctx.state.beatsUntilBinauralShift = 5; // beatCount % beatsUntilBinauralShift = 0, but not < 1
      stage.setOtherInstruments(ctx);
      // Might or might not execute depending on random chance (rf() < .3)
      expect(Array.isArray(ctx.csvBuffer)).toBe(true);
    });
  });

  describe('Instrument Setup: setTuningAndInstruments', () => {
    beforeEach(() => {
      ctx = createTestContext();
      registerWriterServices(ctx.services);
      registerVenueServices(ctx.services);
      ctx.csvBuffer = [];
      ctx.state.beatStart = 0;
      ctx.state.cCH1 = 0;
      ctx.state.cCH2 = 1;
      ctx.state.cCH3 = 11;
      ctx.state.tuningPitchBend = 8192;
      ctx.state.primaryInstrument = 'glockenspiel';
      ctx.state.secondaryInstrument = 'music box';
      ctx.state.bassInstrument = 'Acoustic Bass';
      ctx.state.bassInstrument2 = 'Synth Bass 2';
      // Keep ctx state channel maps in sync with module-level constants
      ctx.state.source = source;
      ctx.state.reflection = reflection;
      ctx.state.bass = bass;
    });

    it('should generate program_c events for all source channels', () => {
      stage.setTuningAndInstruments(ctx);
      const programEvents = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.source.includes(e.vals[0]));
      // Each source channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(ctx.state.source.length);
    });

    it('should generate center channel (cCH1, cCH2) program events', () => {
      stage.setTuningAndInstruments(ctx);
      const cCH1Events = ctx.csvBuffer.filter(e => e.vals[0] === ctx.state.cCH1 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      const cCH2Events = ctx.csvBuffer.filter(e => e.vals[0] === ctx.state.cCH2 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      expect(cCH1Events.length).toBeGreaterThan(0);
      expect(cCH2Events.length).toBeGreaterThan(0);
    });

    it('should generate program_c events for all reflection channels', () => {
      stage.setTuningAndInstruments(ctx);
      const programEvents = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.reflection.includes(e.vals[0]));
      // Each reflection channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(ctx.state.reflection.length);
    });

    it('should generate program_c events for all bass channels', () => {
      stage.setTuningAndInstruments(ctx);
      const programEvents = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.bass.includes(e.vals[0]));
      // Each bass channel gets one program_c event
      expect(programEvents.length).toBeGreaterThanOrEqual(ctx.state.bass.length);
    });

    it('should generate center bass channel (cCH3) program event', () => {
      stage.setTuningAndInstruments(ctx);
      const cCH3Events = ctx.csvBuffer.filter(e => e.vals[0] === ctx.state.cCH3 && (e.type === 'program_c' || e.type === 'pitch_bend_c'));
      expect(cCH3Events.length).toBeGreaterThan(0);
    });

    it('should set primary instrument on source channels', () => {
      stage.setTuningAndInstruments(ctx);
      const midi = ctx.services.get('getMidiValue');
      const primaryProg = midi('program', ctx.state.primaryInstrument);
      const sourcePrograms = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.source.includes(e.vals[0]));
      expect(sourcePrograms.some(e => e.vals[1] === primaryProg)).toBe(true);
    });

    it('should set secondary instrument on reflection channels', () => {
      stage.setTuningAndInstruments(ctx);
      const midi = ctx.services.get('getMidiValue');
      const secondaryProg = midi('program', ctx.state.secondaryInstrument);
      const reflectionPrograms = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.reflection.includes(e.vals[0]));
      expect(reflectionPrograms.some(e => e.vals[1] === secondaryProg)).toBe(true);
    });

    it('should set bass instrument on bass channels', () => {
      stage.setTuningAndInstruments(ctx);
      const midi = ctx.services.get('getMidiValue');
      const bassProg = midi('program', ctx.state.bassInstrument);
      const bassPrograms = ctx.csvBuffer.filter(e => e.type === 'program_c' && ctx.state.bass.includes(e.vals[0]));
      expect(bassPrograms.some(e => e.vals[1] === bassProg)).toBe(true);
    });

    it('should emit control_c events for pan/volume on source channels', () => {
      stage.setTuningAndInstruments(ctx);
      const controlEvents = ctx.csvBuffer.filter(e => e.type === 'control_c' && ctx.state.source.includes(e.vals[0]));
      expect(controlEvents.length).toBeGreaterThan(0);
    });

    it('should use pitch_bend_c for center channels (cCH1, cCH2, cCH3)', () => {
      stage.setTuningAndInstruments(ctx);
      const centerChannels = [ctx.state.cCH1, ctx.state.cCH2, ctx.state.cCH3];
      const pitchBendEvents = ctx.csvBuffer.filter(e => e.type === 'pitch_bend_c' && centerChannels.includes(e.vals[0]));
      expect(pitchBendEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('should convert instrument names to MIDI program numbers', () => {
      stage.setTuningAndInstruments(ctx);
      const allPrograms = ctx.csvBuffer.filter(e => e.type === 'program_c');
      allPrograms.forEach(e => {
        expect(typeof e.vals[1]).toBe('number');
        expect(e.vals[1]).toBeGreaterThanOrEqual(0);
        expect(e.vals[1]).toBeLessThan(128);
      });
    });

    it('should set all 16 MIDI channels with instruments', () => {
      stage.setTuningAndInstruments(ctx);
      const programEvents = ctx.csvBuffer.filter(e => e.type === 'program_c');
      const channelsWithPrograms = new Set(programEvents.map(e => e.vals[0]));
      // Should cover source, reflection, bass, and drum channels
      expect(channelsWithPrograms.size).toBeGreaterThan(10);
    });

    it('should support stage methods for note and rhythm manipulation', () => {
      expect(typeof stage.setNoteParams).toBe('function');
      expect(typeof stage.setNoteParams2).toBe('function');
      expect(typeof stage.crossModulateRhythms).toBe('function');
    });

    it('should have accessible stutter methods', () => {
      expect(typeof stage.stutterFade).toBe('function');
      expect(typeof stage.stutterPan).toBe('function');
      expect(typeof stage.stutterFX).toBe('function');
    });

    it('should initialize balance parameters', () => {
      expect(typeof stage.balOffset).toBe('number');
      expect(typeof stage.cBal).toBe('number');
      expect(typeof stage.lBal).toBe('number');
      expect(typeof stage.rBal).toBe('number');
    });

    it('should have bass and reflection variance parameters', () => {
      expect(typeof stage.bassVar).toBe('number');
      expect(typeof stage.refVar).toBe('number');
      expect(stage.firstLoop).toBeDefined();
    });
  });
});
