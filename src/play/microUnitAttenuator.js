// microUnitAttenuator.js - caps total note-on events across child units of a parent
// Works subtractively: all notes are buffered during a parent's child cycle,
// then at flush time the lowest-crossModulation events are removed until the
// cap is satisfied. Survivors are written to the active buffer `c`.
//
// Limits per level: ri(2,3) * unitsPerParent
//   e.g. 4 divsPerBeat - cap = ri(8,12) note-ons across the whole beat's divs
//
// Stack-based: supports nested attenuation cycles (div > subdiv > subsubdiv).
// Each begin() pushes a new frame; flush() pops the innermost frame and writes
// survivors to the next frame (or to `c` if at the outermost level).

microUnitAttenuator = (() => {
  const V = validator.create('microUnitAttenuator');
  /** @type {Array<{ unit: string, limit: number, pairs: Array<{ on: object, off: object, score: number }> }>} */
  const microUnitAttenuatorStack = [];

  return {
    /**
     * Begin a new attenuation cycle for a parent unit's children.
     * Pushes a frame onto the stack.
     * @param {string} unit - child unit level ('div'|'subdiv'|'subsubdiv')
     * @param {number} unitsPerParent - how many child units the parent has
     */
    begin(unit, unitsPerParent) {
      const n = Number(unitsPerParent);
      V.requireFinite(n, 'n');
      if (n <= 0) throw new Error(`microUnitAttenuator.begin: invalid unitsPerParent=${unitsPerParent}`);
      // Unit-aware caps: deeper units get tighter limits to prevent texture overload
      // Ranges driven by conductorConfig profile for per-profile density shaping
      V.assertObject(conductorConfig, 'conductorConfig');
      V.requireType(conductorConfig.getAttenuationScaling, 'function', 'conductorConfig.getAttenuationScaling');
      const attCfg = conductorConfig.getAttenuationScaling();
      V.assertObject(attCfg, 'conductorConfig.getAttenuationScaling()');
      V.assertArrayLength(attCfg.subsubdivRange, 2, 'attCfg.subsubdivRange');
      V.assertArrayLength(attCfg.subdivRange, 2, 'attCfg.subdivRange');
      V.assertArrayLength(attCfg.divRange, 2, 'attCfg.divRange');
      const unitMultiplier = unit === 'subsubdiv' ? rf(attCfg.subsubdivRange[0], attCfg.subsubdivRange[1])
        : unit === 'subdiv' ? rf(attCfg.subdivRange[0], attCfg.subdivRange[1])
        : rf(attCfg.divRange[0], attCfg.divRange[1]); // div or beat - widest allowance
      microUnitAttenuatorStack.push({
        unit,
        limit: m.round(unitMultiplier * n),
        pairs: []
      });
    },

    /** @returns {boolean} true when at least one buffering frame is active */
    isActive() { return microUnitAttenuatorStack.length > 0; },

    /**
     * Record a note-on/off pair with its crossModulation score.
     * If a frame is active, buffers into the innermost frame.
     * Otherwise writes through directly to `c`.
     * @param {object} onEvt  - the note-on event object
     * @param {object} offEvt - the matching note-off event object
     * @param {number} score  - crossModulation value at emission time
     */
    record(onEvt, offEvt, score) {
      V.assertObject(onEvt, 'record.onEvt');
      V.assertObject(offEvt, 'record.offEvt');
      V.requireFinite(onEvt.tick, 'record.onEvt.tick');
      V.requireFinite(offEvt.tick, 'record.offEvt.tick');
      if (microUnitAttenuatorStack.length === 0) {
        // No active attenuation - write through immediately
        c.push(onEvt, offEvt);
        return;
      }
      // E20: HyperMeta attenuator score bias. When hypermeta signals a sparse
      // window (e20AttenuatorBias < 1.0), scores are suppressed so that voice
      // cap cuts more aggressively -- structurally reducing note density at
      // the survival-ranking level.
      // Proportional correction: suppression scales with how high the score is
      // relative to a neutral midpoint (~4.0). Low scores (quiet notes that are
      // already near silence) are barely touched; high scores (loud/prominent
      // notes with elevated crossMod) receive the full bias reduction. This
      // prevents over-pruning of naturally sparse content during sparse windows.
      // scoreFraction: 0 at score <= 4.0, 1.0 at score >= 8.0.
      // E20 is skipped during exploring: consistent with E13/E19 -- exploring
      // passages should not receive sparse window suppression at any layer.
      const e20Regime = safePreBoot.call(() => {
        const sn = systemDynamicsProfiler.getSnapshot();
        return sn ? sn.regime : '';
      }, '') || '';
      const e20Bias = safePreBoot.call(
        () => hyperMetaManager.getRateMultiplier('e20AttenuatorBias'), 1.0) || 1.0;
      const rawScore = V.optionalFinite(score, 0);
      const e20ScoreFraction = e20Regime !== 'exploring' ? clamp((rawScore - 4.0) / 4.0, 0, 1) : 0;
      const e20EffectiveBias = 1.0 - (1.0 - e20Bias) * e20ScoreFraction;
      const adjustedScore = rawScore * e20EffectiveBias;
      microUnitAttenuatorStack[microUnitAttenuatorStack.length - 1].pairs.push({ on: onEvt, off: offEvt, score: adjustedScore });
    },

    /**
     * Flush the innermost frame: keep the top-scoring note pairs up to
     * the limit, discard the rest. Writes survivors to the next outer
     * frame (or to `c` if this is the outermost).
     * @returns {number} number of note-on events that survived
     */
    flush() {
      if (microUnitAttenuatorStack.length === 0) return 0;
      const frame = microUnitAttenuatorStack.pop();
      if (!frame) return 0;
      const { limit, pairs } = frame;

      if (pairs.length === 0) return 0;

      // Determine survivors
      let survivors;
      if (pairs.length <= limit) {
        survivors = pairs;
      } else {
        // Sort descending by crossModulation score - highest scores survive
        pairs.sort((a, b) => b.score - a.score);
        // Truncate in-place - avoids allocating a new array via .slice()
        pairs.length = limit;
        // Re-sort survivors by tick order so MIDI output stays chronological
        pairs.sort((a, b) => a.on.tick - b.on.tick);
        survivors = pairs;
      }

      // Write survivors to the next outer frame or directly to `c`
      if (microUnitAttenuatorStack.length > 0) {
        const outer = microUnitAttenuatorStack[microUnitAttenuatorStack.length - 1];
        for (const pair of survivors) outer.pairs.push(pair);
      } else {
        for (const pair of survivors) {
          c.push(pair.on, pair.off);
        }
      }
      return survivors.length;
    },

    /**
     * Abort all frames without flushing (e.g. on error).
     */
    abort() {
      microUnitAttenuatorStack.length = 0;
    }
  };
})();
