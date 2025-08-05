// Random Generator - Professional pseudo-random number generator
export class RandomGenerator {
  constructor(seed = null) {
    this.seed = seed || Date.now();
    this.state = this.seed;
    this.cache = new Map();
  }

  // Core random function using LCG algorithm
  random() {
    this.state = (this.state * 1664525 + 1013904223) % 2**32;
    return this.state / 2**32;
  }

  // Integer between min and max (inclusive)
  int(min = 0, max = 1) {
    if (arguments.length === 1) {
      max = min;
      min = 0;
    }
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  // Float between min and max
  float(min = 0, max = 1) {
    if (arguments.length === 1) {
      max = min;
      min = 0;
    }
    return this.random() * (max - min) + min;
  }

  // Boolean with optional probability
  boolean(probability = 0.5) {
    return this.random() < probability;
  }

  // Choose random element from array
  choice(array) {
    if (!Array.isArray(array) || array.length === 0) {
      throw new Error('choice() requires non-empty array');
    }
    return array[this.int(0, array.length - 1)];
  }

  // Sample multiple elements from array
  sample(array, count) {
    if (!Array.isArray(array)) {
      throw new Error('sample() requires array');
    }
    if (count > array.length) {
      throw new Error('sample() count cannot exceed array length');
    }
    
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, count);
  }

  // Weighted random selection
  weightedRandom(min, max, weights) {
    if (!weights || weights.length === 0) {
      return this.int(min, max);
    }
    
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) {
      return this.int(min, max);
    }
    
    let random = this.random() * totalWeight;
    
    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        const range = max - min;
        const step = range / (weights.length - 1);
        return Math.round(min + i * step);
      }
    }
    
    return max;
  }

  // Variation with limits and probability
  variation(value, limits = [-0.1, 0.1], probability = 1, extraLimits = null) {
    if (this.random() > probability) {
      return value;
    }
    
    const [minLimit, maxLimit] = limits;
    let variation = this.float(minLimit, maxLimit);
    
    if (extraLimits && this.random() < 0.3) {
      const [extraMin, extraMax] = extraLimits;
      variation += this.float(extraMin, extraMax);
    }
    
    return value + (value * variation);
  }

  // Limited change within bounds
  limitedChange(currentValue, changeMin, changeMax, absoluteMin, absoluteMax) {
    const change = this.float(changeMin, changeMax);
    const newValue = currentValue + change;
    return Math.max(absoluteMin, Math.min(absoluteMax, newValue));
  }

  // Reset with new seed
  reset(seed = null) {
    this.seed = seed || Date.now();
    this.state = this.seed;
    this.cache.clear();
  }

  // Get current seed
  getSeed() {
    return this.seed;
  }

  // Get current state
  getState() {
    return this.state;
  }
}