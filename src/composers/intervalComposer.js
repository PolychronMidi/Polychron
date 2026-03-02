const V = validator.create('intervalComposer');
/**
 * intervalComposer: Select scale degree subsets from any scale/mode/chord.
 * Universal utility for any composer that needs to choose which scale positions to use.
 * Works with scales, modes, chords, or any note array.
 */
intervalComposer = {
  /**
   * Select which scale degrees to use as a subset of the full scale.
   * Adapts interval selection based on scale length (works with any length).
   * Returns array of 0-indexed scale degree positions.
   *
   * @param {number} scaleLength - Length of the scale (e.g., 7 for major, 5 for pentatonic, 4 for chord)
   * @param {Object} [opts]
   * @param {string} [opts.style] - 'sparse'|'rising'|'even'|'cluster'|'skip'|'full'|'random'
   * @param {number} [opts.density=0.5] - 0..1 density of selected degrees
   * @param {number} [opts.minNotes] - Minimum count to return
   * @param {number} [opts.maxNotes] - Maximum count to return
   * @param {number} [opts.count] - Explicit count override (clamped)
   * @param {number[]} [opts.preferIndices] - Preferred degree indices to include
   * @param {boolean} [opts.jitter=true] - Whether to jitter indices for variation
   * @param {number} [opts.step] - Step size for 'skip' style
   * @returns {number[]} Array of scale degree indices to use (e.g., [0, 2, 3, 6])
   * @throws {Error} If inputs are invalid
   */
  selectIntervals(scaleLength, opts = {}) {
    V.requireFinite(scaleLength, 'scaleLength');
    if (Number(scaleLength) <= 0) {
      throw new Error(`intervalComposer.selectIntervals: invalid scaleLength=${scaleLength}`);
    }
    if (opts !== null) V.requireType(opts, 'object', 'opts');

    const len = Number(scaleLength);
    const options = opts;
    const allIndices = Array.from({ length: len }, (_, i) => i);

    const densityRaw = options.density;
    const density = clamp(V.optionalFinite(densityRaw, 0.5), 0, 1);
    const jitter = options.jitter === undefined ? true : Boolean(options.jitter);

    const minNotesDefault = m.min(2, len);
    const minNotes = clamp(V.optionalFinite(options.minNotes, minNotesDefault), 1, len);
    const maxNotes = clamp(V.optionalFinite(options.maxNotes, len), minNotes, len);

    let count;
    const countRaw = V.optionalFinite(options.count);
    if (countRaw !== undefined) {
      count = m.round(countRaw);
    } else {
      const target = m.round(len * (0.25 + density * 0.75));
      count = clamp(target, minNotes, maxNotes);
    }
    count = clamp(count, minNotes, maxNotes);

    const preferRaw = Array.isArray(options.preferIndices) ? options.preferIndices : [];
    const preferIndices = preferRaw
      .map(val => V.optionalFinite(val, NaN))
      .filter(val => Number.isFinite(val))
      .map(val => clamp(m.round(val), 0, len - 1));

    if (preferIndices.length > maxNotes) {
      throw new Error(`intervalComposer.selectIntervals: preferIndices length ${preferIndices.length} exceeds maxNotes ${maxNotes}`);
    }
    count = m.max(Number(count), preferIndices.length);

    const styles = ['sparse', 'rising', 'even', 'cluster', 'skip', 'full'];
    let style = typeof options.style === 'string' ? options.style : 'random';
    if (style === 'random' || !style) style = styles[ri(styles.length - 1)];
    if (!styles.includes(style)) {
      throw new Error(`intervalComposer.selectIntervals: invalid style="${style}"`);
    }

    const jitterIndex = (value) => {
      if (!jitter) return value;
      return clamp(value + ri(-1, 1), 0, len - 1);
    };

    const buildEven = (targetCount) => {
      if (targetCount <= 1) return [0];
      const step = (len - 1) / (targetCount - 1);
      return Array.from({ length: targetCount }, (_, i) => m.round(i * step));
    };

    const pickFromPool = (pool, targetCount, seedSet) => {
      if (!seedSet) {
        throw new Error('intervalComposer.selectIntervals.pickFromPool: seedSet must be provided');
      }
      const result = new Set(seedSet);
      const src = Array.isArray(pool) && pool.length > 0 ? pool : allIndices;
      let guard = len * 4;
      while (result.size < targetCount && guard-- > 0) {
        result.add(src[ri(src.length - 1)]);
      }
      if (result.size < targetCount) {
        for (const idx of allIndices) {
          result.add(idx);
          if (result.size >= targetCount) break;
        }
      }
      return Array.from(result);
    };

    let baseIndices = [];
    switch (style) {
      case 'sparse': {
        baseIndices = [
          0,
          jitterIndex(m.round(len * 0.25)),
          jitterIndex(m.round(len * 0.5)),
          jitterIndex(m.round(len * 0.75)),
          len - 1,
        ];
        break;
      }
      case 'rising': {
        baseIndices = buildEven(m.min(len, m.max(3, count)));
        baseIndices = baseIndices.map((val, i) => (i === 0 || i === baseIndices.length - 1 ? val : jitterIndex(val)));
        break;
      }
      case 'even': {
        baseIndices = buildEven(m.min(len, count));
        break;
      }
      case 'cluster': {
        const start = ri(len - 1);
        baseIndices = Array.from({ length: m.min(len, count) }, (_, i) => (start + i) % len);
        break;
      }
      case 'skip': {
        const stepRaw = Number(options.step);
        const step = m.max(1, m.round(V.optionalFinite(stepRaw, len >= 7 ? 2 : 1)));
        for (let i = 0; i < len; i += step) baseIndices.push(i);
        break;
      }
      case 'full': {
        baseIndices = allIndices.slice();
        break;
      }
      default:
        baseIndices = allIndices.slice();
        break;
    }

    const preferredSet = new Set(preferIndices);
    let intervals = pickFromPool(baseIndices, count, preferredSet);

    // Clamp, dedupe, sort for consistency
    intervals = intervals
      .map(interval => clamp(V.optionalFinite(interval, 0), 0, len - 1));

    intervals = Array.from(new Set(intervals)).sort((a, b) => a - b);

    if (intervals.length === 0) {
      throw new Error(`intervalComposer.selectIntervals: no valid intervals produced for scaleLength=${scaleLength}`);
    }

    return intervals;
  },
};
