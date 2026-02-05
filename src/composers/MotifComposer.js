// MotifComposer - thin adapter to produce Motif objects from scale/meter/voice-leading
// Dependencies are required via `src/composers/index.js` (aggregated side-effect requires)

/**
 * MotifComposer: factory for short motifs that fit a scale/meter and optionally use voice-leading.
 * Features:
 *  - durationUnit: choose 'measure'|'beat'|'div'|'subdiv'|'subsubdiv' (defaults to 'subdiv')
 *  - durationScale: multiplies computed unit length
 *  - developFromComposer: optional composer with getNotes() to seed motif pitches
 *  - measureComposer: optional MeausreComposer to select notes with voice-leading hooks
 * Usage: new MotifComposer(opts).generate({ length, scaleComposer, defaultDuration })
 */
MotifComposer = class MotifComposer {
  constructor(options = {}) {
    this.length = options.length || 4;
    this.defaultDuration = options.defaultDuration || 1; // multiplier of chosen unit
    this.octaveRange = options.octaveRange || [3, 5]; // inclusive
    this.useVoiceLeading = Boolean(options.useVoiceLeading);
    this.VoiceLeadingScore = options.VoiceLeadingScore || (this.useVoiceLeading ? new VoiceLeadingScore() : null);
    this.durationUnit = options.durationUnit || 'subdiv';
    this.durationScale = options.durationScale || 1;
    this.developFromComposer = options.developFromComposer || null; // composer with getNotes()
    this.measureComposer = options.measureComposer || null; // optional MeasureComposer to use selectNoteWithLeading
  }

  /** Resolve global ticks for a unit. Falls back to sensible defaults. */
  _unitTicks(unit) {
    try {
      switch ((unit || '').toLowerCase()) {
        case 'measure': return Number.isFinite(Number(tpMeasure)) ? Number(tpMeasure) : 1920;
        case 'beat': return Number.isFinite(Number(tpBeat)) ? Number(tpBeat) : 480;
        case 'div': return Number.isFinite(Number(tpDiv)) ? Number(tpDiv) : 120;
        case 'subdiv': return Number.isFinite(Number(tpSubdiv)) ? Number(tpSubdiv) : 30;
        case 'subsubdiv': return Number.isFinite(Number(tpSubsubdiv)) ? Number(tpSubsubdiv) : 8;
        default: return Number.isFinite(Number(tpSubdiv)) ? Number(tpSubdiv) : 30;
      }
    } catch (e) { return 30; }
  }

  /**
   * Generate a Motif instance.
   * @param {{length?:number, scaleComposer?:ScaleComposer, defaultDuration?:number, durationUnit?:string, durationScale?:number, fitToTotalTicks?:boolean, fitToPhrase?:boolean, totalTicks?:number, developFromComposer?:object, measureComposer?:MeasureComposer}} opts
   * @returns {Motif|object}
   */
  generate(opts = {}) {
    const optsAny = /** @type {any} */ (opts);
    const length = optsAny.length || this.length;
    const durationMult = optsAny.defaultDuration || this.defaultDuration;
    const durationUnit = optsAny.durationUnit || this.durationUnit;
    const durationScale = typeof optsAny.durationScale === 'number' ? optsAny.durationScale : this.durationScale;

    // Prefer developFromComposer if provided in call, else fall back to instance-level composer
    const developer = optsAny.developFromComposer || this.developFromComposer || null;

    // Resolve scale notes (fallback to safe Major/C scale)
    let scaleNotes = [];
    if (optsAny.scaleComposer && typeof optsAny.scaleComposer.getNotes === 'function') {
      scaleNotes = opts.scaleComposer.getNotes() || [];
    } else if (developer && typeof developer.getNotes === 'function') {
      // If developer provided, seed scale notes from it
      scaleNotes = developer.getNotes() || [];
    } else {
      console.warn('MotifComposer.generate: no scaleComposer or developFromComposer provided, falling back to C major scale.');
      let sc = null;
      try { sc = new ScaleComposer('major','C'); } catch (e) { sc = null; }
      if (sc && typeof sc.x === 'function') {
        scaleNotes = sc.x() || [];
      } else {
        console.warn('MotifComposer.generate: failed to create fallback ScaleComposer, using single note C (60).');
        scaleNotes = [{ note: 60 }];
      }
    }

    // Build candidate pitches across octave range
    const [minOct, maxOct] = this.octaveRange;
    const candidates = [];
    for (const s of scaleNotes) {
      const base = typeof s.note === 'number' ? s.note % 12 : (Number(s) % 12);
      for (let oct = minOct; oct <= maxOct; oct++) {
        candidates.push(base + oct * 12);
      }
    }

    if (candidates.length === 0) candidates.push(60);

    const seq = [];
    const lastNotes = [];

    // If developer provides a note feed, cycle through its notes with octave normalization
    const devNotes = developer && typeof developer.getNotes === 'function' ? (developer.getNotes() || []) : null;

    // compute default duration in ticks
    const unitTicks = this._unitTicks(durationUnit);
    const defaultDurationTicks = Math.max(1, Math.round(unitTicks * durationMult * durationScale));

    // If caller asks to fit the motif into a total tick budget, compute durations accordingly
    const fitToTotal = Boolean(optsAny.fitToTotalTicks || optsAny.fitToPhrase);
    const totalTicksProvided = Number.isFinite(Number(optsAny.totalTicks)) ? Number(optsAny.totalTicks) : null;
    const inferredTotalTicks = (fitToTotal && (totalTicksProvided || (typeof measuresPerPhrase !== 'undefined' && Number.isFinite(Number(tpMeasure)) && Number.isFinite(Number(measuresPerPhrase)))))
      ? (totalTicksProvided || (measuresPerPhrase * Number(tpMeasure)))
      : null;

    let targetDurations = null;
    if (inferredTotalTicks) {
      // Evenly distribute ticks across motif length; shuffle remainder for variety
      const base = Math.floor(inferredTotalTicks / length);
      const remainder = inferredTotalTicks - base * length;
      targetDurations = Array.from({ length }, (_, i) => base + (i < remainder ? 1 : 0));
      // Randomize distribution slightly while preserving sum: swap some units
      for (let k = 0; k < Math.min(3, length); k++) {
        const i = Math.floor(Math.random() * length);
        const j = Math.floor(Math.random() * length);
        if (i !== j && targetDurations[i] > 1) {
          const delta = Math.round((Math.random() - 0.5) * Math.min(2, Math.floor(targetDurations[i] * 0.1)));
          targetDurations[i] = Math.max(1, targetDurations[i] - delta);
          targetDurations[j] = Math.max(1, targetDurations[j] + delta);
        }
      }
      // Ensure sum unchanged (small numeric safety pass)
      let sum = targetDurations.reduce((a,b)=>a+b,0);
      let idx = 0;
      while (sum !== inferredTotalTicks) {
        if (sum < inferredTotalTicks) { targetDurations[idx % length]++; sum++; }
        else { if (targetDurations[idx % length] > 1) { targetDurations[idx % length]--; sum--; } }
        idx++;
        if (idx > length * 3) break;
      }
    }

    for (let i = 0; i < length; i++) {
      let chosen;

      // Prefer notes from developer feed when available
      if (devNotes && devNotes.length > 0) {
        const n = devNotes[i % devNotes.length];
        chosen = (typeof n.note === 'number') ? n.note : (n ?? 60);
      } else if (this.measureComposer || optsAny.measureComposer) {
        // Use provided measureComposer to select a note using its voice-leading hooks
        const mc = optsAny.measureComposer || this.measureComposer;
        const avail = Array.from(new Set(candidates)).sort((a, b) => a - b);
        try { chosen = mc.selectNoteWithLeading ? mc.selectNoteWithLeading(avail) : avail[(typeof ri === 'function') ? ri(avail.length - 1) : Math.floor(Math.random() * avail.length)]; } catch (e) { chosen = avail[Math.floor(Math.random() * avail.length)]; }
      } else if (this.VoiceLeadingScore && this.useVoiceLeading) {
        const avail = Array.from(new Set(candidates)).sort((a, b) => a - b);
        chosen = this.VoiceLeadingScore.selectNextNote(lastNotes, avail, { register: 'soprano' });
        lastNotes.unshift(chosen);
        if (lastNotes.length > 4) lastNotes.pop();
      } else {
        const randIdx = (typeof ri === 'function') ? ri(candidates.length - 1) : Math.floor(Math.random() * candidates.length);
        chosen = candidates[randIdx];
      }

      let dur;
      if (targetDurations) {
        // use precomputed durations that sum to the target total
        dur = Math.max(1, Math.round(targetDurations[i]));
      } else {
        // Add a small timing variance (±10%) to make motifs feel less rigid
        const jitter = Number.isFinite(Number(rv)) ? rv(0.9, 1.1) : (0.9 + Math.random() * 0.2);
        dur = Math.max(1, Math.round(defaultDurationTicks * jitter));
      }
      seq.push({ note: chosen, duration: dur });
    }

    const MotifCtor = (typeof Motif !== "undefined") ? Motif : null;
    if (MotifCtor) return new MotifCtor(seq, { defaultDuration: 1 }); // durations are in ticks now
    // Fallback: return plain object if Motif class not available
    console.warn('MotifComposer.generate: Motif class not available, returning plain object');
    return { sequence: seq, defaultDuration: 1 };
  }
};
