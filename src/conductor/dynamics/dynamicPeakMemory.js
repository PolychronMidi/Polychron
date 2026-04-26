// src/conductor/dynamicPeakMemory.js - Dynamic peak/trough spacing tracker.
// Remembers the loudest and quietest moments and prevents re-peaking too soon.
// Tension bias spaces dynamic peaks for maximum impact.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'dynamicPeakMemory',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'validator'],
  lazyDeps: ['conductorState'],
  provides: ['dynamicPeakMemory'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('dynamicPeakMemory');
  const MAX_PEAKS = 12;
  /** @type {Array<{ intensity: number, time: number, type: string }>} */
  const peaks = [];
  let lastIntensity = 0.5;
  let peakCooldown = 0;

  /**
   * Record intensity and detect peaks/troughs.
   * @param {number} intensity - 0-1 composite intensity
   * @param {number} absTime
   */
  function recordIntensity(intensity, absTime) {
    V.requireFinite(intensity, 'intensity');
    V.requireFinite(absTime, 'absTime');
    const clamped = clamp(intensity, 0, 1);

    // Detect peaks (local maxima above 0.75) and troughs (below 0.25)
    if (clamped > 0.75 && lastIntensity <= 0.75 && peakCooldown <= 0) {
      peaks.push({ intensity: clamped, time: absTime, type: 'peak' });
      peakCooldown = 3; // minimum samples between peaks
    } else if (clamped < 0.25 && lastIntensity >= 0.25 && peakCooldown <= 0) {
      peaks.push({ intensity: clamped, time: absTime, type: 'trough' });
      peakCooldown = 3;
    }

    if (peakCooldown > 0) peakCooldown--;
    lastIntensity = clamped;
    if (peaks.length > MAX_PEAKS) peaks.shift();
  }

  /**
   * Get peak spacing signal.
   * @returns {{ tensionBias: number, timeSinceLastPeak: number, peakRecency: string }}
   */
  function dynamicPeakMemoryComputePeakSignal() {
    if (peaks.length === 0) {
      return { tensionBias: 1, timeSinceLastPeak: Infinity, peakRecency: 'none' };
    }

    const lastPeak = peaks[peaks.length - 1];
    const now = V.requireFinite(beatStartTime, 'beatStartTime');
    const timeSince = now - lastPeak.time;
    const longFormBuildPressure = totalSections >= 5 && sectionIndex > 0 && sectionIndex < totalSections - 1 ? 1 : 0;

    let peakRecency = 'distant';
    if (timeSince < 5) peakRecency = 'very-recent';
    else if (timeSince < 15) peakRecency = 'recent';
    else if (timeSince < 30) peakRecency = 'moderate';

    // Tension bias: continuous ramp based on time since last peak/trough.
    // Peak: timeSince 0-8 - 0.92 (suppress), 8-25 - ramp 0.92-1.0, 25+ - ramp to 1.06.
    // Trough: timeSince 0-5 - ramp 1.04-1.0.
    let tensionBias = 1;
    if (lastPeak.type === 'peak') {
      // R17 E2: Extended post-peak suppression window 8->12. Creates
      // longer tension valleys after peaks, improving dynamic contrast
      // and reducing TF/TE exceedance in post-peak sections.
      if (timeSince < 12) {
        // R10 E1: Deeper post-peak suppression (0.88 vs 0.92) and stronger
        // build ramp (1.12 vs 1.06). Creates more dramatic tension contrast
        // between post-peak valleys and the buildup to the next climax.
        tensionBias = 0.88 + clamp(timeSince / 12, 0, 1) * 0.06 + longFormBuildPressure * 0.015;
      } else {
        // Post-cooldown: ramp 0.94-1.08 over 12-40s
        // R24 E2: Reduced ceiling 1.12->1.08 to create tension headroom.
        // Product was capping at 1.4986 (from 1.5359); freeing 0.04 from
        // this top contributor lets new tension pathways have effect.
        tensionBias = 0.94 + clamp((timeSince - 12) / 28, 0, 1) * 0.14 + longFormBuildPressure * 0.015;
      }
    } else {
      // After trough: ramp 1.04-1.0 over 0-10s
      tensionBias = 1.04 + longFormBuildPressure * 0.015 - clamp(timeSince / 10, 0, 1) * 0.04;
    }

    if (tensionBias > 1.0) {
      const tensionProduct = conductorState.getField('tension');
      const saturationPressure = clamp((tensionProduct - 1.10) / 0.20, 0, 1);
      if (saturationPressure > 0) {
        tensionBias = 1.0 + (tensionBias - 1.0) * (1 - saturationPressure * 0.65);
      }
    }

    return { tensionBias, timeSinceLastPeak: timeSince, peakRecency };
  }

  const dynamicPeakMemoryCache = beatCache.create(dynamicPeakMemoryComputePeakSignal);

  /**
   * Get peak spacing signal (cached per beat).
   * @returns {{ tensionBias: number, timeSinceLastPeak: number, peakRecency: string }}
   */
  function getPeakSignal() { return dynamicPeakMemoryCache.get(); }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getPeakSignal().tensionBias;
  }

  /** Reset tracking. */
  function reset() {
    peaks.length = 0;
    lastIntensity = 0.5;
    peakCooldown = 0;
  }

  // R10 E1: Widened registration range from (0.9, 1.1) to (0.85, 1.15)
  // to match the expanded bias values (0.88-1.12).
  conductorIntelligence.registerTensionBias('dynamicPeakMemory', () => dynamicPeakMemory.getTensionBias(), 0.85, 1.15);
  conductorIntelligence.registerRecorder('dynamicPeakMemory', (ctx) => { if (ctx.layer === 'L2') return; dynamicPeakMemory.recordIntensity(ctx.compositeIntensity, ctx.absTime); });
  conductorIntelligence.registerStateProvider('dynamicPeakMemory', () => {
    const s = dynamicPeakMemory.getPeakSignal();
    return { dynamicPeakRecency: s ? s.peakRecency : 'none' };
  });
  conductorIntelligence.registerModule('dynamicPeakMemory', { reset }, ['section']);

  return {
    recordIntensity,
    getPeakSignal,
    getTensionBias,
    reset
  };
  },
});
