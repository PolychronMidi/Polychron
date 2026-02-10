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
    this._motifInstanceId = options.motifInstanceId || ('motif-' + Math.floor(Math.random() * 1e9));
    this._motifSequenceId = 0;
  }

  /** Resolve global ticks for a unit. */
  _unitTicks(unit) {
    let value;
    switch ((unit || '').toLowerCase()) {
      case 'measure': value = tpMeasure; break;
      case 'beat': value = tpBeat; break;
      case 'div': value = tpDiv; break;
      case 'subdiv': value = tpSubdiv; break;
      case 'subsubdiv': value = tpSubsubdiv; break;
      default: value = tpSubdiv;
    }
    if (!Number.isFinite(Number(value))) {
      throw new Error(`MotifComposer._unitTicks: invalid or undefined tick value for unit "${unit}"`);
    }
    return Number(value);
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
    if (developer && Array.isArray(developer.notes) && developer.notes.length > 0) {
      const expectedPCs = new Set();
      for (const noteName of developer.notes) {
        if (typeof noteName === 'string') {
          const pc = t.Note.chroma(noteName);
          if (typeof pc === 'number' && Number.isFinite(pc)) {
            expectedPCs.add(((pc % 12) + 12) % 12);
          }
        }
      }

      const scalePCs = new Set();
      for (const s of scaleNotes) {
        const pc = (typeof s.note === 'number') ? s.note : (typeof s === 'number' ? s : 0);
        scalePCs.add(((pc % 12) + 12) % 12);
      }

      // Fail fast if scaleNotes contains unexpected pitch classes
      for (const pc of scalePCs) {
        if (!expectedPCs.has(pc)) {
          throw new Error(`MotifComposer.generate: scaleNotes contains unexpected PC ${pc}. Developer.notes PCs: ${Array.from(expectedPCs).sort((a,b)=>a-b).join(',')}, scaleNotes PCs: ${Array.from(scalePCs).sort((a,b)=>a-b).join(',')}. Composer class: ${developer?.constructor?.name}. This indicates getNotes() is performing chromatic transposition/inversion instead of scale-degree permutation.`);
        }
      }
    }

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
        const jitter = Number.isFinite(Number(rv)) ? rv(0.9, 1.1) : (0.9 + Math.random() * 0.2);
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
