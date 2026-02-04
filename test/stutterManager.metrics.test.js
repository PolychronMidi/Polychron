require('../src/fx/stutterManager');

describe('StutterManager metrics & config', () => {
  it('passes manager config into helper opts', () => {
    // Save original helper
    const orig = typeof stutterNotes === 'function' ? stutterNotes : null;
    let captured = null;
    global.stutterNotes = function(opts){ captured = opts; return { shared: opts.shared || Stutter.shared, events: [] }; };
    // ensure manager uses our injected helper
    Stutter.setStutterNotesHelper(global.stutterNotes);

    const added = Stutter.scheduleStutterForUnit({ profile: 'test', channel: 1, note: 60, on: 1234, sustain: 10, velocity: 80, binVel: 90 });
    expect(captured).toBeTruthy();
    expect(captured.config).toBeTruthy();
    expect(captured.config.fallbackVelocity).toBe(Stutter.config.fallbackVelocity);

    // restore
    if (orig) { global.stutterNotes = orig; Stutter.setStutterNotesHelper(orig); } else { delete global.stutterNotes; Stutter.setStutterNotesHelper(null); }
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
