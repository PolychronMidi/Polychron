// test/helpers/seededRandom.ts - Deterministic random number generation for tests

/**
 * Seeded random number generator for deterministic test behavior.
 * Uses Linear Congruential Generator (LCG) algorithm for reproducibility.
 */
export class SeededRandom {
  private seed: number;
  private readonly a = 1664525;
  private readonly c = 1013904223;
  private readonly m = Math.pow(2, 32);

  constructor(seed: number = 42) {
    this.seed = seed % this.m;
  }

  /**
   * Reset the seed to generate the same sequence again
   */
  reset(seed?: number) {
    if (seed !== undefined) {
      this.seed = seed % this.m;
    } else {
      this.seed = (seed ?? 42) % this.m;
    }
  }

  /**
   * Get next random number between 0 and 1
   */
  next(): number {
    this.seed = (this.a * this.seed + this.c) % this.m;
    return this.seed / this.m;
  }

  /**
   * Get random integer between min and max (inclusive)
   */
  nextInt(min: number = 0, max: number = 1): number {
    const randomValue = this.next();
    return Math.floor(randomValue * (max - min + 1)) + min;
  }

  /**
   * Get random element from array
   */
  choice<T>(array: T[]): T {
    const index = this.nextInt(0, array.length - 1);
    return array[index];
  }

  /**
   * Get random item from array, weighted by optional weights
   */
  weightedChoice<T>(items: T[], weights?: number[]): T {
    if (!weights) {
      return this.choice(items);
    }

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = this.next() * totalWeight;

    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }

    return items[items.length - 1];
  }

  /**
   * Shuffle array in-place using Fisher-Yates
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Generate array of n random numbers
   */
  randoms(n: number, min: number = 0, max: number = 1): number[] {
    return Array(n).fill(0).map(() => min + this.next() * (max - min));
  }
}

/**
 * Global seeded random instance for consistent test behavior
 */
export const testRandom = new SeededRandom(12345);

/**
 * Reset test random to initial seed
 */
export function resetTestRandom() {
  testRandom.reset(12345);
}

/**
 * Create a new seeded random for independent test sequences
 */
export function createSeededRandom(seed: number = Math.random() * 1000000 | 0) {
  return new SeededRandom(seed);
}
