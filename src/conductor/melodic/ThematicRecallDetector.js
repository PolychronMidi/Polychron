// src/conductor/ThematicRecallDetector.js - Cross-section pitch-sequence similarity.
// Compares recent pitch patterns against stored section fingerprints.
// Pure query API — signals thematic callback opportunities or staleness.

ThematicRecallDetector = (() => {
  const FINGERPRINT_LENGTH = 6; // 6-note interval fingerprint
  /** @type {Array<{ section: number, fingerprint: string }>} */
  const sectionFingerprints = [];

  /**
   * Record a section's melodic fingerprint for future comparison.
   * Call once per section (at section end).
   * @param {number} section - section index
   */
  function recordSectionFingerprint(section) {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 8 });
    if (notes.length < FINGERPRINT_LENGTH) {
      sectionFingerprints.push({ section, fingerprint: '' });
      return;
    }

    // Build interval fingerprint from last N notes
    const intervals = [];
    const start = notes.length - FINGERPRINT_LENGTH;
    for (let i = start + 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
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

    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 4 });
    if (notes.length < FINGERPRINT_LENGTH) {
      return { recallOpportunity: false, similarSection: null, similarity: 0 };
    }

    // Current fingerprint
    const intervals = [];
    const start = notes.length - FINGERPRINT_LENGTH;
    for (let i = start + 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
      intervals.push(curr - prev);
    }

    // Compare against stored fingerprints (skip last one — that's current section)
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
   * Signal thematic status for ConductorState.
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

  ConductorIntelligence.registerStateProvider('ThematicRecallDetector', () => {
    const s = ThematicRecallDetector.getThematicSignal();
    return {
      thematicStatus: s ? s.thematicStatus : 'fresh',
      thematicRecallSection: s ? s.recallSection : null
    };
  });
  ConductorIntelligence.registerModule('ThematicRecallDetector', { reset }, ['section']);

  return {
    recordSectionFingerprint,
    checkRecallOpportunity,
    getThematicSignal,
    reset
  };
})();
