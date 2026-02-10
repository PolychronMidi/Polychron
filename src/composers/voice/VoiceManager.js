// VoiceManager.js - Centralized voice count selection and multi-voice coordination

/**
 * Coordinates voice selection using VOICES config, composer note pools, and voice leading.
 * Manages per-voice history and calls VoiceRegistry for joint optimization.
 * @class
 */
VoiceManager = class VoiceManager {
  constructor() {
    this.voiceHistoryByLayer = new Map();
  }

  /**
   * Get voice count from VOICES config
   * @returns {number} Number of simultaneous voices to select
   */
  getVoiceCount() {
    const { min, max, weights } = VOICES;
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
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('_weightedPick called with empty or invalid notes array! - notes: ' + JSON.stringify(notes) + ' - weights: ' + JSON.stringify(weights));
    }
    if (!weights) return notes[ri(notes.length - 1)];

    let total = 0;
    for (const note of notes) {
      const w = (weights && Number.isFinite(Number(weights[note]))) ? Math.max(0, Number(weights[note])) : 0;
      total += w;
    }

    if (total <= 0) return notes[ri(notes.length - 1)];

    let roll = rf() * total;
    for (const note of notes) {
      const w = (weights && Number.isFinite(Number(weights[note]))) ? Math.max(0, Number(weights[note])) : 0;
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
   * @param {VoiceLeadingScore} scorer - Voice leading scorer instance
   * @param {Object} opts - Additional options (candidateWeights, registerBias, voiceCountMultiplier, phraseContext)
   * @returns {number[]} Selected notes (length = voiceCount)
   */
  pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, opts = {}) {
    if (!layer || typeof layer !== 'object') throw new Error('VoiceManager.pickNotesForBeat: missing or invalid layer');
    if (!Array.isArray(candidateNotes)) throw new Error('VoiceManager.pickNotesForBeat: candidateNotes must be an array');

    const normalized = this._normalizeCandidates(candidateNotes);
    let notePool = Array.isArray(normalized.notes) ? normalized.notes : [];
    const weightMap = (opts && opts.candidateWeights !== undefined) ? opts.candidateWeights : normalized.weights;

    if (notePool.length === 0) {
      // No candidates available for this beat - normal runtime condition
      return [];
    }

    if (!Number.isFinite(voiceCount) || voiceCount <= 0) {
      throw new Error('VoiceManager.pickNotesForBeat: voiceCount must be a positive finite number');
    }

    const layerId = (layer && typeof layer.id === 'string' && layer.id.length > 0) ? layer.id : 'default';

    // Extract phrase context for arc-driven biases
    const phraseContext = (opts && opts.phraseContext && typeof opts.phraseContext === 'object') ? opts.phraseContext : {};
    const arcDensityMultiplier = Number.isFinite(Number(phraseContext.densityMultiplier)) ? phraseContext.densityMultiplier : 1.0;
    const voiceIndependence = Number.isFinite(Number(phraseContext.voiceIndependence)) ? phraseContext.voiceIndependence : VOICE_Manager.voiceIndependenceDefault;

    // Apply voice count multiplier: stack chord change emphasis with phrase arc density
    // But only apply arc density influence probabilistically to maintain variety
    const voiceCountMultiplier = Number.isFinite(Number(opts.voiceCountMultiplier)) ? opts.voiceCountMultiplier : 1.0;
    const shouldApplyArcDensity = rf() < (VOICE_Manager.arcDensityChance ?? 0.5);
    const effectiveArcDensity = shouldApplyArcDensity ? arcDensityMultiplier : 1.0;
    const combinedMultiplier = voiceCountMultiplier * effectiveArcDensity;
    const adjustedVoiceCount = Math.max(1, Math.round(voiceCount * combinedMultiplier));
    const maxVoices = Math.min(adjustedVoiceCount, notePool.length);

    // Apply register bias using centralized helper
    const registerBiasResult = RegisterBiasing.apply(notePool, maxVoices, opts, phraseContext);
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
        const lnv = (typeof voiceHistory[i] === 'undefined') ? [] : voiceHistory[i];
        if (typeof voiceHistory[i] !== 'undefined' && !Array.isArray(voiceHistory[i])) {
          throw new Error('VoiceManager.pickNotesForBeat: voiceHistory entries must be arrays if provided');
        }
        lastNotesByVoice.push(lnv);
      }

      // Call VoiceRegistry for joint optimization with voiceIndependence hint
      const scorerOpts = Object.assign({}, opts, {
        candidateWeights: weightMap,
        voiceIndependence: voiceIndependence, // Pass to scorer for contrapuntal vs homophonic tendency
        minSemitones: opts.minSemitones  // Pass voice spacing constraint
      });
      const selected = VoiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, scorerOpts);
      if (!Array.isArray(selected) || selected.length !== maxVoices) {
        throw new Error(`VoiceManager.pickNotesForBeat: VoiceRegistry returned invalid selection for layer ${layerId}`);
      }
      // Update history (validate entries)
      for (let i = 0; i < selected.length; i++) {
        if (!Number.isFinite(Number(selected[i]))) throw new Error(`VoiceManager.pickNotesForBeat: VoiceRegistry returned non-finite note at index ${i}`);
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
      if (!Number.isFinite(note)) {
        throw new Error(`Voice ${i} selection returned undefined note`);
      }

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
