// shred.js — C-major riff shredder: 10 measures with oscillating pace,
// sustained chord voicings intertwined with rapid scalar shredding.
// Single channel (cCH1), no bass, no reflection, no binaural, no
// sections/phrases — just measures, beats, divs, subdivs, subsubdivs.

shred = async function shred() { console.warn('Acceptable warning: Starting riffShredder/shred.js ...');

  // ── Fixed sandbox constants ───────────────────────────────────────
  const SHRED_BPM = 72;
  const SHRED_MEASURES = 10;
  const NUM = 4;
  const DEN = 4;
  const CH = cCH1; // single output channel

  // C-major scale notes across octaves 3–6
  const C_MAJOR_PCS = [0, 2, 4, 5, 7, 9, 11];
  const SCALE = [];
  for (let oct = 3; oct <= 6; oct++) {
    for (const pc of C_MAJOR_PCS) SCALE.push(oct * 12 + pc);
  }
  // Chord voicing sets — root-position triads and 7ths across octaves
  const VOICINGS = [
    [48, 52, 55],           // C3 E3 G3
    [55, 60, 64],           // G3 C4 E4
    [60, 64, 67, 72],       // C4 E4 G4 C5
    [64, 67, 72, 76],       // E4 G4 C5 E5
    [48, 55, 64, 72],       // C3 G3 E4 C5  (wide spread)
    [43, 48, 52, 60],       // G2 C3 E3 C4
    [36, 48, 55, 64, 72],   // C2 C3 G3 E4 C5  (power voicing)
    [52, 55, 60, 67],       // E3 G3 C4 G4
    [55, 59, 64, 67],       // G3 B3 E4 G4  (Em colour)
    [53, 57, 60, 65],       // F3 A3 C4 F4  (F major colour)
  ];
  // Flat list of chord tones for single-note picking at low intensity
  const CHORD_PCS = [0, 4, 7];
  const CHORDS = [];
  for (let oct = 3; oct <= 5; oct++) {
    for (const pc of CHORD_PCS) CHORDS.push(oct * 12 + pc);
  }

  // ── Register single layer ─────────────────────────────────────────
  const comp = new MeasureComposer();
  comp.notes = C_MAJOR_PCS;
  comp.scale = { name: 'C major' };
  comp.lastMeter = [NUM, DEN];
  comp.getMeter = () => [NUM, DEN];
  comp.getNumerator = () => NUM;
  comp.getDenominator = () => DEN;

  LM.register('SHRED', 'shred', {}, () => {
    p(c, { tick: 0, type: 'program_c', vals: [CH, 0] });
    p(c, { tick: 0, type: 'control_c', vals: [CH, 7, 127] });
  });
  LM.setComposerFor('SHRED', comp);
  LM.activate('SHRED', false);

  // ── Set timing globals ────────────────────────────────────────────
  BPM = SHRED_BPM;
  numerator = NUM;
  denominator = DEN;
  getMidiTiming();

  totalSections = 1; sectionIndex = 0;
  phrasesPerSection = 1; phraseIndex = 0;
  measureCount = 0;
  sectionStart = 0; sectionStartTime = 0;
  phraseStart = 0; phraseStartTime = 0;
  LM.setSectionStartAll();
  setUnitTiming('section');
  measuresPerPhrase = SHRED_MEASURES;
  measuresPerPhrase1 = SHRED_MEASURES;
  tpPhrase = tpMeasure * SHRED_MEASURES;
  spPhrase = tpPhrase / tpSec;
  setUnitTiming('phrase');

  // ── Oscillating intensity ─────────────────────────────────────────
  // Three nested oscillation layers:
  //   1. Slow envelope (sine bell across 10 measures)
  //   2. Beat-level ripple (~3 cycles) + jitter
  //   3. Micro-hyper oscillation at div/subdiv granularity — rapid
  //      flickering that makes intensity surge and dip *within* a beat
  const envelope = (mi) => m.pow(m.sin(m.PI * m.pow(mi / (SHRED_MEASURES - 1), 0.85)), 1.4);
  const oscillate = (mi, bi) => {
    const base = envelope(mi);
    const phase = (mi * NUM + bi) / (SHRED_MEASURES * NUM);
    const ripple = 0.25 * m.sin(phase * m.PI * 2 * 3.3 + 1.1);
    const jitter = rf(-0.12, 0.12);
    return clamp(base + ripple + jitter, 0, 1);
  };
  // Micro-hyper: flicker intensity at div/subdiv level within a beat
  const microOsc = (beatIntensity, di, si) => {
    // Two fast sine layers at incommensurate rates for chaotic flicker
    const t = di * 7.1 + si * 13.3;
    const flicker1 = 0.15 * m.sin(t * 2.7 + beatIntensity * 9.0);
    const flicker2 = 0.10 * m.sin(t * 5.3 - beatIntensity * 4.1);
    const spike = rf(-0.08, 0.08);
    return clamp(beatIntensity + flicker1 + flicker2 + spike, 0, 1);
  };

  // ── Note picker for scalar runs ───────────────────────────────────
  let last = CHORDS[ri(CHORDS.length - 1)];

  const pick = (i) => {
    if (i < 0.2) {
      const s = CHORDS.slice().sort((a, b) => m.abs(a - last) - m.abs(b - last));
      last = s[ri(m.min(2, s.length - 1))];
      return last;
    }
    const step = (i > 0.6 ? 1 : ri(1, 2)) * (rf() < 0.55 ? 1 : -1);
    let idx = SCALE.indexOf(last);
    if (idx === -1) idx = SCALE.reduce((b, n, j) => m.abs(n - last) < m.abs(SCALE[b] - last) ? j : b, 0);
    idx = modClamp(idx + step, 0, SCALE.length - 1);
    last = SCALE[idx];
    return last;
  };

  // ── Emit helpers ──────────────────────────────────────────────────
  // Single note
  const emit = (note, vel, susMult) => {
    const v = m.max(1, m.min(127, m.round(vel)));
    const on = unitStart + tpUnit * rf(0, 0.04);
    const sus = m.max(tpUnit * 0.05, tpUnit * susMult * rf(0.8, 1.2));
    const onEvt = { tick: on, type: 'on', vals: [CH, note, v] };
    const offEvt = { tick: on + sus, vals: [CH, note] };
    microUnitAttenuator.record(onEvt, offEvt, crossModulation);
  };

  // Sustained chord voicing — fires all notes simultaneously with
  // long sustain so they ring underneath scalar runs.
  const emitChord = (voicing, vel, sustainTicks) => {
    const on = unitStart + tpUnit * rf(0, 0.02);
    for (let ni = 0; ni < voicing.length; ni++) {
      const note = voicing[ni];
      // Slight velocity spread across chord tones for richness
      const v = m.max(1, m.min(127, m.round(vel * rf(0.85, 1.05))));
      // Stagger each note by a few ticks for a strummed feel
      const stagger = ni * tpUnit * rf(0.003, 0.012);
      const onEvt = { tick: on + stagger, type: 'on', vals: [CH, note, v] };
      const offEvt = { tick: on + stagger + sustainTicks * rf(0.9, 1.1), vals: [CH, note] };
      microUnitAttenuator.record(onEvt, offEvt, crossModulation);
    }
  };

  // ── Quick chord burst — staccato chord stab for shredding sections ─
  const emitChordBurst = (vel) => {
    const voicing = VOICINGS[ri(VOICINGS.length - 1)];
    // Very short sustain — percussive stab, not a pad
    const burstSus = tpUnit * rf(0.15, 0.4);
    const on = unitStart + tpUnit * rf(0, 0.03);
    for (let ni = 0; ni < voicing.length; ni++) {
      const v = m.max(1, m.min(127, m.round(vel * rf(0.9, 1.1))));
      const stagger = ni * tpUnit * rf(0.001, 0.006);
      const onEvt = { tick: on + stagger, type: 'on', vals: [CH, voicing[ni], v] };
      const offEvt = { tick: on + stagger + burstSus * rf(0.85, 1.15), vals: [CH, voicing[ni]] };
      microUnitAttenuator.record(onEvt, offEvt, crossModulation);
    }
  };

  // ── Scalar flurry — rapid 3–6 note burst for chordal sections ─────
  const emitFlurry = (intensity, vel) => {
    const nNotes = ri(3, 6);
    const dir = rf() < 0.5 ? 1 : -1;
    let idx = SCALE.indexOf(last);
    if (idx === -1) idx = SCALE.reduce((b, n, j) => m.abs(n - last) < m.abs(SCALE[b] - last) ? j : b, 0);
    const gap = tpUnit * rf(0.03, 0.08); // tiny gap between flurry notes
    const on0 = unitStart + tpUnit * rf(0, 0.03);
    for (let fi = 0; fi < nNotes; fi++) {
      idx = modClamp(idx + dir * ri(1, 2), 0, SCALE.length - 1);
      const note = SCALE[idx];
      const v = m.max(1, m.min(127, m.round(vel * rf(0.7, 1.0) * (1 - fi * 0.06))));
      const fSus = tpUnit * rf(0.08, 0.2);
      const onEvt = { tick: on0 + gap * fi, type: 'on', vals: [CH, note, v] };
      const offEvt = { tick: on0 + gap * fi + fSus, vals: [CH, note] };
      microUnitAttenuator.record(onEvt, offEvt, crossModulation);
    }
    last = SCALE[idx];
  };

  // ── Voicing selector — picks voicings that move smoothly ──────────
  let lastVoicingIdx = ri(VOICINGS.length - 1);
  const pickVoicing = () => {
    const candidates = VOICINGS.map((v, i) => {
      const dist = m.abs(v[0] - VOICINGS[lastVoicingIdx][0]);
      return { i, dist };
    }).sort((a, b) => a.dist - b.dist);
    const pick3 = rf() < 0.8 ? ri(0, m.min(3, candidates.length - 1)) : ri(candidates.length - 1);
    lastVoicingIdx = candidates[pick3].i;
    return VOICINGS[lastVoicingIdx];
  };

  // ── MAIN LOOP: measures → beats → divs → subdivs → subsubdivs ────
  for (measureIndex = 0; measureIndex < SHRED_MEASURES; measureIndex++) {
    measureCount++;

    for (beatIndex = 0; beatIndex < NUM; beatIndex++) {
      // Per-beat oscillating intensity — the core driver of pace
      const mi = oscillate(measureIndex, beatIndex);

      // Density ramps with intensity (per-beat, not per-measure)
      const nDivs = m.max(1, m.round(1 + 7 * mi));
      const nSubs = m.max(1, m.round(1 + 5 * m.pow(mi, 1.2)));
      const nSubsubs = m.max(1, m.round(1 + 4 * m.pow(mi, 1.5)));

      comp.getDivisions = () => nDivs;
      comp.getSubdivs = () => nSubs;
      comp.getSubsubdivs = () => nSubsubs;
      comp.getNotes = () => SCALE.map(n => ({ note: n }));
      LM.setComposerFor('SHRED', comp);

      if (beatIndex === 0) setUnitTiming('measure');
      setUnitTiming('beat');
      crossModulateRhythms();

      // ── Chords on beats — sustained voicings that ring ──────────
      // Higher chance when intensity is moderate (0.15–0.7) so chords
      // underpin the shredding; still possible at high intensity for
      // dramatic stacked moments
      const chordProb = mi < 0.15 ? 0.85 : mi < 0.5 ? 0.65 : 0.35;
      if (rf() < chordProb) {
        const voicing = pickVoicing();
        // Chord sustain: 1–4 beats long, longer at low intensity
        const chordBeats = clamp(m.round(rf(1.5, 4.5) * (1.3 - mi)), 1, 4);
        const chordSus = tpBeat * chordBeats;
        const chordVel = clamp(m.round(55 + 35 * (1 - mi) + rf(-8, 8)), 35, 110);
        emitChord(voicing, chordVel, chordSus);
      }

      // ── Single-note shred on beats ─────────────────────────────
      const vel = m.round(clamp(50 + 77 * mi, 40, 127));
      const sus = clamp(2.0 - 1.85 * mi, 0.1, 2.0);
      emit(pick(mi), vel, sus);

      // ── Div layer ──────────────────────────────────────────────
      microUnitAttenuator.begin('div', nDivs);
      for (divIndex = 0; divIndex < nDivs; divIndex++) {
        setUnitTiming('div');
        crossModulateRhythms();
        const dI = microOsc(mi, divIndex, 0); // micro-hyper intensity at div

        if (divIndex > 0 && dI > 0.15) {
          emit(pick(dI), m.round(vel * rf(0.85, 1.05)), sus);
        }
        // Low-intensity div: chance of a quick scalar flurry burst
        if (dI < 0.3 && rf() < 0.25) {
          emitFlurry(dI, m.round(vel * rf(0.6, 0.85)));
        }

        // ── Subdiv layer ────────────────────────────────────────
        microUnitAttenuator.begin('subdiv', nSubs);
        for (subdivIndex = 0; subdivIndex < nSubs; subdivIndex++) {
          setUnitTiming('subdiv');
          crossModulateRhythms();
          const sI = microOsc(mi, divIndex, subdivIndex); // micro-hyper at subdiv

          if (subdivIndex > 0 && sI > 0.3) {
            emit(pick(sI), m.round(vel * rf(0.75, 1.0)), sus * 0.6);
          }
          // High-intensity subdiv: chance of a quick chord burst stab
          if (sI > 0.55 && rf() < 0.2) {
            emitChordBurst(m.round(vel * rf(0.75, 0.95)));
          }
          // Low-intensity subdiv: chance of a scalar flurry
          if (sI < 0.25 && rf() < 0.18) {
            emitFlurry(sI, m.round(vel * rf(0.55, 0.8)));
          }

          // ── Subsubdiv layer — real shredding ──────────────────
          microUnitAttenuator.begin('subsubdiv', nSubsubs);
          for (subsubdivIndex = 0; subsubdivIndex < nSubsubs; subsubdivIndex++) {
            setUnitTiming('subsubdiv');
            crossModulateRhythms();
            const ssI = microOsc(mi, divIndex * nSubs + subdivIndex, subsubdivIndex);

            if (subsubdivIndex > 0 && ssI > 0.4) {
              emit(pick(ssI), m.round(vel * rf(0.65, 0.95)), sus * 0.3);
            }
            // Deep shredding: stab a chord burst into the run
            if (ssI > 0.65 && rf() < 0.12) {
              emitChordBurst(m.round(vel * rf(0.7, 0.9)));
            }
          }
          microUnitAttenuator.flush();
        }
        microUnitAttenuator.flush();
      }
      microUnitAttenuator.flush();
    }
  }

  grandFinale();
  console.warn('Acceptable warning: riffShredder/shred.js complete — output written.');
};
