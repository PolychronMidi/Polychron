// regimeVelocity: sub-beat velocity-space contention writer; sibling to
// regimePan/regimeFade/regimeFx. Emits CC11 (expression) AND writes directly
// to substrate 'velocity' slot so substrate sees regimeVelocity as cooperating
// voice on same slots direct-p populates. Sub-beat cadence, 50ms rate-limit,
// cooperation+flutter-strobe with section-type-gated multiplier.

moduleLifecycle.declare({
  name: 'regimeVelocity',
  subsystem: 'fx',
  deps: ['systemDynamicsProfiler'],
  provides: ['regimeVelocity'],
  init: (deps) => {
  const systemDynamicsProfiler = deps.systemDynamicsProfiler;
  const CENTER_EXPRESSION = 100; // MIDI expression default on most synths
  const MAX_BIAS = 27; // keep range [73, 127] -- audibly useful

  const UNIT_PROB = {
    beat: 1.0,
    div: 0.5,
    subdiv: 0.25,
    subsubdiv: 0.15,
  };

  const MIN_FIRE_INTERVAL_SEC = 0.05;
  // Same cooperation probability as regimeFade -- both shape loudness
  // envelopes, both benefit from alignment with existing trend.
  const COOPERATION_PROB = 0.30;
  const FLUTTER_PROB = 0.05;
  const FLUTTER_SECTION_MULT = {
    intro: 1.0, exposition: 1.0, development: 1.0,
    climax: 0.2, resolution: 1.4, conclusion: 1.3, coda: 1.5,
  };
  let lastFireTime = -Infinity;

  function _allChannels() {
    const out = [];
    if (Array.isArray(source2)) for (let i = 0; i < source2.length; i++) out.push(source2[i]);
    if (Array.isArray(reflection)) for (let i = 0; i < reflection.length; i++) out.push(reflection[i]);
    if (Array.isArray(bass)) for (let i = 0; i < bass.length; i++) out.push(bass[i]);
    return out;
  }

  function tick(unit) {
    const prob = UNIT_PROB[unit];
    if (!prob || rf() > prob) return;

    const now = unitStartTime || beatStartTime;
    if (now - lastFireTime < MIN_FIRE_INTERVAL_SEC) return;

    const snapshot = systemDynamicsProfiler.getSnapshot();
    const regime = snapshot.regime || 'coherent';
    if (regime === 'initializing') return;

    const channels = _allChannels();
    if (channels.length === 0) return;
    const ch = channels[ri(channels.length - 1)];

    let bias = 0;
    let isFlutter = false;
    const trend = channelStateField.recentTrend(ch, 'velocity');
    const flutterMult = FLUTTER_SECTION_MULT[currentSectionType] || 1.0;
    if (trend !== 0 && rf() < FLUTTER_PROB * flutterMult) {
      bias = -trend * MAX_BIAS;
      isFlutter = true;
    } else if (trend !== 0 && rf() < COOPERATION_PROB) {
      bias = trend * rf(4, 10);
    } else if (regime === 'coherent') {
      bias = rf(-10, 10);
    } else if (regime === 'exploring') {
      bias = rf() < 0.5 ? rf(12, 26) : rf(-26, -12);
    } else if (regime === 'evolving') {
      bias = m.sin(beatCount * 0.27 + subdivIndex * 0.63 + subsubdivIndex * 1.17) * rf(14, 22);
    } else {
      bias = rf(-12, 12);
    }
    bias = m.round(clamp(bias, -MAX_BIAS, MAX_BIAS));
    const expression = clamp(CENTER_EXPRESSION + bias, 0, MIDI_MAX_VALUE);

    lastFireTime = now;
    // Substrate: register on 'velocity' dimension so direct-p + cross-layer
    // writers + regimeVelocity all compete on the same slot histories.
    channelStateField.write(ch, 'velocity', expression, isFlutter ? 'regimeVelocity-flutter' : 'regimeVelocity');
    // MIDI: emit CC11 (expression). No observeControl call -- the CC11
    // event shouldn't ALSO register in the 'fx' dimension since we're
    // explicitly writing to 'velocity' above.
    p(c, { timeInSeconds: now, type: 'control_c', vals: [ch, 11, expression] });
  }

  return { tick };
  },
});
