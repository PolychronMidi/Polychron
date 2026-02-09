// VoiceValues.js - helpers for voice processing

VoiceValues = (function() {
  function normalizeCandidates(candidates) {
    if (!Array.isArray(candidates)) throw new Error('VoiceValues.normalizeCandidates: candidates array required');
    const notes = []; const weights = {};
    for (const item of candidates) {
      if (typeof item === 'number') { notes.push(item); continue; }
      if (item && typeof item.note === 'number') {
        notes.push(item.note);
        if (typeof item.weight === 'number') weights[item.note] = item.weight;
      }
    }
    return { notes, weights: Object.keys(weights).length > 0 ? weights : null };
  }

  return { normalizeCandidates };
})();
