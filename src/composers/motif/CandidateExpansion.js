// CandidateExpansion.js - Scale-aware candidate pool expansion helper

/**
 * Expands candidate note pools while respecting scale pitch classes and MIDI bounds.
 * Used when initial candidate set is too small for multi-voice selection.
 */
CandidateExpansion = {
  /**
   * Expand single note to scale-aware neighbors within ±12 semitones
   * @param {number|number[]} baseNotes - MIDI note(s) to expand from
   * @param {Set<number>} validPCs - Pitch classes (0-11) to match, empty Set = no restriction
   * @param {number} minNote - Lower MIDI bound (typically OCTAVE.min * 12 - 1)
   * @param {number} maxNote - Upper MIDI bound (typically OCTAVE.max * 12 - 1)
   * @param {number} [maxCandidates=6] - Limit expansion size
   * @returns {number[]} Expanded candidate pool
   */
  expandScaleAware(baseNotes, validPCs, minNote, maxNote, maxCandidates = 6) {
    if (!Number.isFinite(minNote) || !Number.isFinite(maxNote) || minNote > maxNote) {
      throw new Error(`CandidateExpansion: invalid bounds minNote=${minNote} maxNote=${maxNote}`);
    }

    const bases = Array.isArray(baseNotes) ? baseNotes : [baseNotes];
    const expanded = new Set(bases);

    for (const baseNote of bases) {
      if (!Number.isFinite(baseNote)) continue;

      // Search ±12 semitones (one octave each direction)
      for (let delta = -12; delta <= 12; delta++) {
        if (delta === 0) continue; // Skip base note (already in set)

        const note = baseNote + delta;

        // Enforce MIDI bounds
        if (note < minNote || note > maxNote) continue;

        // Validate pitch class if validPCs provided
        const pc = ((note % 12) + 12) % 12;
        if (validPCs.size > 0 && !validPCs.has(pc)) continue;

        expanded.add(note);

        // Stop if we hit candidate limit
        if (expanded.size >= maxCandidates) break;
      }

      if (expanded.size >= maxCandidates) break;
    }

    return Array.from(expanded);
  }
};
