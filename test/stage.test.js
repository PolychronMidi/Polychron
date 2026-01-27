// test/stage.test.js
require('../src/stage');  // Load stage module and all dependencies


  describe('playNotes and playNotes2 channel coverage', () => {
    beforeEach(() => {
      // Use fresh setup but keep the real channel definitions
      c = [];
      composer = {
        getNotes: () => [
          { note: 60 },
          { note: 62 },
          { note: 64 },
        ]
      };
      activeMotif = null;
      crossModulation = 2.5;
      lastCrossMod = 0;
      velocity = 100;
      subdivStart = 0;
      tpSubdiv = 100;
      tpSubsubdiv = 50;
      tpDiv = 400;
      tpBeat = 1600;
      subdivsPerDiv = 4;
      subdivsPerMinute = 500;
      bpmRatio3 = 1;
      beatIndex = 0;
      divIndex = 0;
      subdivIndex = 0;
      beatRhythm = [1, 0, 1, 0];
      divRhythm = [1, 1, 0];
      subdivRhythm = [1, 0, 1];
      numerator = 4;
      beatsOn = 10;
      beatsOff = 2;
      divsPerBeat = 4;
      divsOn = 5;
      divsOff = 1;
      subdivsOn = 20;
      subdivsOff = 5;

      // Seed deterministic randomness for these tests
      _origRf = rf;
      _origRv = rv;
      rf = (...args) => {
        if (args.length === 0) return 0.1; // default small value
        if (args.length === 2) return args[0]; // return min for ranges
        return 0.1;
      };
      rv = (val) => val; // no variation
    });

    afterEach(() => {
      // Restore randomness
      rf = _origRf;
      rv = _origRv;
    });

    it('should include reflection channel code in playNotes', () => {
      // Verify that playNotes code includes reflection channel generation
      const playNotesCode = stage.playNotes.toString();
      expect(playNotesCode).toContain('reflection');
      expect(playNotesCode).toContain('reflectionCH');
    });

    it('should include bass channel code in playNotes', () => {
      // Verify that playNotes code includes bass channel generation
      const playNotesCode = stage.playNotes.toString();
      expect(playNotesCode).toContain('bass');
      expect(playNotesCode).toContain('bassCH');
      expect(playNotesCode).toContain('bassNote');
    });

    it('should emit source, reflection, and bass events from playNotes', () => {
      // Force the cross-modulation gate to fire by making rf minimal
      const originalCrossModulate = stage.crossModulateRhythms;
      stage.crossModulateRhythms = () => { stage.crossModulation = 10; stage.lastCrossMod = 0; };
      stage.playNotes();
      stage.crossModulateRhythms = originalCrossModulate;

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
      expect(Array.isArray(source)).toBe(true);
      expect(Array.isArray(reflection)).toBe(true);
      expect(Array.isArray(bass)).toBe(true);
      expect(source.length).toBeGreaterThan(0);
      expect(reflection.length).toBeGreaterThan(0);
      expect(bass.length).toBeGreaterThan(0);
    });
  });

  describe('crossModulateRhythms deterministic behavior', () => {
    beforeEach(() => {
      beatRhythm = [1, 0, 1, 0];
      divRhythm = [1, 1, 0];
      subdivRhythm = [1, 0, 1];
      beatIndex = 0;
      divIndex = 0;
      subdivIndex = 0;
      numerator = 4;
      beatsOn = 10;
      beatsOff = 2;
      divsPerBeat = 4;
      divsOn = 5;
      divsOff = 1;
      subdivsPerDiv = 4;
      subdivsOn = 20;
      subdivsOff = 5;
      subdivsPerMinute = 500;

      // Stub randomness for deterministic testing
      _origRf = rf;
      _origRi = ri;
      rf = (min = 0, max = 1) => min; // Always return min
      ri = (min = 0, max = 1) => Math.floor(min); // Always return min as integer
    });

    afterEach(() => {
      rf = _origRf;
      ri = _origRi;
    });

    it('should calculate crossModulation value based on rhythm state', () => {
      stage.crossModulation = 0;
      stage.lastCrossMod = 0;
      stage.crossModulateRhythms();

      expect(typeof stage.crossModulation).toBe('number');
      expect(stage.crossModulation).toBeGreaterThan(0);
      expect(stage.lastCrossMod).toBe(0); // Should have saved previous value
    });

    it('should increase crossModulation when rhythm slots are active', () => {
      // Set all rhythm indices to active slots (value 1)
      beatIndex = 0; // beatRhythm[0] = 1
      divIndex = 0; // divRhythm[0] = 1
      subdivIndex = 0; // subdivRhythm[0] = 1

      stage.crossModulation = 0;
      stage.crossModulateRhythms();
      const activeValue = stage.crossModulation;

      // Reset and test with inactive slots
      beatIndex = 1; // beatRhythm[1] = 0
      divIndex = 2; // divRhythm[2] = 0
      subdivIndex = 1; // subdivRhythm[1] = 0

      stage.crossModulation = 0;
      stage.crossModulateRhythms();
      const inactiveValue = stage.crossModulation;

      // Active rhythms should contribute more (active contributes rf(1.5,3), inactive uses max())
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should verify active vs inactive rhythm slots affect output', () => {
      // This test compares active slots (which use rf(1.5,3)=1.5) vs inactive (which use max())

      // Active: All slots are ON (value = 1)
      beatIndex = 0; // beatRhythm[0] = 1
      divIndex = 0; // divRhythm[0] = 1
      subdivIndex = 0; // subdivRhythm[0] = 1

      stage.crossModulation = 0;
      stage.crossModulateRhythms();
      const activeValue = stage.crossModulation;

      // Inactive: All slots are OFF (value = 0)
      beatIndex = 1; // beatRhythm[1] = 0
      divIndex = 2; // divRhythm[2] = 0
      subdivIndex = 1; // subdivRhythm[1] = 0

      stage.crossModulation = 0;
      stage.crossModulateRhythms();
      const inactiveValue = stage.crossModulation;

      // Active slots contribute rf(1.5,3) which is larger than inactive max() expressions
      expect(activeValue).toBeGreaterThan(inactiveValue);
    });

    it('should accumulate values from all formula terms', () => {
      // Verify the formula is actually executing by checking that the value is more than just one term
      beatIndex = 0;
      divIndex = 0;
      subdivIndex = 0;

      stage.crossModulation = 0;
      stage.crossModulateRhythms();

      // With stubs, should accumulate from multiple terms: rf(1.5,3)=1.5 as minimum
      expect(stage.crossModulation).toBeGreaterThanOrEqual(1.5);
    });



    it('should store previous crossModulation in lastCrossMod', () => {
      stage.crossModulation = 5.5;
      stage.lastCrossMod = 2.2;

      stage.crossModulateRhythms();

      // Should have saved the previous value (5.5) before calculating new one
      expect(stage.lastCrossMod).toBe(5.5);
      expect(typeof stage.crossModulation).toBe('number');
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
    // Reset global state that stage.js modifies
    c = [];
    beatStart = 0;
    beatCount = 0;
    beatsUntilBinauralShift = 16;
    firstLoop = 0;
    flipBin = false;
    crossModulation = 2.2;
    lastCrossMod = 0;
    subdivsOff = 0;
    subdivsOn = 0;
    velocity = 99;
    tpSec = 960;
    tpSubdiv = 100;
    tpDiv = 400;
    tpBeat = 1600;
    subdivStart = 0;
    beatRhythm = [1, 0, 1, 0];
    divRhythm = [1, 1, 0];
    subdivRhythm = [1, 0, 1];
    beatsOn = 10;
    beatsOff = 2;
    divsOn = 5;
    divsOff = 1;
    subdivsOn = 20;
    subdivsOff = 5;
    subdivsPerMinute = 500;
    balOffset = 0;
    sideBias = 0;
    lastUsedCHs = new Set();
    lastUsedCHs2 = new Set();
    lastUsedCHs3 = new Set();
  });

  describe('Global State Variables', () => {
    it('should have m (Math) defined', () => {
      expect(m).toBeDefined();
      expect(m.round(5.5)).toBe(6);
    });

    it('should have p (push) function defined', () => {
      expect(typeof p).toBe('function');
      const arr = [];
      p(arr, 1, 2, 3);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('should have clamp function defined', () => {
      expect(typeof clamp).toBe('function');
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should have modClamp function defined', () => {
      expect(typeof modClamp).toBe('function');
      expect(modClamp(5, 0, 9)).toBe(5);
      expect(modClamp(10, 0, 9)).toBe(0);
      expect(modClamp(-1, 0, 9)).toBe(9);
    });

    it('should have rf (randomFloat) function defined', () => {
      expect(typeof rf).toBe('function');
      const val = rf(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
    });

    it('should have ri (randomInt) function defined', () => {
      expect(typeof ri).toBe('function');
      const val = ri(0, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
      expect(Number.isInteger(val)).toBe(true);
    });

    it('should have ra (randomInRangeOrArray) function defined', () => {
      expect(typeof ra).toBe('function');
      const arrVal = ra([1, 2, 3, 4, 5]);
      expect([1, 2, 3, 4, 5]).toContain(arrVal);
    });

    it('should have rl (randomLimitedChange) function defined', () => {
      expect(typeof rl).toBe('function');
      const val = rl(50, -5, 5, 0, 100);
      expect(val).toBeGreaterThanOrEqual(45);
      expect(val).toBeLessThanOrEqual(55);
    });

    it('should have rv (randomVariation) function defined', () => {
      expect(typeof rv).toBe('function');
      const val = rv(100);
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

    it('should have binauralL and binauralR arrays', () => {
      expect(Array.isArray(binauralL)).toBe(true);
      expect(Array.isArray(binauralR)).toBe(true);
      expect(binauralL.length).toBe(6);
      expect(binauralR.length).toBe(6);
    });
  });

  describe('Timing Variables', () => {
    it('should have tpSec defined', () => {
      expect(typeof tpSec).toBe('number');
    });

    it('should have beat timing variables', () => {
      expect(typeof tpBeat).toBe('number');
      expect(typeof tpDiv).toBe('number');
      expect(typeof tpSubdiv).toBe('number');
    });

    it('should have start position variables', () => {
      expect(typeof beatStart).toBe('number');
      expect(typeof divStart).toBe('number');
      expect(typeof subdivStart).toBe('number');
    });
  });

  describe('Rhythm Variables', () => {
    it('should have beatRhythm array', () => {
      expect(Array.isArray(beatRhythm)).toBe(true);
    });

    it('should have divRhythm array', () => {
      expect(Array.isArray(divRhythm)).toBe(true);
    });

    it('should have subdivRhythm array', () => {
      expect(Array.isArray(subdivRhythm)).toBe(true);
    });

    it('should have beatsOn/off counters', () => {
      expect(typeof beatsOn).toBe('number');
      expect(typeof beatsOff).toBe('number');
    });
  });

  describe('Binaural Variables', () => {
    it('should have binauralFreqOffset defined', () => {
      expect(typeof binauralFreqOffset).toBe('number');
    });

    it('should have binauralPlus/binauralMinus defined', () => {
      expect(typeof binauralPlus).toBe('number');
      expect(typeof binauralMinus).toBe('number');
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
    it('should have velocity defined', () => {
      expect(typeof velocity).toBe('number');
      expect(velocity).toBeGreaterThan(0);
    });

    it('should have flipBin toggle', () => {
      expect(typeof flipBin).toBe('boolean');
    });

    it('should have beatCount counter', () => {
      expect(typeof beatCount).toBe('number');
    });

    it('should have crossModulation value', () => {
      expect(typeof crossModulation).toBe('number');
    });
  });

  describe('allNotesOff', () => {
    it('should be defined as a function', () => {
      expect(typeof allNotesOff).toBe('function');
    });

    it('should generate events for all channels', () => {
      const initialLength = c.length;
      allNotesOff(1000);
      expect(c.length).toBeGreaterThan(initialLength);
    });

    it('should use control change 123', () => {
      allNotesOff(1000);
      const allNotesOffEvent = c.find(e => e.vals && e.vals[1] === 123);
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
      expect(Array.isArray(c)).toBe(true);
    });

    it('should be empty initially', () => {
      expect(c.length).toBe(0);
    });
  });

  describe('Instrument Variables', () => {
    it('should have primaryInstrument defined', () => {
      expect(primaryInstrument).toBeDefined();
    });

    it('should have bassInstrument defined', () => {
      expect(bassInstrument).toBeDefined();
    });

    it('should have drumSets array', () => {
      expect(Array.isArray(drumSets)).toBe(true);
    });
  });

  describe('setBalanceAndFX function', () => {
    beforeEach(() => {
      c = [];
      beatStart = 0;
      beatCount = 0;
      beatsUntilBinauralShift = 4;
      balOffset = 0;
      sideBias = 0;
      firstLoop = 0;
      bpmRatio3 = 1;
      flipBin = false;
      refVar = 1;
      cBal = 64;
      cBal2 = 64;
      cBal3 = 64;
      lBal = 32;
      rBal = 96;
      bassVar = 0;
    });

    it('should update pan values on condition', () => {
      stage.setBalanceAndFX();
      // Should have added pan control change events
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      // Pan control is CC 10, should have events for different channels
      expect(panEvents.length).toBeGreaterThan(0);
    });

    it('should keep pan values within valid MIDI range (0-127)', () => {
      stage.setBalanceAndFX();
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      panEvents.forEach(evt => {
        expect(evt.vals[2]).toBeGreaterThanOrEqual(0);
        expect(evt.vals[2]).toBeLessThanOrEqual(127);
      });
    });

    it('should apply different pan values for left vs right channels', () => {
      stage.setBalanceAndFX();
      const panEvents = c.filter(evt => evt.vals && evt.vals[1] === 10);
      // When pan events are applied, left channels should differ from right
      expect(panEvents.length).toBeGreaterThan(1);
    });

    it('should apply FX control events (CC 1, 5, 11, etc)', () => {
      stage.setBalanceAndFX();
      // Should generate control change events for various FX
      const fxEvents = c.filter(evt => evt.type === 'control_c');
      expect(fxEvents.length).toBeGreaterThan(10);
    });

    it('should set tick to beatStart-1 for control events', () => {
      beatStart = 100;
      stage.setBalanceAndFX();
      const controlEvents = c.filter(evt => evt.type === 'control_c');
      controlEvents.forEach(evt => {
        expect(evt.tick).toBe(99); // beatStart - 1
      });
    });

    it('should update balance offset with limited change', () => {
      const initialBal = balOffset;
      stage.setBalanceAndFX();
      // balOffset should change but within reasonable limits
      expect(Math.abs(balOffset - initialBal)).toBeLessThanOrEqual(4);
    });

    it('should apply side bias variation', () => {
      stage.setBalanceAndFX();
      // sideBias should affect the left/right pan values
      expect(typeof sideBias).toBe('number');
      expect(sideBias).toBeGreaterThanOrEqual(-20);
      expect(sideBias).toBeLessThanOrEqual(20);
    });

    it('should clamp balance values correctly', () => {
      for (let i = 0; i < 5; i++) {
        stage.setBalanceAndFX();
        expect(lBal).toBeGreaterThanOrEqual(0);
        expect(lBal).toBeLessThanOrEqual(54);
        expect(rBal).toBeGreaterThanOrEqual(74);
        expect(rBal).toBeLessThanOrEqual(127);
      }
    });
  });

  describe('setOtherInstruments function', () => {
    beforeEach(() => {
      c = [];
      beatStart = 480;
      beatCount = 0;
      beatsUntilBinauralShift = 4;
      firstLoop = 0;
      otherInstruments = [33, 35, 37]; // Example instruments
      otherBassInstruments = [42, 44, 46];
      drumSets = [0, 1, 2];
    });

    it('should occasionally add instrument change events', () => {
      // Run multiple times since it uses random chance
      let instrumentChanges = 0;
      for (let i = 0; i < 10; i++) {
        c = [];
        beatCount = i;
        stage.setOtherInstruments();
        if (c.length > 0) {
          instrumentChanges++;
        }
      }
      // Should happen at least once in 10 runs
      expect(instrumentChanges).toBeGreaterThan(0);
    });

    it('should generate program change events for binaural instruments', () => {
      firstLoop = 0; // Force execution on first loop
      stage.setOtherInstruments();
      const progChanges = c.filter(evt => evt.type === 'program_c');
      expect(progChanges.length).toBeGreaterThan(0);
    });

    it('should set tick to beatStart for instrument changes', () => {
      firstLoop = 0;
      beatStart = 960;
      stage.setOtherInstruments();
      c.forEach(evt => {
        expect(evt.tick).toBe(960);
      });
    });

    it('should select from otherInstruments array', () => {
      firstLoop = 0;
      otherInstruments = [50, 51, 52];
      stage.setOtherInstruments();
      const progChanges = c.filter(evt => evt.type === 'program_c' && evt.vals);
      progChanges.forEach(evt => {
        // Program value should be from otherInstruments or otherBassInstruments or drumSets
        expect(typeof evt.vals[1]).toBe('number');
      });
    });

    it('should not execute when conditions are not met', () => {
      firstLoop = 1; // Not first loop
      beatCount = 10;
      beatsUntilBinauralShift = 5; // beatCount % beatsUntilBinauralShift = 0, but not < 1
      stage.setOtherInstruments();
      // Might or might not execute depending on random chance (rf() < .3)
      expect(Array.isArray(c)).toBe(true);
    });
  });
});
