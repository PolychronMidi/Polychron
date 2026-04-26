// src/conductor/thematicRecallDetector.js - Cross-section pitch-sequence similarity.
// Compares recent pitch patterns against stored section fingerprints.
// Pure query API - signals thematic callback opportunities or staleness.

moduleLifecycle.declare({
  name: 'thematicRecallDetector',
  subsystem: 'conductor',
  deps: [],
  provides: ['thematicRecallDetector'],
  init: () => {
  const FINGERPRINT_LENGTH = 6; // 6-note interval fingerprint
  /** @type {Array<{ section: number, fingerprint: string }>} */
  const sectionFingerprints = [];

  /**
   * Record a section's melodic fingerprint for future comparison.
   * Call once per section (at section end).
   * @param {number} section - section index
   */
  function recordSectionFingerprint(section) {
    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: 8 });
    const midis = analysisHelpers.extractMidiArray(notes, 60);
    if (midis.length < FINGERPRINT_LENGTH) {
      sectionFingerprints.push({ section, fingerprint: '' });
      return;
    }

    // Build interval fingerprint from last N notes
    const intervals = [];
    const start = midis.length - FINGERPRINT_LENGTH;
    for (let i = start + 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      intervals.push(curr - prev);
    }

    sectionFingerprints.push({ section, fingerprint: intervals.join(',') });
  }

  /**
   * Check if current material is similar to any prior section.
   * @returns {{ recallOpportunity: boolean, similarSection: number|null, similarity: number }}
   */
  function checkRecallOpportunity() {
    if (sectionFingerprints.length < 2) {
      return { recallOpportunity: false, similarSection: null, similarity: 0 };
    }

    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: 4 });
    const midis = analysisHelpers.extractMidiArray(notes, 60);
    if (midis.length < FINGERPRINT_LENGTH) {
      return { recallOpportunity: false, similarSection: null, similarity: 0 };
    }

    // Current fingerprint
    const intervals = [];
    const start = midis.length - FINGERPRINT_LENGTH;
    for (let i = start + 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      intervals.push(curr - prev);
    }

    // Compare against stored fingerprints (skip last one - that's current section)
    let bestSimilarity = 0;
    let bestSection = null;

    for (let i = 0; i < sectionFingerprints.length - 1; i++) {
      const stored = sectionFingerprints[i];
      if (!stored.fingerprint) continue;

      // Simple similarity: count matching intervals
      const storedIntervals = stored.fingerprint.split(',');
      let matches = 0;
      const total = m.min(intervals.length, storedIntervals.length);
      for (let j = 0; j < total; j++) {
        if (String(intervals[j]) === storedIntervals[j]) matches++;
      }
      const similarity = total > 0 ? matches / total : 0;
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestSection = stored.section;
      }
    }

    return {
      recallOpportunity: bestSimilarity > 0.5,
      similarSection: bestSection,
      similarity: bestSimilarity
    };
  }

  /**
   * Signal thematic status for conductorState.
   * @returns {{ thematicStatus: string, recallSection: number|null }}
   */
  function getThematicSignal() {
    const recall = checkRecallOpportunity();
    if (recall.recallOpportunity && recall.similarity > 0.7) {
      return { thematicStatus: 'strong-recall', recallSection: recall.similarSection };
    }
    if (recall.recallOpportunity) {
      return { thematicStatus: 'echo', recallSection: recall.similarSection };
    }
    return { thematicStatus: 'fresh', recallSection: null };
  }

  /** Reset tracking. */
  function reset() {
    sectionFingerprints.length = 0;
  }

  // R28 E5: Tension bias from thematic recall. When the current material
  // strongly echoes a prior section (strong-recall), reduce tension --
  // familiarity creates a sense of resolution and emotional settling.
  // R29 E5: Also respond to 'echo' (moderate recall >0.5 similarity)
  // with a milder reduction. Fresh material stays neutral.
  /**
   * Get tension multiplier from thematic recall detection.
   * @returns {number}
   */
  function getTensionBias() {
    const s = getThematicSignal();
    if (s.thematicStatus === 'strong-recall') return 0.96;
    if (s.thematicStatus === 'echo') return 0.98;
    return 1.0;
  }

  conductorIntelligence.registerTensionBias('thematicRecallDetector', () => thematicRecallDetector.getTensionBias(), 0.96, 1.0);
  conductorIntelligence.registerStateProvider('thematicRecallDetector', () => {
    const s = thematicRecallDetector.getThematicSignal();
    return {
      thematicStatus: s ? s.thematicStatus : 'fresh',
      thematicRecallSection: s ? s.recallSection : null
    };
  });
  conductorIntelligence.registerModule('thematicRecallDetector', { reset }, ['section']);

  return {
    recordSectionFingerprint,
    checkRecallOpportunity,
    getThematicSignal,
    getTensionBias,
    reset
  };
  },
});
