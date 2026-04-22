// regimeFx.js - sub-beat filter-cutoff (CC74) contention writer.
//
// Third sibling to regimePan (CC10) and regimeFade (CC7). R38 analyzer
// investigation: perceptual_complexity_avg measures EnCodec codebook-token
// entropy, which responds to SPECTRAL/TIMBRAL unpredictability. Our prior
// sub-beat interventions modulated pan and volume -- neither of which
// changes the spectral content EnCodec sees. Filter cutoff (CC74) is the
// most spectrally-active MIDI CC: sweeping it WILL shift codebook tokens
// because it literally filters the audio spectrum. This module targets the
// specific dimension the perceptual_complexity metric measures.
//
// Regime shape:
//   coherent   -> small bright-ish offset around open filter (subtle sparkle)
//   exploring  -> wide cutoff sweeps from muffled to piercing
//   evolving   -> slow sinusoidal arc across beats (like LFO-driven filter)
//   initializing -> inert
//
// Rate-limit shared in spirit with regimePan/regimeFade (0.05s min, but
// independent timer -- so pan/fade/fx can all fire at the same boundary
// when each timer allows it). MAX_BIAS=48 keeps cutoff in [32, 127], which
// is the audibly useful range (below ~30 is mud, above 127 is clamped).

regimeFx = (() => {
  const CENTER_CUTOFF = 80;
  const MAX_BIAS = 48;

  const UNIT_PROB = {
    beat: 1.0,
    div: 0.5,
    subdiv: 0.25,
    subsubdiv: 0.15,
  };

  const MIN_FIRE_INTERVAL_SEC = 0.05;
  // R40: filter was the deepest antagonism dimension (-0.794 per
  // fieldByParam) because regimeFx, setBalanceAndFX rfx, and
  // setBalanceAndFX's texture-reactive block all write independent
  // random values with no shared directional framework. Cooperation
  // branch here is the biggest lever in the whole intervention -- the
  // dimension with no cooperation population at all. Probability bumped
  // slightly higher than pan/fade because filter needs it most.
  // R43: dial back from 0.45 to 0.33. Filter is still the deepest
  // antagonism dimension but tension-vs-cooperation tradeoff means we
  // back off and rely on strobe inversion flutters for contrast.
  const COOPERATION_PROB = 0.33;
  // Slightly higher flutter probability on filter because filter's
  // spectral swings are the most audibly dramatic contrast flashes.
  const FLUTTER_PROB = 0.07;
  const FLUTTER_SECTION_MULT = {
    intro: 1.0, exposition: 1.0, development: 1.0,
    climax: 0.2, resolution: 1.4, conclusion: 1.3, coda: 1.5,
  };
  let lastFireTime = -Infinity;

  function _allFxChannels() {
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

    const channels = _allFxChannels();
    if (channels.length === 0) return;
    const ch = channels[ri(channels.length - 1)];

    let bias = 0;
    let isFlutter = false;
    const trend = channelStateField.recentTrend(ch, 'filter');
    const flutterMult = FLUTTER_SECTION_MULT[currentSectionType] || 1.0;
    if (trend !== 0 && rf() < FLUTTER_PROB * flutterMult) {
      bias = -trend * MAX_BIAS;
      isFlutter = true;
    } else if (trend !== 0 && rf() < COOPERATION_PROB) {
      bias = trend * rf(8, 18);
    } else if (regime === 'coherent') {
      bias = rf(-12, 16);
    } else if (regime === 'exploring') {
      bias = rf() < 0.5 ? rf(22, 46) : rf(-46, -22);
    } else if (regime === 'evolving') {
      bias = m.sin(beatCount * 0.22 + subdivIndex * 0.55 + subsubdivIndex * 0.95) * rf(20, 38);
    } else {
      bias = rf(-18, 18);
    }
    bias = m.round(clamp(bias, -MAX_BIAS, MAX_BIAS));
    const cutoff = clamp(CENTER_CUTOFF + bias, 0, MIDI_MAX_VALUE);

    lastFireTime = now;
    channelStateField.observeControl(ch, 74, cutoff, isFlutter ? 'regimeFx-flutter' : 'regimeFx');
    p(c, { timeInSeconds: now, type: 'control_c', vals: [ch, 74, cutoff] });
  }

  return { tick };
})();
