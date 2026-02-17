// CandidateExpansion.js - Scale-aware candidate pool expansion helper

/**
 * Expands candidate note pools while respecting scale pitch classes and MIDI bounds.
 * Used when initial candidate set is too small for multi-voice selection.
 *
 * DESIGN RATIONALE:
 * VoiceManager requires sufficient candidates for effective voice-leading optimization.
 * When motif buckets provide single notes, this helper expands the pool by adding
 * scale-aware neighbors that match the composer's pitch-class set.
 * Expansion radius adapts per unit level: beats expand wider (±24) for open voicings,
 * while subsubdivs stay narrow (±6) for cluster textures.
 */
CandidateExpansion = {
  /** Expansion radius (semitones) per unit level */
  _UNIT_RADIUS: { beat: 24, div: 18, subdiv: 12, subsubdiv: 6 },

  /**
   * Expand single note to scale-aware neighbors within adaptive radius
   * @param {number|number[]} baseNotes - MIDI note(s) to expand from
   * @param {Set<number>} validPCs - Pitch classes (0-11) to match, empty Set = no restriction
   * @param {number} minNote - Lower MIDI bound (typically OCTAVE.min * 12 - 1)
   * @param {number} maxNote - Upper MIDI bound (typically OCTAVE.max * 12 - 1)
   * @param {number} [maxCandidates=6] - Limit expansion size
   * @param {string} [unit='div'] - Unit level for adaptive radius
   * @returns {number[]} Expanded candidate pool
   */
  expandScaleAware(baseNotes, validPCs, minNote, maxNote, maxCandidates = 6, unit = 'div') {
    if (!Number.isFinite(minNote) || !Number.isFinite(maxNote) || minNote > maxNote) {
      throw new Error(`CandidateExpansion: invalid bounds minNote=${minNote} maxNote=${maxNote}`);
    }

    const radius = this._UNIT_RADIUS[unit] || 12;
    const bases = Array.isArray(baseNotes) ? baseNotes : [baseNotes];
    const expanded = new Set(bases);

    for (const baseNote of bases) {
      if (!Number.isFinite(baseNote)) continue;

      // Search ±radius semitones (adaptive per unit level)
      for (let delta = -radius; delta <= radius; delta++) {
        if (delta === 0) continue;

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
