// motifs.ts - Motif utilities for interval-based transformations and development.
// minimalist comments, details at: motifs.md

const MATH = Math;

/**
 * Clamp helper to keep MIDI notes in range.
 * @param val - Value to clamp
 * @param min - Minimum value (default: 0)
 * @param max - Maximum value (default: 127)
 * @returns Clamped value
 */
const clampNote = (val: number, min: number = 0, max: number = 127): number =>
  MATH.min(max, MATH.max(min, val));

/**
 * Note event structure
 */
interface NoteEvent {
  note: number;
  duration: number;
}

/**
 * Normalize a motif event into { note, duration } shape.
 * @param evt - Event as number or object
 * @param defaultDuration - Default duration if not specified
 * @returns Normalized { note, duration } object
 */
const normalizeEvent = (
  evt: number | { note?: number; duration?: number } | null | undefined,
  defaultDuration: number = 1
): NoteEvent => {
  if (evt === null || evt === undefined) {
    return { note: 0, duration: defaultDuration };
  }
  if (typeof evt === 'number') {
    return { note: evt, duration: defaultDuration };
  }
  const note = typeof evt.note === 'number' ? evt.note : 0;
  const duration = typeof evt.duration === 'number' && evt.duration > 0 ? evt.duration : defaultDuration;
  return { note, duration };
};

/**
 * Motif class for melodic transformations and development
 */
class Motif {
  sequence: NoteEvent[];
  defaultDuration: number;

  /**
   * Create a new Motif
   * @param sequence - Array of notes or note events
   * @param options - Configuration options
   */
  constructor(sequence: Array<number | { note?: number; duration?: number }> = [], options: { defaultDuration?: number } = {}) {
    const { defaultDuration = 1 } = options;
    this.sequence = Array.isArray(sequence)
      ? sequence.map((evt) => normalizeEvent(evt, defaultDuration))
      : [];
    this.defaultDuration = defaultDuration;
  }

  /**
   * Returns a deep-copied sequence.
   * @returns Array of note events
   */
  get events(): NoteEvent[] {
    return this.sequence.map(({ note, duration }) => ({ note, duration }));
  }

  /**
   * Transpose motif by semitones.
   * @param semitones - Number of semitones to transpose
   * @returns New transposed Motif
   */
  transpose(semitones: number = 0): Motif {
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(note + semitones),
      duration
    })), { defaultDuration: this.defaultDuration });
  }

  /**
   * Invert motif around a pivot (default: first note).
   * @param pivot - Pivot note for inversion (null = use first note)
   * @returns New inverted Motif
   */
  invert(pivot: number | null = null): Motif {
    const pivotNote = pivot === null
      ? (this.sequence[0]?.note ?? 0)
      : pivot;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(pivotNote - (note - pivotNote)),
      duration
    })), { defaultDuration: this.defaultDuration });
  }

  /**
   * Augment durations by factor.
   * @param factor - Multiplication factor
   * @returns New augmented Motif
   */
  augment(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration * safeFactor
    })), { defaultDuration: this.defaultDuration * safeFactor });
  }

  /**
   * Diminish durations by factor.
   * @param factor - Division factor
   * @returns New diminished Motif
   */
  diminish(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration / safeFactor
    })), { defaultDuration: this.defaultDuration / safeFactor });
  }

  /**
   * Reverse motif order.
   * @returns New reversed Motif
   */
  reverse(): Motif {
    return new Motif([...this.sequence].reverse(), { defaultDuration: this.defaultDuration });
  }

  /**
   * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
   * @param options - Development options
   * @returns New developed Motif
   */
  develop(options: {
    transposeBy?: number;
    invertPivot?: number | false;
    reverse?: boolean;
    scale?: number;
  } = {}): Motif {
    const {
      transposeBy = 12,
      invertPivot = null,
      reverse = false,
      scale = 1
    } = options;
    let next: Motif = this;
    if (transposeBy !== 0) {
      next = next.transpose(transposeBy) as Motif;
    }
    if (invertPivot !== false) {
      const pivot = invertPivot as number | null;
      next = next.invert(pivot) as Motif;
    }
    if (reverse) {
      next = next.reverse() as Motif;
    }
    if (scale !== 1) {
      next = scale > 1 ? next.augment(scale) as Motif : next.diminish(1 / scale) as Motif;
    }
    return next;
  }

  /**
   * Apply motif offsets to an array of note objects (non-mutating).
   * Calculates interval offset from motif's first note and applies to each input note.
   * @param notes - Array of note objects
   * @param options - Clamping options
   * @returns New array of adjusted notes
   */
  applyToNotes(notes: Array<{ note?: number; [key: string]: any }> = [], options: { clampMin?: number; clampMax?: number } = {}): Array<{ note: number; [key: string]: any }> {
    if (!Array.isArray(notes) || notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? (notes as any[]) : [];
    }
    const { clampMin = 0, clampMax = 127 } = options;
    const baseNote = this.sequence[0].note;
    return notes.map((noteObj, idx) => {
      const motifEvent = this.sequence[idx % this.sequence.length];
      const offset = motifEvent.note - baseNote;
      const newNote = clampNote((noteObj?.note ?? 0) + offset, clampMin, clampMax);
      return { ...noteObj, note: newNote };
    });
  }
}



// Export for backward compatibility
const clampMotifNote = clampNote;

export { Motif, clampNote, clampMotifNote };

// Attach to globalThis for backward compatibility
(globalThis as any).Motif = Motif;
(globalThis as any).clampNote = clampNote;
(globalThis as any).clampMotifNote = clampMotifNote;
