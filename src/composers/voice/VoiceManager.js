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
      const weight = Math.max(0, Number(weights[note]) || 0);
      total += weight;
    }

    if (total <= 0) return notes[ri(notes.length - 1)];

    let roll = rf() * total;
    for (const note of notes) {
      const weight = Math.max(0, Number(weights[note]) || 0);
      roll -= weight;
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
    const normalized = this._normalizeCandidates(candidateNotes);
    let notePool = normalized.notes;
    const weightMap = opts.candidateWeights || normalized.weights;

    if (!Array.isArray(notePool) || notePool.length === 0 || !Number.isFinite(voiceCount) || voiceCount <= 0) {
      return [];
    }

    const layerId = layer.id || 'default';

    // Extract phrase context for arc-driven biases
    const phraseContext = opts.phraseContext || {};
    const arcDensityMultiplier = phraseContext.densityMultiplier || 1.0;
    const voiceIndependence = phraseContext.voiceIndependence || VOICE_Manager.voiceIndependenceDefault;

    // Apply voice count multiplier: stack chord change emphasis with phrase arc density
    // But only apply arc density influence probabilistically to maintain variety
    const voiceCountMultiplier = opts.voiceCountMultiplier ?? 1.0;
    const shouldApplyArcDensity = rf() < VOICE_Manager.arcDensityChance;
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
        lastNotesByVoice.push(voiceHistory[i] || []);
      }

      // Call VoiceRegistry for joint optimization with voiceIndependence hint
      const scorerOpts = Object.assign({}, opts, {
        candidateWeights: weightMap,
        voiceIndependence: voiceIndependence, // Pass to scorer for contrapuntal vs homophonic tendency
        minSemitones: opts.minSemitones  // Pass voice spacing constraint
      });
      const selected = VoiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, scorerOpts);
      // Update history
      for (let i = 0; i < selected.length; i++) {
        if (!voiceHistory[i]) voiceHistory[i] = [];
        voiceHistory[i].unshift(selected[i]);
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
