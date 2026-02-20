const _motV = Validator.create('MotifComposer');
/**
 * MotifComposer: factory for short motifs that fit a scale and optionally use voice-leading.
 * Features:
 *  - developFromComposer: optional composer with getNotes() to seed motif pitches
 *  - measureComposer: optional MeasureComposer to select notes with voice-leading hooks
 * Usage: new MotifComposer(opts).generate({ length, scaleComposer })
 */
MotifComposer = class MotifComposer {
  /**
   * @param {{
   *   length?: number,
   *   octaveRange?: number[],
   *   useVoiceLeading?: boolean,
   *   VoiceLeadingScore?: Object,
   *   developFromComposer?: { getNotes: Function },
   *   measureComposer?: Object,
   *   motifInstanceId?: string
   * }} [options]
   */
  constructor(options = {}) {
    _motV.assertPlainObject(options, 'options');
    const opts = /** @type {any} */ (options || {});

    // length
    if (opts.length !== undefined) {
      if (!Number.isFinite(Number(opts.length)) || Number(opts.length) <= 0) throw new Error('MotifComposer: options.length must be a positive number');
      this.length = m.max(1, m.round(Number(opts.length)));
    } else {
      this.length = 4;
    }

    // octave range
    if (opts.octaveRange !== undefined) {
      if (!Array.isArray(opts.octaveRange) || opts.octaveRange.length < 2 || !Number.isFinite(Number(opts.octaveRange[0])) || !Number.isFinite(Number(opts.octaveRange[1]))) {
        throw new Error('MotifComposer: options.octaveRange must be an array [min,max] of numbers');
      }
      this.octaveRange = [m.round(Number(opts.octaveRange[0])), m.round(Number(opts.octaveRange[1]))];
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

    this._motifInstanceId = (typeof opts.motifInstanceId === 'string' && opts.motifInstanceId) ? opts.motifInstanceId : ('motif-' + ((typeof ri === 'function') ? ri(1e9 - 1) : (() => { throw new Error('Random integer generator ri() not available'); })()));
    this._motifSequenceId = 0;
  }

  /**
   * Generate a Motif instance.
   * @param {{length?:number, scaleComposer?:ScaleComposer, developFromComposer?:object, measureComposer?:MeasureComposer}} opts
   * @returns {Motif|object}
   */
  generate(opts = {}) {
    const optsAny = /** @type {any} */ (opts);
    // Resolve/validate overridable options (fail-fast on invalid types)
    let length;
    if (optsAny.length !== undefined) {
      if (!Number.isFinite(Number(optsAny.length)) || Number(optsAny.length) <= 0) throw new Error('MotifComposer.generate: invalid length option');
      length = m.max(1, m.round(Number(optsAny.length)));
    } else {
      length = this.length;
    }

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

    // Validate scale notes against developer contract.
    const windowScale = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? HarmonicContext.getField('scale')
      : null;
    MotifValidators.assertScaleMatchesDeveloper(scaleNotes, developer, {
      mode: 'auto',
      windowScale,
      context: {
        sectionIndex: (typeof sectionIndex === 'number') ? sectionIndex : null,
        phraseIndex: (typeof phraseIndex === 'number') ? phraseIndex : null,
        measureIndex: (typeof measureIndex === 'number') ? measureIndex : null
      }
    });

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
        chosen = matchInCandidates !== undefined ? matchInCandidates : candidates[(typeof ri === 'function') ? ri(candidates.length - 1) : (()=>{ throw new Error('Random integer generator ri() not available'); })()];
      } else if (this.measureComposer || optsAny.measureComposer) {
        // Use centralized voice coordination for single-voice selection
        const mc = optsAny.measureComposer || this.measureComposer;
        const avail = Array.from(new Set(candidates)).sort((a, b) => a - b);
        if (VC && typeof VC.pickNotesForBeat === 'function') {
          const scorer = mc && mc.VoiceLeadingScore ? mc.VoiceLeadingScore : null;
          const intent = mc && typeof mc.getVoicingIntent === 'function' ? mc.getVoicingIntent(avail) : null;
          if (intent !== null && (typeof intent !== 'object' || Array.isArray(intent))) {
            throw new Error('MotifComposer.generate: measureComposer.getVoicingIntent() must return an object or null');
          }
          const voiceOpts = Object.assign({ register: 'soprano' }, intent || {});
          // targetLayer should be an object (motifLayer preferred, otherwise measureComposer)
          let targetLayer;
          if (motifLayer && typeof motifLayer === 'object') {
            targetLayer = motifLayer;
          } else if (mc && typeof mc === 'object') {
            targetLayer = mc;
          } else {
            throw new Error('MotifComposer.generate: no valid target layer or measureComposer available for voice selection');
          }
          const selected = VC.pickNotesForBeat(targetLayer, avail, 1, scorer, voiceOpts);
          chosen = (Array.isArray(selected) && selected.length > 0) ? selected[0] : avail[(typeof ri === 'function') ? ri(avail.length - 1) : (()=>{ throw new Error('Random integer generator ri() not available'); })()];
        } else {
          try { chosen = mc.selectNoteWithLeading ? mc.selectNoteWithLeading(avail) : avail[(typeof ri === 'function') ? ri(avail.length - 1) : (()=>{ throw new Error('Random integer generator ri() not available'); })()]; } catch { chosen = avail[(typeof ri === 'function') ? ri(avail.length - 1) : (()=>{ throw new Error('Random integer generator ri() not available'); })()]; }
        }
      } else if (this.VoiceLeadingScore && this.useVoiceLeading) {
        const avail = Array.from(new Set(candidates)).sort((a, b) => a - b);
        chosen = this.VoiceLeadingScore.selectNextNote(lastNotes, avail, { register: 'soprano' });
        lastNotes.unshift(chosen);
        if (lastNotes.length > 4) lastNotes.pop();
      } else {
        const randIdx = (typeof ri === 'function') ? ri(candidates.length - 1) : (()=>{ throw new Error('Random integer generator ri() not available'); })();
        chosen = candidates[randIdx];
      }

      seq.push({ note: chosen });
    }

    if (VC && motifLayer && typeof VC.resetLayer === 'function') {
      VC.resetLayer(motifLayer);
    }

    const MotifCtor = (typeof Motif !== "undefined") ? Motif : null;
    if (MotifCtor) return new MotifCtor(seq);
    // Fail-fast: Motif class is required
    throw new Error('MotifComposer.generate: Motif class not available');
  }
};
