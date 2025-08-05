// Math Utilities - Common mathematical functions
export class MathUtils {
  /**
   * Clamp value between min and max
   */
  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Modulo-based clamp: Value wraps around within range
   */
  static modClamp(value, min, max) {
    const range = max - min + 1;
    return ((value - min) % range + range) % range + min;
  }

  /**
   * Linear interpolation between two values
   */
  static lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Map value from one range to another
   */
  static map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  }

  /**
   * Check if number is power of 2
   */
  static isPowerOf2(n) {
    return (n & (n - 1)) === 0;
  }

  /**
   * Get nearest power of 2
   */
  static nearestPowerOf2(n) {
    const lower = 2 ** Math.floor(Math.log2(n));
    const upper = 2 ** Math.ceil(Math.log2(n));
    return (n - lower) < (upper - n) ? lower : upper;
  }

  /**
   * Degrees to radians
   */
  static degToRad(degrees) {
    return degrees * Math.PI / 180;
  }

  /**
   * Radians to degrees
   */
  static radToDeg(radians) {
    return radians * 180 / Math.PI;
  }

  /**
   * Calculate GCD (Greatest Common Divisor)
   */
  static gcd(a, b) {
    while (b !== 0) {
      const temp = b;
      b = a % b;
      a = temp;
    }
    return a;
  }

  /**
   * Calculate LCM (Least Common Multiple)
   */
  static lcm(a, b) {
    return Math.abs(a * b) / this.gcd(a, b);
  }

  /**
   * Round to specified decimal places
   */
  static roundTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Check if value is approximately equal (within epsilon)
   */
  static approximately(a, b, epsilon = 0.0001) {
    return Math.abs(a - b) < epsilon;
  }
}