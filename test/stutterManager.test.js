require('../src/fx/stutterManager');

describe('StutterManager basic behavior', () => {
  it('stutterFade default parameters and binding work', () => {
    // Replace internal implementation to observe behavior
    const observed = {};
    Stutter._stutterFade = (channels, numStutters, duration) => ({ channels, numStutters, duration });

    const res = Stutter.stutterFade(['x']);
    expect(res.channels).toEqual(['x']);
    expect(typeof res.numStutters).toBe('number');
    expect(typeof res.duration).toBe('number');

    // Global binding should also call through
    const res2 = stutterFade(['y']);
    expect(res2.channels).toEqual(['y']);
  });

  it('resetChannelTracking clears sets and accepts channel list', () => {
    // Ensure deterministic start
    Stutter.lastUsedCHs.clear();
    Stutter.lastUsedCHs2.clear();
    Stutter.lastUsedCHs.add('a');
    Stutter.lastUsedCHs2.add('b');
    // Debug sizes immediately after add
    try { if (typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug('test: after add', { s1: Stutter.lastUsedCHs.size, s2: Stutter.lastUsedCHs2.size }); } catch (e) { console.warn('Test debug logging failed:', e && e.stack ? e.stack : e); }
    expect(Stutter.lastUsedCHs.size).toBe(1);
    expect(Stutter.lastUsedCHs2.size).toBe(1);

    const full = Stutter.resetChannelTracking();
    // Ensure function returns a cleared count and that sets are now empty
    expect(typeof full.cleared).toBe('number');
    expect(Stutter.lastUsedCHs.size).toBe(0);
    expect(Stutter.lastUsedCHs2.size).toBe(0);

    // add back and clear specific
    Stutter.lastUsedCHs.add('c');
    Stutter.lastUsedCHs2.add('d');
    const partial = Stutter.resetChannelTracking(['c']);
    expect(typeof partial.cleared).toBe('number');
    expect(Stutter.lastUsedCHs.has('c')).toBe(false);
  });

  it('schedules stutter events and plays them on tick', () => {
    // Replace p with recording function
    const origP = global.p;
    const recorded = [];
    global.p = function(cArg, ev) { recorded.push({ cArg, ev }); };

    // deterministic RNG
    const rf = () => 0.5;
    const ri = (a, b) => (typeof b === 'undefined' ? a : a);

    Stutter.resetChannelTracking();
    // Register a tiny stutter helper so the scheduler (which now fails fast) has a real implementation
    const tinyHelper = (opts) => ({ events: [{ tick: opts.on, type: 'on', vals: [opts.channel, opts.note, opts.velocity] }] });
    StutterConfig.registerOriginalHelper && StutterConfig.registerOriginalHelper(tinyHelper);

    // Provide a test noteCascade.scheduleNoteCascade shim so scheduleStutterForUnit (now strict) can delegate
    const origNoteCascadeFn = global.noteCascade?.scheduleNoteCascade;
    global.noteCascade = global.noteCascade || {};
    global.noteCascade.scheduleNoteCascade = function(manager, opts) {
      const helper = (typeof manager._helperOverride === 'function') ? manager._helperOverride : (StutterConfig && StutterConfig.getRegisteredHelper ? StutterConfig.getRegisteredHelper() : null);
      const result = (typeof helper === 'function') ? helper(opts) : { events: [] };
      const events = result && result.events ? result.events : [];
      for (const ev of events) {
        ev._profile = opts.profile || 'unknown';
        const key = Math.round(ev.tick);
        if (!manager.pending.has(key)) manager.pending.set(key, []);
        manager.pending.get(key).push(ev);
        if (StutterConfig && StutterConfig.incPendingForTick) StutterConfig.incPendingForTick(key, 1);
      }
      if (StutterConfig && StutterConfig.incScheduled) StutterConfig.incScheduled(events.length, opts.profile || 'unknown');
      return events.length;
    };

    // schedule events at on=1000
    const added = Stutter.scheduleStutterForUnit({ profile: 'source', channel: 1, note: 60, on: 1000, sustain: 480, velocity: 80, binVel: 90, rf, ri });
    expect(typeof added).toBe('number');
    expect(added).toBeGreaterThanOrEqual(0);

    // nothing emitted yet
    expect(recorded.length).toBe(0);

    // play pending at tick 1000
    const played = Stutter.playPendingForTick(1000);
    expect(played).toBeGreaterThanOrEqual(0);
    // after playing, recorded should have at least one event
    expect(recorded.length).toBeGreaterThanOrEqual(1);

    // restore
    global.p = origP;
  });
});
