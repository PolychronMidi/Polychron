// VoiceManager.js - Centralized voice count selection and multi-voice coordination

/**
 * Coordinates voice selection using VOICES config, composer note pools, and voice leading.
 * Manages per-voice history and calls voiceRegistry for joint optimization.
 *
 * **Voicing Intent Pattern:**
 * VoiceManager accepts optional voicing intent from composers via the `opts` parameter.
 * Composers implement `getVoicingIntent(candidateNotes)` to express their domain-specific
 * preferences (e.g., chord tones, tension curves, melodic development phases).
 *
 * Expected return shape:
 * ```
 * {
 *   candidateWeights: { [note: number]: number },  // weight per candidate (0-1+ scale)
 *   registerBias?: 'higher' | 'lower',             // optional register preference
 *   voiceCountMultiplier?: number                  // optional voice count scaling (default 1.0)
 * }
 * ```
 *
 * The voicing intent is passed through to VoiceLeadingScore and voiceRegistry, which combine
 * it with voice leading cost functions (smooth motion, leap recovery, etc.) to make the final
 * selection. This separation allows composers to define *what* notes fit their harmonic/melodic
 * logic while the voice module handles *how* to select voices smoothly.
 *
 * @class
 */
VoiceManager = class VoiceManager {
  constructor() {
    /** @type {ReturnType<typeof validator.create>} */
    this.V = validator.create('VoiceManager');
    this.voiceHistoryByLayer = new Map();
  }

  /**
   * Get voice count from VOICES config
   * @returns {number} Number of simultaneous voices to select
   */
  /**
   * Get voice count for the provided unit (beat/div/subdiv/subsubdiv).
   * Defaults to `beat` when unit is not provided or unrecognized.
   * @param {string} [unit='beat']
   * @returns {number}
   */
  getVoiceCount(unit = 'beat') {
    let cfg = null;
    switch ((unit || 'beat')) {
      case 'div': cfg = DIV_VOICES; break;
      case 'subdiv': cfg = SUBDIV_VOICES; break;
      case 'subsubdiv': cfg = SUBSUBDIV_VOICES; break;
      case 'beat':
      default:
        cfg = BEAT_VOICES;
        break;
    }

    const { min, max, weights } = cfg;
    return rw(min, max, weights);
  }

  _normalizeCandidates(candidateNotes = []) {
    const notes = [];
    const weights = {};

    for (const item of candidateNotes) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        notes.push(item);
        continue;
      }

      if (item && typeof item.note === 'number' && Number.isFinite(item.note)) {
        notes.push(item.note);
        if (typeof item.weight === 'number' && Number.isFinite(item.weight)) {
          weights[item.note] = item.weight;
        }
      }
    }

    return { notes, weights: Object.keys(weights).length > 0 ? weights : null };
  }

  _weightedPick(notes, weights) {
    this.V.assertArray(notes, '_weightedPick.notes', true);
    if (!weights) return notes[ri(notes.length - 1)];

    let total = 0;
    for (const note of notes) {
      const w = this.V.optionalFinite(weights && Number(weights[note]), 0);
      total += m.max(0, w);
    }

    if (total <= 0) return notes[ri(notes.length - 1)];

    let roll = rf() * total;
    for (const note of notes) {
      const w = m.max(0, this.V.optionalFinite(weights && Number(weights[note]), 0));
      roll -= w;
      if (roll <= 0) return note;
    }

    return notes[notes.length - 1];
  }

  /**
   * Pick notes for a beat using voice leading optimization
   * @param {Object} layer - Layer object with voice history
   * @param {number[]} candidateNotes - Available notes for this beat
   * @param {number} voiceCount - How many voices to select
   * @param {VoiceLeadingScoreAPI} scorer - Voice leading scorer instance
   * @param {Object} opts - Additional options (candidateWeights, registerBias, voiceCountMultiplier, phraseContext)
   * @returns {number[]} Selected notes (length = voiceCount)
   */
  pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, opts = {}) {
    this.V.assertObject(layer, 'pickNotesForBeat.layer');
    this.V.assertArray(candidateNotes, 'pickNotesForBeat.candidateNotes');

    const normalized = this._normalizeCandidates(candidateNotes);
    let notePool = normalized.notes;
    const weightMap = (opts && opts.candidateWeights !== undefined) ? opts.candidateWeights : normalized.weights;

    if (notePool.length === 0) {
      // No candidates available for this beat - normal runtime condition
      return [];
    }

    this.V.requireFinite(voiceCount, 'pickNotesForBeat.voiceCount');
    if (voiceCount <= 0) throw new Error('VoiceManager.pickNotesForBeat: voiceCount must be positive');

    const layerId = this.V.optionalType(layer.id, 'string') || 'default';

    // Extract phrase context for arc-driven biases
    const phraseContext = /** @type {any} */ (this.V.optionalType(opts && opts.phraseContext, 'object')) || {};
    const arcDensityMultiplier = this.V.optionalFinite(Number(phraseContext.densityMultiplier), 1.0);
    const voiceIndependence = this.V.optionalFinite(Number(phraseContext.voiceIndependence), VOICE_MANAGER.voiceIndependenceDefault);
    const runtimeProfile = /** @type {any} */ (this.V.optionalType(opts && opts.runtimeProfile, 'object')) || null;
    const runtimeVoiceCountMultiplier = this.V.optionalFinite(
      runtimeProfile && Number(runtimeProfile.voiceCountMultiplier), 1.0);

    // Apply voice count multiplier: stack chord change emphasis with phrase arc density
    // But only apply arc density influence probabilistically to maintain variety
    const voiceCountMultiplier = this.V.optionalFinite(Number(opts.voiceCountMultiplier), runtimeVoiceCountMultiplier);
    const shouldApplyArcDensity = rf() < (VOICE_MANAGER.arcDensityChance ?? 0.5);
    const effectiveArcDensity = shouldApplyArcDensity ? arcDensityMultiplier : 1.0;
    const combinedMultiplier = voiceCountMultiplier * effectiveArcDensity;
    const adjustedVoiceCount = m.max(1, m.round(voiceCount * combinedMultiplier));
    const maxVoices = m.min(adjustedVoiceCount, notePool.length);

    // Apply register bias using centralized helper
    const registerBiasResult = registerBiasing.apply(notePool, maxVoices, opts, phraseContext);
    notePool = registerBiasResult.notePool;
    const finalRegisterBias = registerBiasResult.finalRegisterBias;

    // SAFETY CHECK: If notePool is empty after all processing, this is a critical error
    if (notePool.length === 0) {
      throw new Error(`pickNotesForBeat has empty notePool after filtering! - candidateNotes length: ${candidateNotes.length} - normalizedNotes length: ${normalized.notes.length} - registerBias: ${finalRegisterBias} - maxVoices: ${maxVoices}`);
    }

    if (!this.voiceHistoryByLayer.has(layerId)) {
      this.voiceHistoryByLayer.set(layerId, []);
    }

    const voiceHistory = this.voiceHistoryByLayer.get(layerId);

    // If we have a scorer and multiple voices, use joint selection
    if (scorer && maxVoices > 1 && notePool.length >= maxVoices) {
      // Build per-voice candidate arrays from the pool
      const candidatesPerVoice = [];
      const lastNotesByVoice = [];

      for (let i = 0; i < maxVoices; i++) {
        candidatesPerVoice.push([...notePool]);
        const lnv = (voiceHistory[i] === undefined) ? [] : voiceHistory[i];
        if (voiceHistory[i] !== undefined) this.V.assertArray(voiceHistory[i], `voiceHistory[${i}]`);
        lastNotesByVoice.push(lnv);
      }

      // Call voiceRegistry for joint optimization with voiceIndependence hint
      const scorerOpts = Object.assign({}, opts, {
        candidateWeights: weightMap,
        voiceIndependence: voiceIndependence, // Pass to scorer for contrapuntal vs homophonic tendency
        minSemitones: opts.minSemitones  // Pass voice spacing constraint
      });
      const selected = voiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, scorerOpts);
      this.V.assertArray(selected, 'voiceRegistry.selected');
      if (selected.length !== maxVoices) {
        throw new Error(`VoiceManager.pickNotesForBeat: voiceRegistry returned invalid selection for layer ${layerId}`);
      }
      // Update history (validate entries)
      for (let i = 0; i < selected.length; i++) {
        this.V.requireFinite(Number(selected[i]), `voiceRegistry.selected[${i}]`);
        if (!voiceHistory[i]) voiceHistory[i] = [];
        voiceHistory[i].unshift(Number(selected[i]));
        if (voiceHistory[i].length > 8) voiceHistory[i].pop();
      }

      return selected;
    }

    // Single voice or no scorer - simpler selection
    const selected = [];
    for (let i = 0; i < maxVoices; i++) {
      // Stop if we've exhausted all available notes
      if (notePool.length === 0) {
        break;
      }

      let note;

      if (scorer && voiceHistory[i] && voiceHistory[i].length > 0) {
        // Single-voice selection with leading
        note = scorer.selectNextNote(voiceHistory[i], notePool, Object.assign({}, opts, { candidateWeights: weightMap }));
      } else {
        // Random selection from available candidates
        note = this._weightedPick(notePool, weightMap);
      }

      // CRITICAL CHECK: note must be a valid number
      this.V.requireFinite(note, `voice[${i}].note`);

      selected.push(note);

      // Update history
      if (!voiceHistory[i]) voiceHistory[i] = [];
      voiceHistory[i].unshift(note);
      if (voiceHistory[i].length > 8) voiceHistory[i].pop();

      // Remove selected note from candidates to avoid duplicates
      const idx = notePool.indexOf(note);
      if (idx >= 0) {
        notePool = [...notePool];
        notePool.splice(idx, 1);
      }
    }

    return selected;
  }

  /**
   * Reset voice history for a layer (call at section boundaries)
   * @param {Object} layer - Layer to reset
   */
  resetLayer(layer) {
    const layerId = layer.id || 'default';
    this.voiceHistoryByLayer.delete(layerId);
  }

  /**
   * Reset all voice history
   */
  resetAll() {
    this.voiceHistoryByLayer.clear();
  }
}
