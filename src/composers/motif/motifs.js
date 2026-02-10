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
   * Reorder motif by rotating sequence (no pitch changes).
   * @param {number} semitones
   * @returns {this}
   */
  transpose(semitones = 0) {
    const len = this.sequence.length;
    if (len <= 1) return /** @type {this} */ (new Motif(this.sequence, { defaultDuration: this.defaultDuration }));
    const shift = ((Math.round(semitones) % len) + len) % len;
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
   * Apply motif as a permutation: reorder input notes according to motif sequence order.
   * Matches input notes to motif events by pitch class, preserving octaves.
   * Strictly enforces that motif and input have same pitch class multiset.
   * @param {{note:number}[]} notes - Input notes to permute
   * @param {{clampMin?:number,clampMax?:number}} [options]
   * @returns {{note:number}[]}
   * @throws {Error} if motif sequence PCs don't match input note PCs
   */
  applyToNotes(notes = [], options = {}) {
    if (!Array.isArray(notes)) {
      throw new Error('Motif.applyToNotes: notes must be an array');
    }
    if (notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? [...notes] : [];
    }

    const { clampMin = 0, clampMax = 127 } = options;

    // Extract pitch numbers from input notes (allow plain numbers or {note:number}) and validate
    const inputNotes = notes.map((n, idx) => {
      if (typeof n === 'number') return n;
      if (n && typeof n.note === 'number' && Number.isFinite(n.note)) return n.note;
      throw new Error(`Motif.applyToNotes: invalid input note at index ${idx}; expected number or {note:number} - got ${JSON.stringify(n)}`);
    });
    const inputPCs = inputNotes.map(note => ((note % 12) + 12) % 12);

    // Extract pitch classes from motif sequence
    const motifPCs = this.sequence.map(evt => ((evt.note % 12) + 12) % 12);

    // Validate that motif and input have same pitch class multiset
    const inputPCCounts = new Map();
    for (const pc of inputPCs) {
      inputPCCounts.set(pc, (inputPCCounts.get(pc) ?? 0) + 1);
    }

    const motifPCCounts = new Map();
    for (const pc of motifPCs) {
      motifPCCounts.set(pc, (motifPCCounts.get(pc) ?? 0) + 1);
    }

    // Check counts match
    if (inputPCCounts.size !== motifPCCounts.size) {
      const inputPCList = Array.from(inputPCCounts.keys()).sort((a, b) => a - b);
      const motifPCList = Array.from(motifPCCounts.keys()).sort((a, b) => a - b);
      throw new Error(`Motif.applyToNotes: pitch class mismatch. Input PCs: ${inputPCList.join(',')}, motif PCs: ${motifPCList.join(',')}`);
    }
    for (const [pc, count] of motifPCCounts) {
      if ((inputPCCounts.get(pc) ?? 0) !== count) {
        throw new Error(`Motif.applyToNotes: PC ${pc} count mismatch. Input has ${inputPCCounts.get(pc) ?? 0}, motif requires ${count}`);
      }
    }

    // Build pool of input notes by PC (allows reuse per motif cycle)
    const notesByPC = new Map();
    for (let i = 0; i < inputNotes.length; i++) {
      const pc = inputPCs[i];
      if (!notesByPC.has(pc)) notesByPC.set(pc, []);
      notesByPC.get(pc).push(i);
    }

    // For each motif event, consume a note with matching PC
    const result = [];
    const consumedIndices = new Set();

    for (let motifIdx = 0; motifIdx < this.sequence.length; motifIdx++) {
      const motifPC = motifPCs[motifIdx];
      const availableIndices = (notesByPC.get(motifPC) ?? []).filter(idx => !consumedIndices.has(idx));

      if (availableIndices.length === 0) {
        throw new Error(`Motif.applyToNotes: no available input note with PC ${motifPC} for motif position ${motifIdx}`);
      }

      // Use first available note with matching PC (try to preserve order when possible)
      const inputIdx = availableIndices[0];
      consumedIndices.add(inputIdx);

      const inputNote = inputNotes[inputIdx];
      const outputNote = clampMotifNote(inputNote, clampMin, clampMax);
      result.push({ note: outputNote });
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
