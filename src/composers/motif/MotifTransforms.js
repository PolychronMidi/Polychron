// MotifTransforms.js - Motif transformation strategies
// Pure permutation transformations for motif sequences

/**
 * Motif transformation utilities for reverse, rotate, invert, and augment operations.
 * All transformations operate in-place on the provided array for efficiency.
 */
MotifTransforms = {
  /**
   * Reverse array in-place
   * @param {any[]} entries - Array to reverse
   */
  reverse(entries) {
    const len = entries.length;
    for (let i = 0; i < Math.floor(len / 2); i++) {
      const j = len - 1 - i;
      const temp = entries[i];
      entries[i] = entries[j];
      entries[j] = temp;
    }
  },

  /**
   * Rotate array by shifting positions (positive = right shift, negative = left shift)
   * @param {any[]} entries - Array to rotate
   * @param {number} amount - Shift amount (wraps around)
   */
  rotate(entries, amount) {
    const len = entries.length;
    const shift = ((amount % len) + len) % len;
    if (shift > 0) {
      const rotated = entries.slice(-shift).concat(entries.slice(0, len - shift));
      for (let i = 0; i < len; i++) entries[i] = rotated[i];
    }
  },

  /**
   * Invert (mirror) array around pivot index
   * @param {any[]} entries - Array to invert
   * @param {number} pivot - Pivot index for mirroring
   */
  invert(entries, pivot = 0) {
    const len = entries.length;
    const inverted = new Array(len);
    for (let i = 0; i < len; i++) {
      const srcIdx = ((2 * pivot - i) % len + len) % len;
      inverted[i] = entries[srcIdx];
    }
    for (let i = 0; i < len; i++) entries[i] = inverted[i];
  },

  /**
   * Augment durations by random factor
   * @param {Array<{duration?: number}>} entries - Entries with optional duration property
   */
  augmentDuration(entries) {
    const factor = rf(1.1, 2.0);
    entries.forEach(e => {
      if (e.duration && typeof e.duration === 'number') {
        e.duration = Math.max(1, Math.round(e.duration * factor));
      }
    });
  },

  /**
   * Select random transformations with at least one guaranteed
   * @param {number} arrayLength - Length of array to transform (for rotate bounds)
   * @returns {Array<string|{type: string, amount?: number, pivot?: number}>} Array of transform descriptors
   */
  selectRandom(arrayLength) {
    const transforms = [];
    if (rf() > 0.5) transforms.push('reverse');
    if (rf() > 0.5) transforms.push({ type: 'rotate', amount: ri(-arrayLength, arrayLength) });
    if (rf() > 0.5) transforms.push({ type: 'invert', pivot: 0 });
    if (rf() > 0.5) transforms.push('augmentDuration');

    // Ensure at least one transformation
    if (transforms.length === 0) {
      const options = [
        'reverse',
        { type: 'rotate', amount: 1 },
        { type: 'invert', pivot: 0 },
        'augmentDuration'
      ];
      transforms.push(options[ri(0, 3)]);
    }

    return transforms;
  },

  /**
   * Apply array of transformations to entries
   * @param {any[]} entries - Array to transform
   * @param {Array<string|{type: string, amount?: number, pivot?: number}>} transforms - Transform descriptors
   * @throws {Error} If transformation fails
   */
  applyAll(entries, transforms) {
    if (!Array.isArray(entries) || !Array.isArray(transforms)) {
      throw new Error('MotifTransforms.applyAll: entries and transforms must be arrays');
    }

    for (const transform of transforms) {
      if (transform === 'reverse') {
        this.reverse(entries);
      } else if (typeof transform === 'object' && transform !== null) {
        const t = /** @type {{type: string, amount?: number, pivot?: number}} */ (transform);
        if (t.type === 'rotate') {
          this.rotate(entries, t.amount ?? 1);
        } else if (t.type === 'invert') {
          this.invert(entries, t.pivot ?? 0);
        } else {
          throw new Error(`MotifTransforms.applyAll: unknown transform type "${t.type}"`);
        }
      } else if (transform === 'augmentDuration') {
        this.augmentDuration(entries);
      } else {
        throw new Error(`MotifTransforms.applyAll: unknown transform ${JSON.stringify(transform)}`);
      }
    }
  }
};
