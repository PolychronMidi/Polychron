// stutterVariants.js - registry and per-beat selector for stutter note variants.
// Each variant self-registers. The selector picks one per beat based on regime,
// density, and randomness. Falls back to default stutterNotes when no variant fires.

stutterVariants = (() => {
  const V = validator.create('stutterVariants');
  const registered = new Map();
  let activeVariant = null;
  let lastBeat = -1;

  function register(name, fn, weight) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(fn, 'function', 'fn');
    registered.set(name, { fn, weight: V.optionalFinite(weight, 1.0) });
  }

  function getVariant(name) {
    const entry = registered.get(name);
    return entry ? entry.fn : null;
  }

  function getNames() { return Array.from(registered.keys()); }

  /**
   * Select a variant for this beat. Called from StutterManager.prepareBeat.
   * Weighted random selection. Returns the chosen variant function or null
   * (null = use default stutterNotes).
   */
  function selectForBeat() {
    if (beatIndex === lastBeat) return activeVariant;
    lastBeat = beatIndex;

    if (registered.size === 0) { activeVariant = null; return null; }

    // Build weighted pool including null (default) at weight 2.0
    const pool = [{ fn: null, weight: 2.0 }];
    for (const [, entry] of registered) {
      pool.push(entry);
    }
    let totalWeight = 0;
    for (let i = 0; i < pool.length; i++) totalWeight += pool[i].weight;

    let roll = rf() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) { activeVariant = pool[i].fn; return activeVariant; }
    }
    activeVariant = null;
    return null;
  }

  function getActive() { return activeVariant; }

  function reset() {
    activeVariant = null;
    lastBeat = -1;
  }

  return { register, getVariant, getNames, selectForBeat, getActive, reset };
})();
