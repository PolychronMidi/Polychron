// VoiceCoordinator.js - Centralized voice count selection and multi-voice coordination

/**
 * Coordinates voice selection using VOICES config, composer note pools, and voice leading.
 * Manages per-voice history and calls selectVoices for joint optimization.
 * @class
 */
VoiceCoordinator = class VoiceCoordinator {
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

  /**
   * Pick notes for a beat using voice leading optimization
   * @param {Object} layer - Layer object with voice history
   * @param {number[]} candidateNotes - Available notes for this beat
   * @param {number} voiceCount - How many voices to select
   * @param {VoiceLeadingScore} scorer - Voice leading scorer instance
   * @param {Object} opts - Additional options
   * @returns {number[]} Selected notes (length = voiceCount)
   */
  pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, opts = {}) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0 || !Number.isFinite(voiceCount) || voiceCount <= 0) {
      return [];
    }

    const layerId = layer.id || 'default';
    const maxVoices = Math.min(voiceCount, candidateNotes.length);

    if (!this.voiceHistoryByLayer.has(layerId)) {
      this.voiceHistoryByLayer.set(layerId, []);
    }

    const voiceHistory = this.voiceHistoryByLayer.get(layerId);

    // If we have a scorer and multiple voices, use joint selection
    if (scorer && maxVoices > 1 && candidateNotes.length >= maxVoices) {
      // Build per-voice candidate arrays from the pool
      const candidatesPerVoice = [];
      const lastNotesByVoice = [];

      for (let i = 0; i < maxVoices; i++) {
        candidatesPerVoice.push([...candidateNotes]);
        lastNotesByVoice.push(voiceHistory[i] || []);
      }

      // Call selectVoices for joint optimization
      const selected = selectVoices(scorer, lastNotesByVoice, candidatesPerVoice, opts);

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
      let note;

      if (scorer && voiceHistory[i] && voiceHistory[i].length > 0) {
        // Single-voice selection with leading
        note = scorer.selectNextNote(voiceHistory[i], candidateNotes, opts);
      } else {
        // Random selection from available candidates
        note = candidateNotes[ri(candidateNotes.length - 1)];
      }

      selected.push(note);

      // Update history
      if (!voiceHistory[i]) voiceHistory[i] = [];
      voiceHistory[i].unshift(note);
      if (voiceHistory[i].length > 8) voiceHistory[i].pop();

      // Remove selected note from candidates to avoid duplicates
      const idx = candidateNotes.indexOf(note);
      if (idx >= 0) {
        candidateNotes = [...candidateNotes];
        candidateNotes.splice(idx, 1);
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
