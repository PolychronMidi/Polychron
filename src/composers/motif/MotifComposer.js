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
    const opts = options || {};

    // length
    if (opts.length !== undefined) {
      if (!Number.isFinite(Number(opts.length)) || Number(opts.length) <= 0) throw new Error('MotifComposer: options.length must be a positive number');
      this.length = Math.max(1, Math.round(Number(opts.length)));
    } else {
      this.length = 4;
    }

    // default duration multiplier
    if (opts.defaultDuration !== undefined) {
      if (!Number.isFinite(Number(opts.defaultDuration)) || Number(opts.defaultDuration) <= 0) throw new Error('MotifComposer: options.defaultDuration must be a positive number');
      this.defaultDuration = Number(opts.defaultDuration);
    } else {
      this.defaultDuration = 1;
    }

    // octave range
    if (opts.octaveRange !== undefined) {
      if (!Array.isArray(opts.octaveRange) || opts.octaveRange.length < 2 || !Number.isFinite(Number(opts.octaveRange[0])) || !Number.isFinite(Number(opts.octaveRange[1]))) {
        throw new Error('MotifComposer: options.octaveRange must be an array [min,max] of numbers');
      }
      this.octaveRange = [Math.round(Number(opts.octaveRange[0])), Math.round(Number(opts.octaveRange[1]))];
      if (this.octaveRange[0] > this.octaveRange[1]) throw new Error('MotifComposer: octaveRange min must be <= max');
    } else {
      this.octaveRange = [3, 5];
    }

    this.useVoiceLeading = Boolean(opts.useVoiceLeading);

    if (opts.VoiceLeadingScore !== undefined) {
      if (!opts.VoiceLeadingScore || typeof opts.VoiceLeadingScore.selectNextNote !== 'function') {
        throw new Error('MotifComposer: options.VoiceLeadingScore provided but invalid');
      }
      this.VoiceLeadingScore = opts.VoiceLeadingScore;
    } else {
      this.VoiceLeadingScore = this.useVoiceLeading ? new VoiceLeadingScore() : null;
    }

    // duration unit
    const validUnits = ['measure', 'beat', 'div', 'subdiv', 'subsubdiv'];
    if (opts.durationUnit !== undefined) {
      if (typeof opts.durationUnit !== 'string' || !validUnits.includes(opts.durationUnit)) throw new Error('MotifComposer: durationUnit must be one of ' + validUnits.join(', '));
      this.durationUnit = opts.durationUnit;
    } else {
      this.durationUnit = 'subdiv';
    }

    if (opts.durationScale !== undefined) {
      if (!Number.isFinite(Number(opts.durationScale)) || Number(opts.durationScale) <= 0) throw new Error('MotifComposer: durationScale must be a positive number');
      this.durationScale = Number(opts.durationScale);
    } else {
      this.durationScale = 1;
    }

    if (opts.developFromComposer !== undefined) {
      if (!opts.developFromComposer || typeof opts.developFromComposer.getNotes !== 'function') throw new Error('MotifComposer: developFromComposer must implement getNotes()');
      this.developFromComposer = opts.developFromComposer;
    } else {
      this.developFromComposer = null;
    }

    if (opts.measureComposer !== undefined) {
      if (!opts.measureComposer || (typeof opts.measureComposer.getVoicingIntent !== 'function' && typeof opts.measureComposer.selectNoteWithLeading !== 'function')) {
        throw new Error('MotifComposer: measureComposer must implement getVoicingIntent() or selectNoteWithLeading()');
      }
      this.measureComposer = opts.measureComposer;
    } else {
      this.measureComposer = null;
    }

    this._motifInstanceId = (typeof opts.motifInstanceId === 'string' && opts.motifInstanceId) ? opts.motifInstanceId : ('motif-' + Math.floor(Math.random() * 1e9));
    this._motifSequenceId = 0;
  }

  // NOTE: unit tick resolution moved to MotifUnit.unitTicks (src/composers/motif/MotifUnit.js)

  /**
   * Generate a Motif instance.
   * @param {{length?:number, scaleComposer?:ScaleComposer, defaultDuration?:number, durationUnit?:string, durationScale?:number, fitToTotalTicks?:boolean, fitToPhrase?:boolean, totalTicks?:number, developFromComposer?:object, measureComposer?:MeasureComposer}} opts
   * @returns {Motif|object}
   */
  generate(opts = {}) {
    const optsAny = /** @type {any} */ (opts);
    // Resolve/validate overridable options (fail-fast on invalid types)
    let length;
    if (optsAny.length !== undefined) {
      if (!Number.isFinite(Number(optsAny.length)) || Number(optsAny.length) <= 0) throw new Error('MotifComposer.generate: invalid length option');
      length = Math.max(1, Math.round(Number(optsAny.length)));
    } else {
      length = this.length;
    }

    let durationMult;
    if (optsAny.defaultDuration !== undefined) {
      if (!Number.isFinite(Number(optsAny.defaultDuration)) || Number(optsAny.defaultDuration) <= 0) throw new Error('MotifComposer.generate: invalid defaultDuration option');
      durationMult = Number(optsAny.defaultDuration);
    } else {
      durationMult = this.defaultDuration;
    }

    let durationUnit;
    if (optsAny.durationUnit !== undefined) {
      const validUnits = ['measure', 'beat', 'div', 'subdiv', 'subsubdiv'];
      if (typeof optsAny.durationUnit !== 'string' || !validUnits.includes(optsAny.durationUnit)) throw new Error('MotifComposer.generate: invalid durationUnit option');
      durationUnit = optsAny.durationUnit;
    } else {
      durationUnit = this.durationUnit;
    }

    const durationScale = (optsAny.durationScale !== undefined) ? (Number.isFinite(Number(optsAny.durationScale)) ? Number(optsAny.durationScale) : (() => { throw new Error('MotifComposer.generate: invalid durationScale option'); })()) : this.durationScale;

    // Prefer developFromComposer if provided in call, else fall back to instance-level composer
    let developer = null;
    if (optsAny.developFromComposer !== undefined) {
      if (!optsAny.developFromComposer || typeof optsAny.developFromComposer.getNotes !== 'function') throw new Error('MotifComposer.generate: developFromComposer option must implement getNotes()');
      developer = optsAny.developFromComposer;
    } else if (this.developFromComposer !== null) {
      developer = this.developFromComposer;
    }

    // Resolve scale notes - must have explicit scale source
    let scaleNotes = [];
    if (optsAny.scaleComposer && typeof optsAny.scaleComposer.getNotes === 'function') {
      scaleNotes = optsAny.scaleComposer.getNotes();
      if (!scaleNotes) throw new Error('MotifComposer.generate: scaleComposer.getNotes() returned null/undefined - fail-fast');
    } else if (developer && typeof developer.getNotes === 'function') {
      // If developer provided, seed scale notes from it
      scaleNotes = developer.getNotes();
      if (!scaleNotes) throw new Error('MotifComposer.generate: developFromComposer.getNotes() returned null/undefined - fail-fast');
    } else {
      throw new Error('MotifComposer.generate: must provide scaleComposer or developFromComposer - no default fallback');
    }
    if (!Array.isArray(scaleNotes) || scaleNotes.length === 0) {
      throw new Error(`MotifComposer.generate: scaleComposer/developFromComposer returned empty or invalid scale notes`);
    }

    // Validate scaleNotes against developer.notes if available (strict pitch class check)
    MotifValidators.assertScaleMatchesDeveloper(scaleNotes, developer);

    // Build candidates from scaleNotes (fail-fast on malformed data)
    const candidates = scaleNotes.map((s, idx) => {
      if (typeof s.note === 'number') return s.note;
      if (typeof s === 'number') return s;
      throw new Error(`MotifComposer.generate: scaleNotes[${idx}] is neither {note:number} nor number - got ${JSON.stringify(s)} - fail-fast`);
    });

    if (candidates.length === 0) {
      throw new Error('MotifComposer.generate: candidates empty after building from scaleNotes—fail-fast (no emergency C4 fallback)');
    }

    const seq = [];
    const lastNotes = [];

    // If developer provides a note feed, cycle through its notes with octave normalization
    let devNotes = null;
    if (developer && typeof developer.getNotes === 'function') {
      devNotes = developer.getNotes();
      if (devNotes && !Array.isArray(devNotes)) {
        throw new Error('MotifComposer.generate: developer.getNotes() returned non-array - fail-fast');
      }
    }

    // Validate developer note feed items if present (fail-fast on malformed entries)
    if (devNotes && Array.isArray(devNotes)) {
      for (let i = 0; i < devNotes.length; i++) {
        const n = devNotes[i];
        if (!(typeof n === 'number' || (n && typeof n.note === 'number'))) {
          throw new Error(`MotifComposer.generate: developer note at index ${i} must be number or {note:number} - got ${JSON.stringify(n)}`);
        }
      }
    }

    // compute default duration in ticks
    const unitTicks = MotifUnit.unitTicks(durationUnit);
    const defaultDurationTicks = Math.max(1, Math.round(unitTicks * durationMult * durationScale));

    // If caller asks to fit the motif into a total tick budget, compute durations accordingly
    const fitToTotal = Boolean(optsAny.fitToTotalTicks || optsAny.fitToPhrase);
    const totalTicksProvided = Number.isFinite(Number(optsAny.totalTicks)) ? Number(optsAny.totalTicks) : null;
    const inferredTotalTicks = (fitToTotal && (totalTicksProvided || (typeof measuresPerPhrase !== 'undefined' && Number.isFinite(Number(tpMeasure)) && Number.isFinite(Number(measuresPerPhrase)))))
      ? (totalTicksProvided || (measuresPerPhrase * Number(tpMeasure)))
      : null;

    let targetDurations = null;
    if (inferredTotalTicks) {
      targetDurations = MotifDurationPlanner.buildTargetDurations(length, inferredTotalTicks);
    }

    const VC = (typeof VoiceManager !== 'undefined' && VoiceManager)
      ? VoiceManager
      : (() => { throw new Error('MotifComposer.generate: VoiceManager not available'); })();
    const motifLayer = VC ? { id: `${this._motifInstanceId}-${this._motifSequenceId++}` } : null;

    for (let i = 0; i < length; i++) {
      let chosen;

      // Prefer notes from developer feed when available, but constrain to scale candidates
      if (devNotes && devNotes.length > 0) {
        const n = devNotes[i % devNotes.length];
        const devNote = (typeof n.note === 'number') ? n.note : (typeof n === 'number' ? n : 60);
        // Constrain developer note to nearest note in the scale
        const normalized = devNote % 12;
        const matchInCandidates = candidates.find(c => (c % 12) === normalized);
        chosen = matchInCandidates !== undefined ? matchInCandidates : candidates[Math.floor(Math.random() * candidates.length)];
      } else if (this.measureComposer || optsAny.measureComposer) {
        // Use centralized voice coordination for single-voice selection
        const mc = optsAny.measureComposer || this.measureComposer;
        const avail = Array.from(new Set(candidates)).sort((a, b) => a - b);
        if (VC && typeof VC.pickNotesForBeat === 'function') {
          const scorer = mc && mc.VoiceLeadingScore ? mc.VoiceLeadingScore : null;
          const intent = mc && typeof mc.getVoicingIntent === 'function' ? mc.getVoicingIntent(avail) : null;
          const voiceOpts = Object.assign({ register: 'soprano' }, intent || {});
          const targetLayer = motifLayer || mc || {};
          const selected = VC.pickNotesForBeat(targetLayer, avail, 1, scorer, voiceOpts);
          chosen = (Array.isArray(selected) && selected.length > 0) ? selected[0] : avail[(typeof ri === 'function') ? ri(avail.length - 1) : Math.floor(Math.random() * avail.length)];
        } else {
          try { chosen = mc.selectNoteWithLeading ? mc.selectNoteWithLeading(avail) : avail[(typeof ri === 'function') ? ri(avail.length - 1) : Math.floor(Math.random() * avail.length)]; } catch (e) { chosen = avail[Math.floor(Math.random() * avail.length)]; }
        }
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
        const jitter = (typeof rv === 'function') ? rv(0.9, 1.1) : (0.9 + Math.random() * 0.2);
        dur = Math.max(1, Math.round(defaultDurationTicks * jitter));
      }

      // Validate chosen note is in candidates (valid pitch class from composer)
      if (!candidates.includes(chosen)) {
        throw new Error(`MotifComposer.generate: chosen note ${chosen} (PC ${((chosen % 12) + 12) % 12}) not in valid candidates. Valid PCs: ${Array.from(new Set(candidates.map(c => ((c % 12) + 12) % 12))).sort((a,b)=>a-b).join(',')}`);
      }
      seq.push({ note: chosen, duration: dur });
    }

    if (VC && motifLayer && typeof VC.resetLayer === 'function') {
      VC.resetLayer(motifLayer);
    }

    const MotifCtor = (typeof Motif !== "undefined") ? Motif : null;
    if (MotifCtor) return new MotifCtor(seq, { defaultDuration: 1 }); // durations are in ticks now
    // Fail-fast: Motif class is required
    throw new Error('MotifComposer.generate: Motif class not available');
  }
};
