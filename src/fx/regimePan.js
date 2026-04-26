// regimePan.js - sub-beat pan contention writer.
//
// Complements setBalanceAndFX by writing a second pan voice across every
// timing granularity (beat, div, subdiv, subsubdiv), biased by active regime.
// Existence is deliberate: channelStateField revealed setBalanceAndFX owns
// ~74% of all pan writes on monopolistic slots (writerCount=1 almost
// everywhere), producing a quiet emission ecology (meanContention=0.084 at
// R36). regimePan injects a second writer at micro-timing resolution so
// pan-slot dynamics gain real variance and CIM gets honest cooperation /
// antagonism statistics.
//
// Firing cadence: probabilistic per unit. Beat always fires; finer units
// probabilistic so micro-adjustments happen continuously without flooding
// the MIDI buffer. Picks a random channel from source2+reflection+bass per
// tick so no single channel saturates.
//
// Regime shape:
//   coherent   -> small center-pulling offset (cooperation w/ setBalanceAndFX)
//   exploring  -> widening stereo spread (antagonistic to setBalanceAndFX)
//   evolving   -> oscillating asymmetry via sin(beatCount + subdivIndex)
//   initializing -> inert (warmup -- don't poison early coherence)

moduleLifecycle.declare({
  name: 'regimePan',
  subsystem: 'fx',
  deps: [],
  provides: ['regimePan'],
  init: () => {
  const CENTER_PAN = 64;
  const MAX_BIAS = 48;

  // R37 diagnosis: sub-beat firing at prior cadence produced ~4400 small
  // nudges per run, most in coherent regime at +/-6 -- constant jitter that
  // averaged out to blur rather than contrast. perceptual_complexity slope
  // went backwards (+0.00209 -> +0.00098). Response: keep the sub-beat
  // cadence (more opportunities) but (a) widen swings so each fire is
  // perceptible, not whisper, and (b) rate-limit to at most one fire per
  // 50ms of composition time so high-BPM sections don't flood.
  const UNIT_PROB = {
    beat: 1.0,
    div: 0.5,
    subdiv: 0.25,
    subsubdiv: 0.15,
  };

  const MIN_FIRE_INTERVAL_SEC = 0.05;
  // Cooperation-mode probability. R40 fieldSpectrum: 0 multi-writer slots in
  // the synergy bucket, 24 in deep antagonism. Fade dimension cooperates
  // (+0.416) because its writers share a temporal direction; filter deeply
  // antagonizes (-0.794) because writers are uncorrelated. Cooperation
  // branch: read the slot's recent trend and push the same direction, so
  // the regime writer sometimes REINFORCES the existing direction instead
  // of always opposing with random regime bias.
  // R41: 0.25 -> 0.40. R42 showed clap_tension slope flipped negative
  // (+0.00081 -> -0.00072) across four cooperation-amplification rounds;
  // aggressive cooperation lifts valleys and flattens dynamic range.
  // R43: dial back to 0.30, rely on strobe inversion flutters for contrast.
  const COOPERATION_PROB = 0.30;
  // Strobe inversion flutter: rare, peak-amplitude anti-trend push to
  // punch contrast back into the dynamic arc. Fires before the cooperation
  // branch so it can override and produce a "flash" of opposite direction.
  // 5% x sub-beat cadence ~= 20 flutters per run, distributed.
  const FLUTTER_PROB = 0.05;
  // R43 investigation: clap_tension DECLINING verdict was a rolling-window
  // artifact from R39-R40 peaks (0.22) settling to R42-R43 baseline (0.19),
  // not caused by flutter. But the section-type shape of tension matters:
  // climax needs peaks preserved (flutter suppresses), resolution/coda
  // benefit from flutter's valley-restoration. Multiplier on FLUTTER_PROB
  // per section type. Climax near-zero (let peaks stand); coda/resolution
  // elevated (fullest dynamic range in closing sections).
  const FLUTTER_SECTION_MULT = {
    intro: 1.0,
    exposition: 1.0,
    development: 1.0,
    climax: 0.2,
    resolution: 1.4,
    conclusion: 1.3,
    coda: 1.5,
  };
  let lastFireTime = -Infinity;

  function _allPanChannels() {
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

    const channels = _allPanChannels();
    if (channels.length === 0) return;
    const ch = channels[ri(channels.length - 1)];

    let bias = 0;
    let isFlutter = false;
    const trend = channelStateField.recentTrend(ch, 'pan');
    const flutterMult = FLUTTER_SECTION_MULT[currentSectionType] || 1.0;
    if (trend !== 0 && rf() < FLUTTER_PROB * flutterMult) {
      // Strobe inversion flutter: push HARD against the trend at peak
      // amplitude. Creates dynamic-range contrast flashes that would
      // otherwise be smoothed away by cooperation. Tagged distinctly in
      // the substrate so CIM can track its fire count and effect.
      bias = -trend * MAX_BIAS;
      isFlutter = true;
    } else if (trend !== 0 && rf() < COOPERATION_PROB) {
      // Cooperation mode: reinforce the slot's existing direction.
      // Small amplitude so cooperation feels like a gentle amplification,
      // not a new push. Gives the synergy bucket a population.
      bias = trend * rf(6, 16);
    } else if (regime === 'coherent') {
      // R37 amplification: widen every regime so fires are audibly different
      // from center, not jitter that averages to zero.
      bias = rf(-18, 18);
    } else if (regime === 'exploring') {
      bias = rf() < 0.5 ? rf(18, 44) : rf(-44, -18);
    } else if (regime === 'evolving') {
      bias = m.sin(beatCount * 0.3 + subdivIndex * 0.7 + subsubdivIndex * 1.3) * rf(18, 34);
    } else {
      bias = rf(-20, 20);
    }
    bias = m.round(clamp(bias, -MAX_BIAS, MAX_BIAS));
    const pan = clamp(CENTER_PAN + bias, 0, MIDI_MAX_VALUE);

    lastFireTime = now;
    channelStateField.observeControl(ch, 10, pan, isFlutter ? 'regimePan-flutter' : 'regimePan');
    p(c, { timeInSeconds: now, type: 'control_c', vals: [ch, 10, pan] });
  }

  // Back-compat shim: processBeat still calls apply() per beat.
  function apply() { tick('beat'); }

  return { tick, apply };
  },
});
