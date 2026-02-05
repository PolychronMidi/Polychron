// selectVoices.js - Multi-voice joint selection with voice leading optimization

/**
 * Selects notes for multiple voices jointly using VoiceLeadingScore cost functions
 * with inter-voice penalties for crossing and parallel motion.
 *
 * @param {VoiceLeadingScore} scorer - Voice leading scorer instance
 * @param {number[][]} lastNotesByVoice - Per-voice history arrays [[last, prev, ...], ...]
 * @param {number[][]} candidatesPerVoice - Per-voice candidate arrays
 * @param {{ registers?: string[], commonToneWeight?: number }} opts - Optional config
 * @returns {number[]} Selected notes (one per voice)
 */
selectVoices = function(scorer, lastNotesByVoice, candidatesPerVoice, opts = {}) {
  const voices = candidatesPerVoice.length;
  const chosen = new Array(voices);

  const registerForIndex = (idx) => {
    if (opts.registers?.[idx]) return opts.registers[idx];
    return ['soprano', 'alto', 'tenor', 'bass'][idx] || 'soprano';
  };

  for (let i = 0; i < voices; i++) {
    const candidates = candidatesPerVoice[i];
    const register = registerForIndex(i);
    const lastNotes = lastNotesByVoice[i] || [];
    const registerRange = scorer.registers[register] || scorer.registers.soprano;

    let bestCandidate = candidates[0];
    let bestScore = Infinity;

    for (const candidate of candidates) {
      // Base single-voice cost from VoiceLeadingScore
      const baseCost = scorer._scoreCandidate(
        candidate,
        lastNotes,
        registerRange,
        [],
        { commonToneWeight: opts.commonToneWeight }
      );

      // Crossing penalty - soprano >= alto >= tenor >= bass
      let crossPenalty = 0;
      if (i > 0 && candidate <= chosen[i - 1]) {
        crossPenalty = 6;
      }

      // Parallel motion penalty
      let parallelPenalty = 0;
      if (scorer.history.length > 0 && lastNotes.length > 0) {
        const lastMotion = lastNotes[0] - (lastNotes[1] || lastNotes[0]);
        const currentMotion = candidate - (lastNotes[0] || candidate);
        if ((currentMotion > 0 && lastMotion > 0) || (currentMotion < 0 && lastMotion < 0)) {
          parallelPenalty = 2;
        }
      }

      const total = baseCost + crossPenalty + parallelPenalty;
      if (total < bestScore) {
        bestScore = total;
        bestCandidate = candidate;
      }
    }

    chosen[i] = bestCandidate;
  }

  return chosen;
}
