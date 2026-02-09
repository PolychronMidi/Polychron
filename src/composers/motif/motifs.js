// motifs.js - Motif utilities for interval-based transformations and development.

/**
 * Clamp helper to keep MIDI notes in range.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clampMotifNote = (val, min = 0, max = 127) => m.min(max, m.max(min, val));

/**
 * Normalize a motif event into { note, duration } shape.
 * @param {number|{note:number,duration?:number}} evt
 * @param {number} defaultDuration
 * @returns {{note:number,duration:number}}
 */
const normalizeEvent = (evt, defaultDuration = 1) => {
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

Motif = class Motif {
  /**
   * @param {Array<number|{note:number,duration?:number}>} sequence
   * @param {{defaultDuration?:number}} [options]
   */
  constructor(sequence = [], options = {}) {
    const { defaultDuration = 1 } = options;
    this.sequence = Array.isArray(sequence)
      ? sequence.map((evt) => normalizeEvent(evt, defaultDuration))
      : [];
    /** @type {number} */
    this.defaultDuration = defaultDuration;
  }

  /**
   * Returns a deep-copied sequence.
   * @returns {{note:number,duration:number}[]}
   */
  get events() {
    return this.sequence.map(({ note, duration }) => ({ note, duration }));
  }

  /**
   * Transpose motif by semitones.
   * @param {number} semitones
   * @returns {this}
   */
  transpose(semitones = 0) {
    return /** @type {this} */ (new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampMotifNote(note + semitones),
      duration
    })), { defaultDuration: this.defaultDuration }));
  }

  /**
   * Invert motif around a pivot (default: first note).
   * @param {number|null} [pivot]
   * @returns {this}
   */
  invert(pivot = null) {
    const pivotNote = pivot === null
      ? (this.sequence[0]?.note ?? 0)
      : pivot;
    return /** @type {this} */ (new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampMotifNote(pivotNote - (note - pivotNote)),
      duration
    })), { defaultDuration: this.defaultDuration }));
  }

  /**
   * Augment durations by factor.
   * @param {number} factor
   * @returns {this}
   */
  augment(factor = 2) {
    const safeFactor = factor <= 0 ? 1 : factor;
    return /** @type {this} */ (new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration * safeFactor
    })), { defaultDuration: this.defaultDuration * safeFactor }));
  }

  /**
   * Diminish durations by factor.
   * @param {number} factor
   * @returns {this}
   */
  diminish(factor = 2) {
    const safeFactor = factor <= 0 ? 1 : factor;
    return /** @type {this} */ (new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration / safeFactor
    })), { defaultDuration: this.defaultDuration / safeFactor }));
  }

  /**
   * Reverse motif order.
   * @returns {this}
   */
  reverse() {
    return /** @type {this} */ (new Motif([...this.sequence].reverse(), { defaultDuration: this.defaultDuration }));
  }

  /**
   * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
   * @param {{transposeBy?:number,invertPivot?:number|false,reverse?:boolean,scale?:number}} [options]
   * @returns {this}
   */
  develop(options = {}) {
    const {
      transposeBy = 12,
      invertPivot = null,
      reverse = false,
      scale = 1
    } = options;
    let next = this;
    if (transposeBy !== 0) {
      next = next.transpose(transposeBy);
    }
    if (invertPivot !== false) {
      next = next.invert(invertPivot);
    }
    if (reverse) {
      next = next.reverse();
    }
    if (scale !== 1) {
      next = scale > 1 ? next.augment(scale) : next.diminish(1 / scale);
    }
    return /** @type {this} */ (next);
  }

  /**
   * Apply motif offsets to an array of note objects (non-mutating).
   * Calculates interval offset from motif's first note and applies to each input note.
   * @param {{note:number}[]} notes
   * @param {{clampMin?:number,clampMax?:number}} [options]
   * @returns {{note:number}[]}
   */
  applyToNotes(notes = [], options = {}) {
    if (!Array.isArray(notes) || notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? [...notes] : [];
    }
    const { clampMin = 0, clampMax = 127 } = options;
    const baseNote = this.sequence[0].note;
    return notes.map((noteObj, idx) => {
      const motifEvent = this.sequence[idx % this.sequence.length];
      const offset = motifEvent.note - baseNote;
      const newNote = clampMotifNote((noteObj?.note ?? 0) + offset, clampMin, clampMax);
      return { ...noteObj, note: newNote };
    });
  }
}

applyMotifToNotes = (notes, motif = activeMotif, options = {}) => {
  if (!motif || typeof motif.applyToNotes !== 'function') return Array.isArray(notes) ? [...notes] : [];
  return motif.applyToNotes(notes, options);
};

/**
 * Return up to `max` scheduled notes that start within [windowStart, windowEnd).
 * Preserves order by start time and caps result size. Returns shallow copies.
 * @param {{note:number,startTick:number,duration:number}[]} schedule
 * @param {number} windowStart
 * @param {number} windowEnd
 * @param {number} [max=3]
 * @returns {Array<{note:number,startTick:number,duration:number}>}
 */
getScheduledNotes = (schedule = [], windowStart = 0, windowEnd = Infinity, max = 3) => {
  if (!Array.isArray(schedule) || schedule.length === 0) return [];
  // Allow a small slack so events that start slightly before the micro-unit
  // (e.g., due to jitter) are still considered. Slack is based on the
  // subdiv/subsubdiv tick lengths (use .1 as reasonable tolerance).
  const slack = m.max(1, m.round((Number(tpSubdiv) || 0) * 0.1), m.round((Number(tpSubsubdiv) || 0) * 0.1));
  const hits = schedule.filter(s => Number.isFinite(Number(s.startTick)) && s.startTick >= (windowStart - slack) && s.startTick < windowEnd);
  hits.sort((a, b) => a.startTick - b.startTick);
  return hits.slice(0, m.max(0, m.min(max, hits.length))).map(s => ({ ...s }));
};
