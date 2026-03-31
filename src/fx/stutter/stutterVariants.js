// stutterVariants.js - registry and per-beat selector for stutter note variants.
// Each variant self-registers. The selector picks one per beat based on regime,
// density, and randomness. Falls back to default stutterNotes when no variant fires.

stutterVariants = (() => {
  const V = validator.create('stutterVariants');
  const registered = new Map();
  let activeVariant = null;
  let activeVariantName = null;
  let lastBeat = -1;
  let sectionStutterCount = 0;

  /**
   * @param {string} name
   * @param {Function} fn
   * @param {number} [weight] - selection weight (higher = more likely)
   * @param {{ selfGate?: number, maxPerSection?: number }} [opts]
   *   selfGate: 0-1 multiplier on per-step gate (lower = fewer steps emit)
   *   maxPerSection: cap total stutter invocations per section for this variant
   */
  function register(name, fn, weight, opts) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(fn, 'function', 'fn');
    const selfGate = (opts && Number.isFinite(opts.selfGate)) ? opts.selfGate : 1.0;
    const maxPerSection = (opts && Number.isFinite(opts.maxPerSection)) ? opts.maxPerSection : Infinity;
    registered.set(name, { fn, weight: V.optionalFinite(weight, 1.0), selfGate, maxPerSection });
  }

  function getVariant(name) {
    const entry = registered.get(name);
    return entry ? entry.fn : null;
  }

  function getNames() { return Array.from(registered.keys()); }

  /** Get the selfGate multiplier for the active variant (1.0 = no extra gating). */
  function getActiveSelfGate() {
    if (!activeVariantName) return 1.0;
    const entry = registered.get(activeVariantName);
    return entry ? entry.selfGate : 1.0;
  }

  /**
   * Check if the active variant has hit its per-section cap.
   * Returns true if the invocation should be skipped.
   */
  function shouldThrottle() {
    if (!activeVariantName) return false;
    const entry = registered.get(activeVariantName);
    if (!entry || entry.maxPerSection === Infinity) return false;
    return sectionStutterCount >= entry.maxPerSection;
  }

  /** Increment section stutter counter. Called per stutter invocation. */
  function incSectionCount() { sectionStutterCount++; }

  /**
   * Select a variant for this beat. Called from StutterManager.prepareBeat.
   * Weighted random selection. Returns the chosen variant function or null
   * (null = use default stutterNotes).
   */
  function selectForBeat() {
    if (beatIndex === lastBeat) return activeVariant;
    lastBeat = beatIndex;

    if (registered.size === 0) { activeVariant = null; activeVariantName = null; return null; }

    // Build weighted pool including null (default) at weight 2.0
    const pool = [{ name: null, fn: null, weight: 2.0 }];
    for (const [name, entry] of registered) {
      pool.push({ name, fn: entry.fn, weight: entry.weight });
    }
    let totalWeight = 0;
    for (let i = 0; i < pool.length; i++) totalWeight += pool[i].weight;

    let roll = rf() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) {
        activeVariant = pool[i].fn;
        activeVariantName = pool[i].name;
        return activeVariant;
      }
    }
    activeVariant = null;
    activeVariantName = null;
    return null;
  }

  function getActive() { return activeVariant; }
  function getActiveName() { return activeVariantName; }

  function reset() {
    activeVariant = null;
    activeVariantName = null;
    lastBeat = -1;
    sectionStutterCount = 0;
  }

  function resetSection() {
    sectionStutterCount = 0;
  }

  return { register, getVariant, getNames, selectForBeat, getActive, getActiveName,
    getActiveSelfGate, shouldThrottle, incSectionCount, reset, resetSection };
})();
