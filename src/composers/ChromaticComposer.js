// ChromaticComposer.js - Chromatic passing tone / enclosure / neighbor-note composition
// Generates chromatic approach patterns relative to a target scale context.
// Not the same as "playing the chromatic scale" - this composer uses a target
// scale to distinguish chord/scale tones from chromatic passing tones and builds
// idiomatic enclosure, neighbor, and approach figures.

ChromaticComposer = class ChromaticComposer extends MeasureComposer {
  /**
   * @param {string} targetScaleName - Scale to orbit around (e.g., 'major', 'minor')
   * @param {string} root - Root note (e.g., 'C', 'D')
   * @param {number} [chromaticDensity=0.4] - 0-1, how much chromatic content vs diatonic
   */
  constructor(targetScaleName = 'major', root = 'C', chromaticDensity = 0.4) {
    super();
    this.root = root;
    this.chromaticDensity = clamp(chromaticDensity, 0, 1);
    /** @type {Set<number>} */
    this._targetPCs = new Set();
    /** @type {string[]} */
    this._targetNotes = [];
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(targetScaleName, root);
  }

  /**
   * Set target scale context.
   * @param {string} targetScaleName
   * @param {string} root
   */
  noteSet(targetScaleName, root) {
    if (typeof targetScaleName !== 'string' || !targetScaleName) {
      throw new Error(`ChromaticComposer.noteSet: targetScaleName must be non-empty string`);
    }
    if (typeof root !== 'string' || !root) {
      throw new Error(`ChromaticComposer.noteSet: root must be non-empty string`);
    }
    this.root = root;

    const targetScale = t.Scale.get(`${root} ${targetScaleName}`);
    if (!targetScale || !Array.isArray(targetScale.notes) || targetScale.notes.length === 0) {
      throw new Error(`ChromaticComposer.noteSet: scale "${root} ${targetScaleName}" not found`);
    }
    this._targetNotes = targetScale.notes;

    // Build the target pitch-class set for enclosure detection
    this._targetPCs = new Set(targetScale.notes.map(n => t.Note.chroma(n)).filter(c => Number.isFinite(c)));

    // Use full chromatic as the available note pool
    const chromatic = t.Scale.get(`${root} chromatic`);
    if (!chromatic || !Array.isArray(chromatic.notes) || chromatic.notes.length === 0) {
      throw new Error(`ChromaticComposer.noteSet: chromatic scale failed for root=${root}`);
    }
    this.notes = chromatic.notes;

    this.intervalOptions = {
      style: 'rising',
      density: 0.7,
      minNotes: 4,
      maxNotes: 12,
      jitter: true,
    };
    this.voicingOptions = {
      minSemitones: 1,
    };
  }

  /**
   * Generate notes with chromatic approach patterns.
   * For each selected note, probabilistically wraps it in an enclosure,
   * neighbor, or approach figure relative to the target scale.
   * @param {number[]|null} [octaveRange]
   * @returns {{note: number}[]}
   */
  getNotes(octaveRange = null) {
    const baseNotes = super.getNotes(octaveRange);
    if (!Array.isArray(baseNotes) || baseNotes.length === 0) {
      throw new Error('ChromaticComposer.getNotes: super.getNotes() returned empty');
    }

    const result = [];
    for (const n of baseNotes) {
      const midiRaw = typeof n === 'number' ? n : (n && typeof n.note === 'number' ? n.note : null);
      if (!Number.isFinite(midiRaw)) throw new Error('ChromaticComposer.getNotes: invalid note in base pool');
      /** @type {number} */
      const midi = /** @type {number} */ (midiRaw);
      const isTargetTone = this._targetPCs.has(midi % 12);
      const wrapped = typeof n === 'number' ? { note: n } : n;

      if (rf() < this.chromaticDensity) {
        if (isTargetTone) {
          // Note is diatonic - ornament it with chromatic approaches
          const pattern = rf();
          if (pattern < 0.35) {
            // Enclosure: chromatic above + below - target
            result.push({ note: clamp(midi + 1, 0, 127), _approach: 'enclosure-upper' });
            result.push({ note: clamp(midi - 1, 0, 127), _approach: 'enclosure-lower' });
            result.push(wrapped);
          } else if (pattern < 0.6) {
            // Upper neighbor: target - step up - back
            result.push(wrapped);
            result.push({ note: clamp(midi + 1, 0, 127), _approach: 'upper-neighbor' });
            result.push(wrapped);
          } else if (pattern < 0.8) {
            // Lower approach: chromatic step from below
            result.push({ note: clamp(midi - 1, 0, 127), _approach: 'lower-approach' });
            result.push(wrapped);
          } else {
            // Double chromatic approach from above
            result.push({ note: clamp(midi + 2, 0, 127), _approach: 'double-upper' });
            result.push({ note: clamp(midi + 1, 0, 127), _approach: 'upper-approach' });
            result.push(wrapped);
          }
        } else {
          // Note is already chromatic - resolve toward nearest scale tone
          const below = this._targetPCs.has((midi - 1) % 12) ? midi - 1 : null;
          const above = this._targetPCs.has((midi + 1) % 12) ? midi + 1 : null;
          if (below !== null && above !== null) {
            // Both neighbors are scale tones - chromatic passing tone between them
            result.push({ note: clamp(below, 0, 127), _approach: 'resolve-below' });
            result.push(wrapped);
            result.push({ note: clamp(above, 0, 127), _approach: 'resolve-above' });
          } else if (below !== null) {
            // Approach from below, land on chromatic, resolve down
            result.push(wrapped);
            result.push({ note: clamp(below, 0, 127), _approach: 'resolve-down' });
          } else if (above !== null) {
            // Chromatic leads up into scale tone
            result.push(wrapped);
            result.push({ note: clamp(above, 0, 127), _approach: 'resolve-up' });
          } else {
            // Isolated chromatic - pass through as color
            result.push(wrapped);
          }
        }
      } else {
        // Below density threshold - pass through unadorned
        result.push(wrapped);
      }
    }

    return result;
  }

  x = () => this.getNotes();
}

RandomChromaticComposer = class RandomChromaticComposer extends ChromaticComposer {
  constructor() {
    super();
    this.noteSet();
  }

  noteSet() {
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('RandomChromaticComposer.noteSet: allNotes not available');
    if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('RandomChromaticComposer.noteSet: allScales not available');
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomScale = allScales[ri(allScales.length - 1)];
    super.noteSet(randomScale, randomRoot);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
