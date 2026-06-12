// regimeWriterFactory: shared sub-beat contention-writer pattern. The four
// regime{Pan,Fade,Fx,Velocity} writers diverge only in CC number, substrate
// dimension, center value, MAX_BIAS, per-branch amplitude ranges, and
// channel-source predicate. All other scaffolding (UNIT_PROB cadence, 50ms
// rate-limit, FLUTTER_SECTION_MULT table, regime-branch tick logic) is
// identical -- factored here so drift across the four writers is impossible.

moduleLifecycle.declare({
  name: 'regimeWriterFactory',
  subsystem: 'fx',
  deps: ['systemDynamicsProfiler'],
  provides: ['regimeWriterFactory'],
  init: (deps) => {
    const systemDynamicsProfiler = deps.systemDynamicsProfiler;

    const UNIT_PROB = { beat: 1.0, div: 0.5, subdiv: 0.25, subsubdiv: 0.15 };
    const MIN_FIRE_INTERVAL_SEC = 0.05;
    // Per-section-type flutter multiplier: climax preserves peaks (0.2x),
    // resolution/conclusion/coda get full dynamic range.
    const FLUTTER_SECTION_MULT = {
      intro: 1.0, exposition: 1.0, development: 1.0,
      climax: 0.2, resolution: 1.4, conclusion: 1.3, coda: 1.5,
    };

    function create(spec) {
      const {
        name,                  // 'regimePan' / 'regimeFade' / etc.
        cc,                    // MIDI CC number (10/7/74/11)
        substrateDim,          // 'pan'/'fade'/'filter'/'velocity'
        substrateMode,         // 'observeControl' (CC-emitted) or 'write' (direct)
        center,                // CENTER_VAL
        maxBias,               // MAX_BIAS
        coopRange,             // [lo, hi] for cooperation-mode amplitude
        coherentRange,         // [lo, hi] for coherent regime
        exploringRange,        // [lo, hi] for exploring (mirrored both directions)
        evolvingFreqs,         // [beatF, subdivF, subsubdivF] for sin() arg
        evolvingAmp,           // [lo, hi] for evolving amplitude
        elseRange,             // [lo, hi] fallback regime
        cooperationProb,       // 0..1
        flutterProb,           // 0..1
        getChannels,           // () => [ch1, ch2, ...] -- closure over globals
        includeApplyAlias,     // true => also expose tick-as-apply (back-compat)
      } = spec;

      let lastFireTime = -Infinity;

      function tick(unit) {
        const prob = UNIT_PROB[unit];
        if (!prob || rf() > prob) return;
        const now = unitStartTime || beatStartTime;
        if (now - lastFireTime < MIN_FIRE_INTERVAL_SEC) return;
        const snapshot = systemDynamicsProfiler.getSnapshot();
        const regime = snapshot.regime || 'coherent';
        if (regime === 'initializing') return;
        const channels = getChannels();
        if (channels.length === 0) return;
        const ch = channels[ri(channels.length - 1)];

        let bias = 0;
        let isFlutter = false;
        const trend = channelStateField.recentTrend(ch, substrateDim);
        const flutterMult = FLUTTER_SECTION_MULT[currentSectionType] || 1.0;
        if (trend !== 0 && rf() < flutterProb * flutterMult) {
          bias = -trend * maxBias;  // strobe-inversion peak-amplitude flash
          isFlutter = true;
        } else if (trend !== 0 && rf() < cooperationProb) {
          bias = trend * rf(coopRange[0], coopRange[1]);
        } else if (regime === 'coherent') {
          bias = rf(coherentRange[0], coherentRange[1]);
        } else if (regime === 'exploring') {
          bias = rf() < 0.5
            ? rf(exploringRange[0], exploringRange[1])
            : rf(-exploringRange[1], -exploringRange[0]);
        } else if (regime === 'evolving') {
          bias = m.sin(
            beatCount * evolvingFreqs[0]
            + subdivIndex * evolvingFreqs[1]
            + subsubdivIndex * evolvingFreqs[2],
          ) * rf(evolvingAmp[0], evolvingAmp[1]);
        } else {
          bias = rf(elseRange[0], elseRange[1]);
        }
        bias = m.round(clamp(bias, -maxBias, maxBias));
        const value = clamp(center + bias, 0, MIDI_MAX_VALUE);

        lastFireTime = now;
        const writerTag = isFlutter ? `${name}-flutter` : name;
        if (substrateMode === 'observeControl') {
          channelStateField.observeControl(ch, cc, value, writerTag);
        } else {
          channelStateField.write(ch, substrateDim, value, writerTag);
        }
        p(c, { timeInSeconds: now, type: 'control_c', vals: [ch, cc, value] });
      }

      const out = { tick };
      if (includeApplyAlias) out.apply = () => tick('beat');
      return out;
    }

    return { create };
  },
});
