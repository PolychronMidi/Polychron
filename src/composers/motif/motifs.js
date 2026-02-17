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
    throw new Error('normalizeEvent: evt must be a number or an object {note:number[,duration:number]}');
  }
  if (typeof evt === 'number') {
    return { note: evt, duration: defaultDuration };
  }
  if (typeof evt === 'object' && typeof evt.note === 'number' && Number.isFinite(evt.note)) {
    const duration = (typeof evt.duration === 'number' && evt.duration > 0) ? evt.duration : defaultDuration;
    return { note: evt.note, duration };
  }
  throw new Error(`normalizeEvent: invalid event shape ${JSON.stringify(evt)}; expected number or {note:number,duration?:number}`);
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
   * Transpose all note pitches by the given number of semitones.
   * @param {number} semitones - Semitones to shift (positive = up, negative = down)
   * @returns {this}
   */
  transpose(semitones = 0) {
    const shift = m.round(semitones);
    if (shift === 0) return /** @type {this} */ (new Motif(this.sequence, { defaultDuration: this.defaultDuration }));
    return /** @type {this} */ (new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampMotifNote(note + shift),
      duration
    })), { defaultDuration: this.defaultDuration }));
  }

  /**
   * Rotate motif order by shifting sequence positions (no pitch changes).
   * @param {number} steps - Positions to rotate (wraps around)
   * @returns {this}
   */
  rotate(steps = 0) {
    const len = this.sequence.length;
    if (len <= 1) return /** @type {this} */ (new Motif(this.sequence, { defaultDuration: this.defaultDuration }));
    const shift = ((m.round(steps) % len) + len) % len;
    if (shift === 0) return /** @type {this} */ (new Motif(this.sequence, { defaultDuration: this.defaultDuration }));
    const rotated = this.sequence.slice(-shift).concat(this.sequence.slice(0, len - shift));
    return /** @type {this} */ (new Motif(rotated, { defaultDuration: this.defaultDuration }));
  }

  /**
   * Invert motif order around a pivot index (default: 0).
   * @param {number|null} [pivot]
   * @returns {this}
   */
  invert(pivot = null) {
    const len = this.sequence.length;
    if (len <= 1) return /** @type {this} */ (new Motif(this.sequence, { defaultDuration: this.defaultDuration }));
    const pivotIdx = pivot === null
      ? 0
      : m.max(0, m.min(len - 1, m.round(pivot)));
    const reordered = new Array(len);
    for (let i = 0; i < len; i++) {
      const srcIdx = ((2 * pivotIdx - i) % len + len) % len;
      reordered[i] = this.sequence[srcIdx];
    }
    return /** @type {this} */ (new Motif(reordered, { defaultDuration: this.defaultDuration }));
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
      next = next.rotate(transposeBy);
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
   * Apply motif as a permutation: reorder input notes according to motif sequence order.
   * Matches input notes to motif events by pitch class, preserving octaves.
   * When exact PC matches aren't available, falls back to nearest available PC
   * (by chromatic distance) to maximise applicability across composer changes.
   * @param {{note:number}[]} notes - Input notes to permute
   * @param {{clampMin?:number,clampMax?:number}} [options]
   * @returns {{note:number}[]}
   */
  applyToNotes(notes = [], options = {}) {
    if (!Array.isArray(notes)) {
      throw new Error('Motif.applyToNotes: notes must be an array');
    }
    if (notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? [...notes] : [];
    }

    const { clampMin = 0, clampMax = 127 } = options;

    // Extract pitch numbers from input notes (allow plain numbers or {note:number})
    const inputNotes = notes.map((n, idx) => {
      if (typeof n === 'number') return n;
      if (n && typeof n.note === 'number' && Number.isFinite(n.note)) return n.note;
      throw new Error(`Motif.applyToNotes: invalid input note at index ${idx}; expected number or {note:number} - got ${JSON.stringify(n)}`);
    });

    // Build pool of available input notes indexed by PC
    const notesByPC = new Map();
    for (let i = 0; i < inputNotes.length; i++) {
      const pc = ((inputNotes[i] % 12) + 12) % 12;
      if (!notesByPC.has(pc)) notesByPC.set(pc, []);
      notesByPC.get(pc).push(i);
    }

    const consumedIndices = new Set();
    const result = [];

    for (let motifIdx = 0; motifIdx < this.sequence.length; motifIdx++) {
      const motifPC = ((this.sequence[motifIdx].note % 12) + 12) % 12;

      // Try exact PC match first
      let availableIndices = (notesByPC.get(motifPC) || []).filter(idx => !consumedIndices.has(idx));

      // Fallback: find nearest available PC by chromatic distance
      if (availableIndices.length === 0) {
        let bestDist = 13;
        let bestPC = -1;
        for (const [pc, indices] of notesByPC) {
          if (indices.some(idx => !consumedIndices.has(idx))) {
            const d = m.min(m.abs(pc - motifPC), 12 - m.abs(pc - motifPC));
            if (d < bestDist) { bestDist = d; bestPC = pc; }
          }
        }
        if (bestPC >= 0) availableIndices = notesByPC.get(bestPC).filter(idx => !consumedIndices.has(idx));
      }

      // Last resort: reuse any unconsumed note (or first note)
      if (availableIndices.length === 0) {
        const anyIdx = inputNotes.findIndex((_, i) => !consumedIndices.has(i));
        const fallbackIdx = anyIdx >= 0 ? anyIdx : 0;
        result.push({ note: clampMotifNote(inputNotes[fallbackIdx], clampMin, clampMax) });
        continue;
      }

      const inputIdx = availableIndices[0];
      consumedIndices.add(inputIdx);
      result.push({ note: clampMotifNote(inputNotes[inputIdx], clampMin, clampMax) });
    }

    return result;
  }
}

applyMotifToNotes = (notes, motif = activeMotif, options = {}) => {
  if (!motif) return Array.isArray(notes) ? [...notes] : [];
  if (typeof motif.applyToNotes !== 'function') throw new Error('applyMotifToNotes: motif provided does not implement applyToNotes()');
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
  const tpSubdivNum = Number.isFinite(Number(tpSubdiv)) ? Number(tpSubdiv) : 0;
  const tpSubsubdivNum = Number.isFinite(Number(tpSubsubdiv)) ? Number(tpSubsubdiv) : 0;
  const slack = m.max(1, m.round(tpSubdivNum * 0.1), m.round(tpSubsubdivNum * 0.1));
  const hits = schedule.filter(s => Number.isFinite(Number(s.startTick)) && s.startTick >= (windowStart - slack) && s.startTick < windowEnd);
  hits.sort((a, b) => a.startTick - b.startTick);
  return hits.slice(0, m.max(0, m.min(max, hits.length))).map(s => ({ ...s }));
};
