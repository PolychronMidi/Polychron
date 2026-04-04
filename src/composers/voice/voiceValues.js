// voiceValues.js - helpers for voice processing

voiceValues = (function() {
  function normalizeCandidates(candidates) {
    if (!Array.isArray(candidates)) throw new Error('voiceValues.normalizeCandidates: candidates array required');
    const notes = []; const weights = {};
    for (const item of candidates) {
      if (typeof item === 'number' && Number.isFinite(item)) { notes.push(item); continue; }
      if (item && typeof item.note === 'number' && Number.isFinite(item.note)) {
        notes.push(item.note);
        if (typeof item.weight === 'number' && Number.isFinite(item.weight)) weights[item.note] = item.weight;
      }
    }
    return { notes, weights: Object.keys(weights).length > 0 ? weights : null };
  }

  return { normalizeCandidates };
})();
