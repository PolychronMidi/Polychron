// conductorDampening.js - Progressive deviation dampening engine for conductor pipelines.
// Extracted from conductorIntelligence.js. Prevents coordinated crush (many modules
// each pulling to 0.85-0.94) from accumulating catastrophic suppression.

conductorDampening = (() => {
  // Base damping (0.6) calibrated for ~20 contributors.
  // Smaller pipelines get proportionally less pass-through so each module's
  // deviation is attenuated more, reducing volatility.
  const BASE_DEVIATION_DAMPING = 0.6;
  const REF_PIPELINE_SIZE = 20;

  // Progressive strength: as the running product diverges from 1.0,
  // subsequent deviations in the same direction face stronger dampening.
  // Deviations opposing the running product get lighter dampening to
  // encourage self-correction.
  const PROGRESSIVE_STRENGTH = 0.50;

  // -- Adaptive clamp widening (self-healing) --
  // Tracks per-contributor pinning via EMA. When a contributor is persistently
  // pinned (EMA > threshold), the effective clamp is widened by up to
  // MAX_WIDEN_FACTOR of the original range. This makes future modules
  // self-healing - they never need manual range re-tuning.
  const PINNED_EMA_ALPHA = 0.08;       // slow EMA to detect sustained pinning
  const PINNED_WIDEN_THRESHOLD = 0.60;  // >60% pinned triggers widening
  const MAX_WIDEN_FACTOR = 0.15;        // max 15% range extension
  /** @type {Map<string, { pinnedEma: number, widenLo: number, widenHi: number }>} */
  const _adaptiveState = new Map();

  /**
   * Effective damping scaled by pipeline contributor count and system dynamics.
   * @param {number} registryLength
   * @returns {number}
   */
  function scaledDamping(registryLength) {
    let base = BASE_DEVIATION_DAMPING;
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.regime === 'fragmented' || snap.regime === 'oscillating') {
        base *= 0.8; // Thicken gravity (less pass-through) when fragmented
      } else if (snap.regime === 'exploring' || snap.regime === 'coherent') {
        base *= 1.2; // Loosen gravity (more pass-through) when coherent
      }
    } catch { /* ignore */ }
    return clamp(base * clamp(registryLength / REF_PIPELINE_SIZE, 0.3, 1.0), 0.1, 1.0);
  }

  /**
   * Progressive dampening factor for a single contributor.
   * @param {number} clamped - contributor's clamped bias value
   * @param {number} baseDamping - pipeline-scaled base dampening
   * @param {number} runningProduct - product so far (before this contributor)
   * @returns {number} dampened value
   */
  function progressiveDampen(clamped, baseDamping, runningProduct) {
    const deviation = clamped - 1.0;
    if (m.abs(deviation) < 1e-6) return 1.0;

    let progStrength = PROGRESSIVE_STRENGTH;
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.effectiveDimensionality < 2.0) {
        progStrength *= 1.5; // Stronger resistance to crush if dimensionality is collapsing
      }
    } catch { /* ignore */ }

    const productDeviation = runningProduct - 1.0;
    const sameDirection = (deviation < 0 && productDeviation < 0) || (deviation > 0 && productDeviation > 0);
    const drift = m.abs(productDeviation);
    const extraDampening = sameDirection ? progStrength * clamp(drift, 0, 0.5) : 0;
    const effectiveDamping = clamp(baseDamping - extraDampening, 0.15, baseDamping);
    return 1.0 + deviation * effectiveDamping;
  }

  /**
   * Apply progressive deviation dampening to a full pipeline registry.
   * @param {Array<{ name: string, getter: () => number, lo: number, hi: number }>} registry
   * @returns {number} dampened product
   */
  function collectDampened(registry) {
    const damping = scaledDamping(registry.length);
    let product = 1;
    for (let i = 0; i < registry.length; i++) {
      product *= progressiveDampen(clamp(registry[i].getter(), registry[i].lo, registry[i].hi), damping, product);
    }
    return product;
  }

  /**
   * Like collectDampened but with per-contributor attribution.
   * Includes adaptive clamp widening: persistently pinned contributors
   * get their effective clamp range gradually widened so the system
   * self-heals boundary pinning without manual re-tuning.
   * @param {Array<{ name: string, getter: () => number, lo: number, hi: number }>} registry
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function collectDampenedWithAttribution(registry) {
    const damping = scaledDamping(registry.length);
    let product = 1;
    const contributions = [];
    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const raw = entry.getter();

      // -- Adaptive clamp widening --
      let lo = entry.lo;
      let hi = entry.hi;
      let as = _adaptiveState.get(entry.name);
      if (!as) {
        as = { pinnedEma: 0, widenLo: 0, widenHi: 0 };
        _adaptiveState.set(entry.name, as);
      }
      const isPinned = (raw < lo || raw > hi) ? 1 : 0;
      as.pinnedEma = as.pinnedEma * (1 - PINNED_EMA_ALPHA) + isPinned * PINNED_EMA_ALPHA;
      if (as.pinnedEma > PINNED_WIDEN_THRESHOLD) {
        const range = hi - lo;
        const widenAmount = range * MAX_WIDEN_FACTOR * clamp((as.pinnedEma - PINNED_WIDEN_THRESHOLD) / (1 - PINNED_WIDEN_THRESHOLD), 0, 1);
        // Widen toward the side that's being pinned
        if (raw < lo) as.widenLo = clamp(as.widenLo + widenAmount * 0.1, 0, range * MAX_WIDEN_FACTOR);
        if (raw > hi) as.widenHi = clamp(as.widenHi + widenAmount * 0.1, 0, range * MAX_WIDEN_FACTOR);
        lo -= as.widenLo;
        hi += as.widenHi;
      } else {
        // Relax widening when pinning subsides
        as.widenLo *= 0.98;
        as.widenHi *= 0.98;
        lo -= as.widenLo;
        hi += as.widenHi;
      }

      const clamped = clamp(raw, lo, hi);
      product *= progressiveDampen(clamped, damping, product);
      contributions.push({ name: entry.name, raw, clamped });
    }
    return { product, contributions };
  }

  return { scaledDamping, progressiveDampen, collectDampened, collectDampenedWithAttribution };
})();
