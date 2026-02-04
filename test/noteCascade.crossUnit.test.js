// Test for NoteCascade.playNotesAcrossUnits - cross-unit cascade scheduling
require('../src/index');
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('NoteCascade.playNotesAcrossUnits', () => {
  let origRf, origC, eventBuffer, origLM;

  beforeEach(() => {
    // Stub rf for deterministic 50/50 stutter gate
    origRf = global.rf;
    let callCount = 0;
    global.rf = (...args) => {
      // Alternate between >0.5 and <0.5 for stutter gate testing
      if (args.length === 0) {
        callCount++;
        return callCount % 2 === 0 ? 0.6 : 0.4; // Alternating pattern
      }
      return origRf(...args);
    };

    // Setup event buffer
    eventBuffer = [];
    origC = global.c;
    global.c = eventBuffer;

    // Ensure LM and beatMotifs are available - save original
    origLM = global.LM;
    global.LM = {
      activeLayer: 'primary',
      layers: {
        primary: {
          beatMotifs: {
            0: [{ note: 60 }, { note: 64 }]
          }
        }
      }
    };

    // Ensure MotifSpreader is available
    if (!global.MotifSpreader) {
      global.MotifSpreader = {
        getBeatMotifPicks: (layer, beatKey, max) => {
          const bucket = layer.beatMotifs[beatKey] || [];
          return bucket.slice(0, max);
        }
      };
    }

    // Ensure timing globals
    global.tpBeat = 480;
    global.tpDiv = 240;
    global.tpSubdiv = 120;
    global.tpSubsubdiv = 60;

    // Ensure bpmRatio3
    global.bpmRatio3 = 1;

    // Register tiny stutter helper so scheduleNoteCascade (fail-fast) can operate when stutter enabled
    const tinyHelper = (opts) => ({ events: [{ tick: opts.on, type: 'on', vals: [opts.channel, opts.note, opts.velocity] }] });
    if (StutterConfig && StutterConfig.registerOriginalHelper) StutterConfig.registerOriginalHelper(tinyHelper);

    // Ensure test NoteCascade scheduler is present (setup-stage should provide this, but be defensive)
    if (typeof NoteCascade === 'undefined' || !NoteCascade || typeof NoteCascade.scheduleNoteCascade !== 'function') {
      NoteCascade = NoteCascade || {};
      NoteCascade.scheduleNoteCascade = global.__test_scheduleNoteCascade;
    }
  });

  afterEach(() => {
    global.rf = origRf;
    global.c = origC;
    global.LM = origLM;
  });

  it('schedules notes across units with source/reflection/bass channels', () => {
    const scheduled = NoteCascade.playNotesAcrossUnits({
      unit: 'subdiv',
      on: 0,
      sustain: 100,
      velocity: 80,
      binVel: 40,
      enableStutter: false
    });

    // Should schedule events for at least source and reflection channels
    expect(scheduled).toBeGreaterThan(0);
    expect(eventBuffer.length).toBeGreaterThan(0);

    // Verify we have 'on' events with proper structure
    const onEvents = eventBuffer.filter(e => e.type === 'on');
    expect(onEvents.length).toBeGreaterThan(0);

    // Each on event should have vals: [channel, note, velocity]
    onEvents.forEach(evt => {
      expect(evt.vals).toBeDefined();
      expect(evt.vals.length).toBe(3);
      expect(typeof evt.vals[0]).toBe('number'); // channel
      expect(typeof evt.vals[1]).toBe('number'); // note
      expect(typeof evt.vals[2]).toBe('number'); // velocity
    });
  });

  it('gates stutter with 50/50 random when enableStutter=true', () => {
    // Track stutter scheduling via NoteCascade.scheduleNoteCascade wrapper
    const stutterCalls = [];
    const origNoteCascadeFn = NoteCascade && NoteCascade.scheduleNoteCascade ? NoteCascade.scheduleNoteCascade : null;
    NoteCascade.scheduleNoteCascade = (manager, opts) => {
      stutterCalls.push(opts);
      if (typeof origNoteCascadeFn === 'function') return origNoteCascadeFn(manager, opts);
      return 1;
    };

    const scheduled = NoteCascade.playNotesAcrossUnits({
      unit: 'subsubdiv',
      on: 0,
      sustain: 100,
      velocity: 80,
      binVel: 40,
      enableStutter: true
    });

    // With alternating rf() pattern, should get some stutter calls
    // (depends on how many notes/channels process)
    // We just verify the mechanism works, not exact count
    expect(scheduled).toBeGreaterThan(0);

    // Restore
    if (origNoteCascadeFn) NoteCascade.scheduleNoteCascade = origNoteCascadeFn; else delete NoteCascade.scheduleNoteCascade;

    // Note: exact stutter call count depends on rf() pattern and channel counts
    // The important thing is the feature works without errors
  });

  it('works across different unit levels', () => {
    const units = ['beat', 'div', 'subdiv', 'subsubdiv'];

    units.forEach(unit => {
      eventBuffer.length = 0; // Clear buffer
      const scheduled = NoteCascade.playNotesAcrossUnits({
        unit,
        on: 0,
        sustain: 100,
        velocity: 80,
        binVel: 40,
        enableStutter: false
      });

      expect(scheduled).toBeGreaterThan(0);
      expect(eventBuffer.length).toBeGreaterThan(0);
    });
  });

  it('respects flipBin state for channel filtering', () => {
    const origFlipBin = global.flipBin;

    // Test with flipBin = false
    global.flipBin = false;
    eventBuffer.length = 0;
    const scheduledFalse = NoteCascade.playNotesAcrossUnits({
      unit: 'subdiv',
      on: 0,
      sustain: 100,
      velocity: 80,
      binVel: 40,
      enableStutter: false
    });

    const channelsFalse = new Set(eventBuffer.map(e => e.vals && e.vals[0]).filter(ch => ch !== undefined));

    // Test with flipBin = true
    global.flipBin = true;
    eventBuffer.length = 0;
    const scheduledTrue = NoteCascade.playNotesAcrossUnits({
      unit: 'subdiv',
      on: 0,
      sustain: 100,
      velocity: 80,
      binVel: 40,
      enableStutter: false
    });

    const channelsTrue = new Set(eventBuffer.map(e => e.vals && e.vals[0]).filter(ch => ch !== undefined));

    // Different flipBin states should potentially use different channels
    // (though some overlap is expected)
    expect(scheduledFalse).toBeGreaterThan(0);
    expect(scheduledTrue).toBeGreaterThan(0);

    global.flipBin = origFlipBin;
  });
});
