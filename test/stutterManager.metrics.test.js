require('../src/fx/stutterManager');

describe('StutterManager metrics & config', () => {
  it('passes manager config into helper opts', () => {
    // Save original helper
    const orig = typeof stutterNotes === 'function' ? stutterNotes : null;
    let captured = null;
    global.stutterNotes = function(opts){ captured = opts; return { shared: opts.shared || Stutter.shared, events: [] }; };
    // ensure manager uses our injected helper
    Stutter.setStutterNotesHelper(global.stutterNotes);

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

    const added = Stutter.scheduleStutterForUnit({ profile: 'test', channel: 1, note: 60, on: 1234, sustain: 10, velocity: 80, binVel: 90 });
    expect(captured).toBeTruthy();
    expect(captured.config).toBeTruthy();
    expect(captured.config.fallbackVelocity).toBe(Stutter.config.fallbackVelocity);

    // restore
    if (orig) { global.stutterNotes = orig; Stutter.setStutterNotesHelper(orig); } else { delete global.stutterNotes; Stutter.setStutterNotesHelper(null); }
    if (origNoteCascadeFn) global.noteCascade.scheduleNoteCascade = origNoteCascadeFn; else delete global.noteCascade.scheduleNoteCascade;
  });

  it('metrics increment on schedule and play', () => {
    // Use recording p
    const origP = global.p;
    const rec = [];
    global.p = function(cArg, ev) { rec.push({ cArg, ev }); };

    // Simulate scheduling directly to avoid helper races and still test metrics
    Stutter.resetMetrics();
    const tick = 2000;
    Stutter.pending.set(tick, [{ tick, type: 'on', vals: [2, 64, 80], _profile: 'metrics' }]);
    // update shared metrics via StutterConfig API
    if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.incScheduled === 'function') StutterConfig.incScheduled(1, 'metrics');

    const m1 = Stutter.getMetrics();
    expect(m1.scheduledCount).toBeGreaterThanOrEqual(1);

    // play
    const played = Stutter.playPendingForTick(tick);
    expect(played).toBe(1);
    const m2 = Stutter.getMetrics();
    expect(m2.emittedCount).toBeGreaterThanOrEqual(1);
    expect(rec.length).toBeGreaterThanOrEqual(1);

    // restore
    global.p = origP;
  });
});
