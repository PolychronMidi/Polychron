// signalHealthAnalyzer.js - Meta-diagnostic: assesses pipeline health per beat.
// Detects the four failure modes that previously required manual tuning:
//   1. Boundary saturation - a contributor is pinned at its clamp min/max
//   2. Multiplicative crush - many contributors pulling product from 1.0
//   3. Pipeline saturation - product hitting floor/ceiling
//   4. Trust starvation - trust score decaying toward zero
// Emits health grades into conductorState and explainabilityBus each beat.
// Does NOT modify signal values - pure observation + diagnostics.

moduleLifecycle.declare({
  name: 'signalHealthAnalyzer',
  subsystem: 'conductor',
  deps: [],
  provides: ['signalHealthAnalyzer'],
  init: () => {
  // -- Accumulator state (reset per section) --
  let beatsSeen = 0;
  /** @type {{ density: number, tension: number, flicker: number }} */
  const pinnedCounts = { density: 0, tension: 0, flicker: 0 };
  /** @type {{ density: number, tension: number }} */
  const saturationCounts = { density: 0, tension: 0 };

  // -- Per-beat health snapshot (cached for stateProvider) --
  let signalHealthAnalyzerLastHealth = signalHealthAnalyzerEmptyHealth();

  /** @returns {SignalHealthSnapshot} */
  function signalHealthAnalyzerEmptyHealth() {
    return {
      density: { grade: 'healthy', product: 1, pinnedModules: [], crushFactor: 0, saturated: false },
      tension: { grade: 'healthy', product: 1, pinnedModules: [], crushFactor: 0, saturated: false },
      flicker: { grade: 'healthy', product: 1, pinnedModules: [], crushFactor: 0 },
      trust: { grade: 'healthy', starvingSystems: [], thrivingSystems: [] },
      overall: 'healthy'
    };
  }

  /**
   * Analyze one pipeline's attribution for boundary-pinning and multiplicative crush.
   * @param {{ product: number, rawProduct?: number, floored?: boolean, capped?: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} attr
   * @returns {{ grade: string, product: number, pinnedModules: string[], crushFactor: number, saturated: boolean }}
   */
  function signalHealthAnalyzerAnalyzePipeline(attr) {
    const pinnedModules = [];
    let suppressorCount = 0;
    let boosterCount = 0;

    for (let i = 0; i < attr.contributions.length; i++) {
      const c = attr.contributions[i];
      // Boundary-pinned: raw !== clamped (the clamp actually bit)
      if (c.raw !== c.clamped) {
        pinnedModules.push(c.name);
      }
      if (c.clamped < 0.98) suppressorCount++;
      if (c.clamped > 1.02) boosterCount++;
    }

    // Crush factor: how many contributors are pulling product away from 1.0
    // in the same direction. High crushFactor = many modules ganging up.
    const total = attr.contributions.length;
    const dominantDirection = suppressorCount >= boosterCount ? suppressorCount : boosterCount;
    const crushFactor = total > 0 ? dominantDirection / total : 0;

    // Pipeline saturation: product hit floor or ceiling
    const saturated = Boolean(attr.floored || attr.capped);

    // Width-aware crush threshold: wider pipelines naturally produce higher
    // consensus ratios because more independent signals are likely to agree
    // on direction. Base threshold 0.40 adjusts up by 1% per contributor
    // beyond 10, capped at 0.58.
    const widthAdjust = m.max(0, (total - 10) * 0.01);
    const crushThreshold = m.min(0.58, 0.40 + widthAdjust);

    // Grading
    let grade = 'healthy';
    if (saturated && crushFactor > crushThreshold) grade = 'critical';
    else if (saturated || pinnedModules.length >= 3) grade = 'stressed';
    else if (pinnedModules.length >= 1 || crushFactor > crushThreshold) grade = 'strained';

    return { grade, product: attr.product, pinnedModules, crushFactor, saturated };
  }

  /**
   * Analyze trust ecosystem health.
   * @returns {{ grade: string, starvingSystems: string[], thrivingSystems: string[] }}
   */
  function signalHealthAnalyzerAnalyzeTrust() {
    let snapshot;
    try {
      snapshot = adaptiveTrustScores.getSnapshot();
    } catch { /* boot-safety: dependency may not be ready */
      return { grade: 'unknown', starvingSystems: [], thrivingSystems: [] };
    }

    const starvingSystems = [];
    const thrivingSystems = [];

    const entries = Object.entries(snapshot);
    for (let i = 0; i < entries.length; i++) {
      const [name, data] = entries[i];
      if (!data || typeof data.score !== 'number') continue;
      if (data.score < 0.05 && data.samples > 50) starvingSystems.push(name);
      if (data.score > 0.4) thrivingSystems.push(name);
    }

    let grade = 'healthy';
    if (starvingSystems.length > entries.length * 0.5) grade = 'critical';
    else if (starvingSystems.length >= 2) grade = 'stressed';
    else if (starvingSystems.length >= 1) grade = 'strained';

    return { grade, starvingSystems, thrivingSystems };
  }

  /**
   * Compute overall health from pipeline + trust grades.
   * @param {Array<string>} grades
   * @returns {string}
   */
  function signalHealthAnalyzerOverallGrade(grades) {
    if (grades.includes('critical')) return 'critical';
    if (grades.includes('stressed')) return 'stressed';
    if (grades.includes('strained')) return 'strained';
    return 'healthy';
  }

  /**
   * Run full health analysis. Called each beat via conductorIntelligence recorder.
   */
  function analyze() {
    beatsSeen++;

    const densityAttr = conductorIntelligence.collectDensityBiasWithAttribution();
    const tensionAttr = conductorIntelligence.collectTensionBiasWithAttribution();
    const flickerAttr = conductorIntelligence.collectFlickerModifierWithAttribution();

    const density = signalHealthAnalyzerAnalyzePipeline(densityAttr);
    const tension = signalHealthAnalyzerAnalyzePipeline(tensionAttr);
    // Flicker has no floor/ceiling so force saturated=false
    const flickerRaw = signalHealthAnalyzerAnalyzePipeline(flickerAttr);
    const flicker = { grade: flickerRaw.grade, product: flickerRaw.product, pinnedModules: flickerRaw.pinnedModules, crushFactor: flickerRaw.crushFactor };
    const trust = signalHealthAnalyzerAnalyzeTrust();

    const overall = signalHealthAnalyzerOverallGrade([density.grade, tension.grade, flicker.grade, trust.grade]);

    signalHealthAnalyzerLastHealth = { density, tension, flicker, trust, overall };

    // Track cumulative saturation / pinning for end-of-run summary
    if (density.pinnedModules.length > 0) pinnedCounts.density++;
    if (tension.pinnedModules.length > 0) pinnedCounts.tension++;
    if (flicker.pinnedModules.length > 0) pinnedCounts.flicker++;
    if (density.saturated) saturationCounts.density++;
    if (tension.saturated) saturationCounts.tension++;

    // Emit diagnostics on non-healthy beats
    if (overall !== 'healthy') {
      explainabilityBus.emit('signal-health', 'both', {
        overall,
        density: { grade: density.grade, pinnedModules: density.pinnedModules, crushFactor: density.crushFactor, saturated: density.saturated },
        tension: { grade: tension.grade, pinnedModules: tension.pinnedModules, crushFactor: tension.crushFactor, saturated: tension.saturated },
        flicker: { grade: flicker.grade, pinnedModules: flicker.pinnedModules, crushFactor: flicker.crushFactor },
        trust: { grade: trust.grade, starvingSystems: trust.starvingSystems }
      }, beatStartTime);
    }
  }

  /** @returns {SignalHealthSnapshot} */
  function getHealth() {
    return signalHealthAnalyzerLastHealth;
  }

  /**
   * End-of-run summary: percentage of beats spent in each state.
   * Recomputes trust from the final snapshot to avoid stale per-beat data.
   * @returns {SignalHealthSummary}
   */
  function getSummary() {
    const b = m.max(1, beatsSeen);
    // Recompute trust from the final trust scores - the per-beat signalHealthAnalyzerLastHealth.trust
    // can be stale because the recorder runs before crossLayerBeatRecord registers
    // the current beat's outcomes.
    const freshTrust = signalHealthAnalyzerAnalyzeTrust();
    const freshOverall = signalHealthAnalyzerOverallGrade([
      signalHealthAnalyzerLastHealth.density.grade,
      signalHealthAnalyzerLastHealth.tension.grade,
      signalHealthAnalyzerLastHealth.flicker.grade,
      freshTrust.grade
    ]);
    return {
      beatsAnalyzed: beatsSeen,
      pinnedRate: {
        density: pinnedCounts.density / b,
        tension: pinnedCounts.tension / b,
        flicker: pinnedCounts.flicker / b
      },
      saturationRate: {
        density: saturationCounts.density / b,
        tension: saturationCounts.tension / b
      },
      lastHealth: {
        density: signalHealthAnalyzerLastHealth.density,
        tension: signalHealthAnalyzerLastHealth.tension,
        flicker: signalHealthAnalyzerLastHealth.flicker,
        trust: freshTrust,
        overall: freshOverall
      }
    };
  }

  /** Reset per-section accumulators. */
  function reset() {
    beatsSeen = 0;
    pinnedCounts.density = 0;
    pinnedCounts.tension = 0;
    pinnedCounts.flicker = 0;
    saturationCounts.density = 0;
    saturationCounts.tension = 0;
    signalHealthAnalyzerLastHealth = signalHealthAnalyzerEmptyHealth();
  }

  // -- Self-register --
  conductorIntelligence.registerRecorder('signalHealthAnalyzer', () => { signalHealthAnalyzer.analyze(); });
  conductorIntelligence.registerStateProvider('signalHealthAnalyzer', () => ({
    signalHealthOverall: signalHealthAnalyzerLastHealth.overall,
    signalHealthDensityGrade: signalHealthAnalyzerLastHealth.density.grade,
    signalHealthTensionGrade: signalHealthAnalyzerLastHealth.tension.grade,
    signalHealthFlickerGrade: signalHealthAnalyzerLastHealth.flicker.grade,
    signalHealthTrustGrade: signalHealthAnalyzerLastHealth.trust.grade
  }));
  conductorIntelligence.registerModule('signalHealthAnalyzer', { reset }, ['section']);

  return { analyze, getHealth, getSummary, reset };
  },
});
