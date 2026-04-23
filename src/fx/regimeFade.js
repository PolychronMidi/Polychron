// regimeFade.js - sub-beat volume (CC7) contention writer.
//
// Sibling to regimePan on the fade dimension. R37 substrate data showed all
// new contention was on pan only; fade, fx, and velocity were still mostly
// single-writer dimensions (setBalanceAndFX/setBinaural monoliths). Adding
// a second voice on CC7 widens the dimensional footprint of the sub-beat
// dynamics intervention so cooperation/antagonism statistics populate across
// more slot types, not just pan.
//
// Regime shape mirrors regimePan but in volume-space:
//   coherent   -> small crescendo/decrescendo around center volume
//   exploring  -> bolder dynamic jumps (quiet vs loud swings)
//   evolving   -> slow arc: sin() phrases across beats
//   initializing -> inert
//
// Rate-limit shared with regimePan (0.05s min between fires) to prevent
// high-BPM sections from flooding the MIDI buffer with CC events.

regimeFade = (() => {
  const CENTER_FADE = 100;
  const MAX_BIAS = 27;

  const UNIT_PROB = {
    beat: 1.0,
    div: 0.5,
    subdiv: 0.25,
    subsubdiv: 0.15,
  };

  const MIN_FIRE_INTERVAL_SEC = 0.05;
  // R40: 25% cooperation branch reads slot trend and reinforces it. See
  // regimePan.js for the full rationale. Fade already shows cooperation
  // (+0.416 in R40 fieldByParam), so cooperation mode here makes an
  // already-aligning dimension more strongly aligning -- pushing fade
  // slots deeper into the synergy bucket.
  // R43: dial back from 0.40 to 0.30; strobe inversion flutter below
  // handles contrast preservation. See regimePan for full rationale.
  // R44: fade was the only dimension to cross +0.4 aggregate cooperation
  // (+0.426). regimePan stayed at -0.244 and regimeFx at -0.682 -- fade is
  // working where the others aren't. Push it harder (0.30 -> 0.40) to drive
  // individual fade multi-writer slots above +0.4 and finally populate
  // trueSynergyCount. Targeted amplification of the one working dimension.
  const COOPERATION_PROB = 0.40;
  const FLUTTER_PROB = 0.05;
  // See regimePan.js for rationale. Section-type flutter multiplier:
  // climax preserves peaks, coda/resolution get full dynamic range.
  const FLUTTER_SECTION_MULT = {
    intro: 1.0, exposition: 1.0, development: 1.0,
    climax: 0.2, resolution: 1.4, conclusion: 1.3, coda: 1.5,
  };
  let lastFireTime = -Infinity;

  // Fade writes MUST NOT land on binaural-reserved channels. setBinaural
  // owns CC7 on flipBinF2 + flipBinT2 (the non-center spatial channels)
  // for imperceptible 8-12Hz neurostimulation. regimeFade's regime-biased
  // volume nudges would corrupt the binaural signal if emitted there.
  // Restrict regimeFade to the center / drum channels only: cCH1, cCH2,
  // drumCH, cCH3. This also happens to be where stutterFade writes, so
  // multi-writer fade dynamics still emerge on those channels.
  function _allFadeChannels() {
    return [cCH1, cCH2, drumCH, cCH3];
  }

  function tick(unit) {
    const prob = UNIT_PROB[unit];
    if (!prob || rf() > prob) return;

    const now = unitStartTime || beatStartTime;
    if (now - lastFireTime < MIN_FIRE_INTERVAL_SEC) return;

    const snapshot = systemDynamicsProfiler.getSnapshot();
    const regime = snapshot.regime || 'coherent';
    if (regime === 'initializing') return;

    const channels = _allFadeChannels();
    if (channels.length === 0) return;
    const ch = channels[ri(channels.length - 1)];

    let bias = 0;
    let isFlutter = false;
    const trend = channelStateField.recentTrend(ch, 'fade');
    const flutterMult = FLUTTER_SECTION_MULT[currentSectionType] || 1.0;
    if (trend !== 0 && rf() < FLUTTER_PROB * flutterMult) {
      bias = -trend * MAX_BIAS;
      isFlutter = true;
    } else if (trend !== 0 && rf() < COOPERATION_PROB) {
      bias = trend * rf(5, 12);
    } else if (regime === 'coherent') {
      bias = rf(-8, 8);
    } else if (regime === 'exploring') {
      bias = rf() < 0.5 ? rf(10, 25) : rf(-25, -10);
    } else if (regime === 'evolving') {
      bias = m.sin(beatCount * 0.25 + subdivIndex * 0.6 + subsubdivIndex * 1.1) * rf(12, 22);
    } else {
      bias = rf(-10, 10);
    }
    bias = m.round(clamp(bias, -MAX_BIAS, MAX_BIAS));
    const fade = clamp(CENTER_FADE + bias, 0, MIDI_MAX_VALUE);

    lastFireTime = now;
    channelStateField.observeControl(ch, 7, fade, isFlutter ? 'regimeFade-flutter' : 'regimeFade');
    p(c, { timeInSeconds: now, type: 'control_c', vals: [ch, 7, fade] });
  }

  return { tick };
})();
