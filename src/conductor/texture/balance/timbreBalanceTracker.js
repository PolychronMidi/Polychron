// src/conductor/timbreBalanceTracker.js - Instrument/channel distribution balance.
// Tracks MIDI channel usage to detect timbre clustering or neglect.
// Pure query API - nudges composer selection toward underused timbres.

timbreBalanceTracker = (() => {
  const V = validator.create('timbreBalanceTracker');
  const WINDOW_SECONDS = 6;

  /**
   * Analyze MIDI channel distribution in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ channelCounts: Object.<number, number>, usedChannels: number, dominant: number|null, imbalanced: boolean }}
   */
  function getTimbreProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);

    const channelCounts = /** @type {Object.<number, number>} */ ({});
    for (let i = 0; i < notes.length; i++) {
      const ch = V.optionalFinite(notes[i].channel, 0);
      channelCounts[ch] = (V.optionalFinite(channelCounts[ch], 0)) + 1;
    }

    const keys = Object.keys(channelCounts);
    const usedChannels = keys.length;

    if (notes.length < 3 || usedChannels === 0) {
      return { channelCounts, usedChannels: 0, dominant: null, imbalanced: false };
    }

    // Find dominant channel
    let dominant = null;
    let maxCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const ch = Number(keys[i]);
      const count = channelCounts[ch];
      if (typeof count === 'number' && count > maxCount) {
        maxCount = count;
        dominant = ch;
      }
    }

    // Imbalanced if one channel has >70% of notes
    const imbalanced = maxCount / notes.length > 0.7 && usedChannels > 1;

    return { channelCounts, usedChannels, dominant, imbalanced };
  }

  /**
   * Get underused channels to suggest for variety.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {Array<number>} [opts.availableChannels]
   * @returns {Array<number>}
   */
  function getUnderusedChannels(opts = {}) {
    const { availableChannels } = opts;
    const profile = getTimbreProfile(opts);
    if (!availableChannels || availableChannels.length === 0) return [];

    const total = Object.values(profile.channelCounts).reduce((a, b) => a + Number(b), 0);
    if (total < 4) return [];

    const underused = [];
    for (let i = 0; i < availableChannels.length; i++) {
      const ch = availableChannels[i];
      const count = V.optionalFinite(profile.channelCounts[ch], 0);
      if (count < total * 0.1) {
        underused.push(ch);
      }
    }
    return underused;
  }

  /**
   * Signal timbre balance for conductorState.
   * @returns {{ balanced: boolean, suggestion: string }}
   */
  function getTimbreSignal() {
    const profile = getTimbreProfile();
    if (profile.imbalanced) {
      return { balanced: false, suggestion: 'diversify-timbre' };
    }
    if (profile.usedChannels <= 1) {
      return { balanced: false, suggestion: 'add-timbre' };
    }
    return { balanced: true, suggestion: 'maintain' };
  }

  conductorIntelligence.registerStateProvider('timbreBalanceTracker', () => {
    const s = timbreBalanceTracker.getTimbreSignal();
    return {
      timbreBalanced: s ? s.balanced : true,
      timbreSuggestion: s ? s.suggestion : 'maintain'
    };
  });

  return {
    getTimbreProfile,
    getUnderusedChannels,
    getTimbreSignal
  };
})();
