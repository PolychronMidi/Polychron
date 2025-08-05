// Random Range Utility - Helper for weighted random ranges
import { RandomGenerator } from './randomGenerator.js';

export class RandomRange {
  constructor(min, max, weights = null) {
    this.min = min;
    this.max = max;
    this.weights = weights;
    this._random = new RandomGenerator();
  }

  /**
   * Get a random value from the range
   */
  random() {
    if (this.weights) {
      return this._random.weightedRandom(this.min, this.max, this.weights);
    } else {
      return this._random.int(this.min, this.max);
    }
  }

  /**
   * Get a random value as float
   */
  randomFloat() {
    if (this.weights) {
      return this._random.weightedRandom(this.min, this.max, this.weights);
    } else {
      return this._random.float(this.min, this.max);
    }
  }

  /**
   * Set new seed for reproducible results
   */
  setSeed(seed) {
    this._random.reset(seed);
  }

  /**
   * Get range info
   */
  getInfo() {
    return {
      min: this.min,
      max: this.max,
      hasWeights: !!this.weights,
      weightCount: this.weights ? this.weights.length : 0
    };
  }
}