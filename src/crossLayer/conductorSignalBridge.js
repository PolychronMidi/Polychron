// conductorSignalBridge.js - Cross-layer module exposing conductor pipeline signals
// to all cross-layer modules via a curated, stable API.
// Reads signalReader each beat and caches a snapshot so cross-layer modules
// never need to understand conductorIntelligence internals.

moduleLifecycle.declare({
  name: 'conductorSignalBridge',
  subsystem: 'crossLayer',
  // Only validator is touched at init top-level. The cross-subsystem
  // references (signalReader, conductorIntelligence, hyperMetaManager,
  // systemDynamicsProfiler) are inside refresh() called per-beat post-boot.
  deps: ['validator'],
  provides: ['conductorSignalBridge'],
  // Phase 4: declare post-init registrations inline. Registry binds the
  // recorder to conductorIntelligence and registers the module with
  // crossLayerRegistry for scoped resets -- replaces the trailing register
  // calls that previously lived after the IIFE close.
  crossLayerScopes: ['all', 'section'],
  recorder: (ctx) => { conductorSignalBridge.refresh(ctx); },
  init: (deps) => {
  const V = deps.validator.create('conductorSignalBridge');
  void V;

  let cached = /** @type {{ density: number, tension: number, flicker: number, compositeIntensity: number, sectionPhase: string, coherenceEntropy: number, healthEma: number, systemPhase: string, exceedanceTrendEma: number, topologyPhase: string, regime: string, effectiveDimensionality: number, couplingStrength: number, axisEnergyShares: Record<string,number>|null, adaptiveTargetSnapshot: Record<string,any>|null, couplingLabels: Record<string,string>|null, regimeProb: {coherent:number,exploring:number,evolving:number}, updatedAt: number }} */ ({
    density: 1,
    tension: 1,
    flicker: 1,
    compositeIntensity: 0,
    sectionPhase: 'development',
    coherenceEntropy: 0,
    // Hypermeta state for CIM phase-gating
    healthEma: 0.7,
    systemPhase: 'converging',
    exceedanceTrendEma: 0,
    topologyPhase: 'fluid',
    regime: 'evolving',
    effectiveDimensionality: 3,
    couplingStrength: 0.3,
    axisEnergyShares: null,
    adaptiveTargetSnapshot: null,
    regimeProb: { coherent: 0.33, exploring: 0.33, evolving: 0.34 },
    updatedAt: 0
  });

  /**
   * Refresh cached signals from the conductor pipeline.
   * Called each beat via registered recorder - ctx carries the current beat's values.
   * compositeIntensity comes from ctx (computed by globalConductorUpdate before recorders run).
   * sectionPhase is read directly from harmonicContext (stable for the entire section).
   * @param {{ absTime: number, compositeIntensity: number, currentDensity: number, harmonicRhythm: number }} ctx
   */
  function refresh(ctx) {
    const snap = signalReader.snapshot();
    // Read hypermeta state (read-only, no boundary violation)
    const hmSnap = hyperMetaManager.getSnapshot();
    cached = {
      density: snap.densityProduct,
      tension: snap.tensionProduct,
      flicker: snap.flickerProduct,
      compositeIntensity: V.requireFinite(ctx.compositeIntensity, 'ctx.compositeIntensity'),
      sectionPhase: V.assertNonEmptyString(harmonicContext.getField('sectionPhase'), 'sectionPhase'),
      coherenceEntropy: V.optionalFinite(snap.stateFields.coherenceEntropy, 0),
      healthEma: hmSnap ? V.optionalFinite(hmSnap.healthEma, 0.7) : 0.7,
      systemPhase: (hmSnap && hmSnap.systemPhase) ? hmSnap.systemPhase : 'converging',
      exceedanceTrendEma: hmSnap ? V.optionalFinite(hmSnap.exceedanceTrendEma, 0) : 0,
      topologyPhase: (hmSnap && hmSnap.topologyPhase) ? hmSnap.topologyPhase : 'fluid',
      // R46: expose regime and axis energy so crossLayer modules don't bypass the bridge
      regime: (() => { const ds = systemDynamicsProfiler.getSnapshot(); return ds ? ds.regime : 'evolving'; })(),
      effectiveDimensionality: (() => { const ds = systemDynamicsProfiler.getSnapshot(); return ds ? V.optionalFinite(ds.effectiveDimensionality, 3) : 3; })(),
      couplingStrength: (() => { const ds = systemDynamicsProfiler.getSnapshot(); return ds ? V.optionalFinite(ds.couplingStrength, 0.3) : 0.3; })(),
      axisEnergyShares: (() => { const ae = pipelineCouplingManager.getAxisEnergyShare(); return (ae && ae.shares) ? /** @type {Record<string,number>} */ (ae.shares) : null; })(),
      adaptiveTargetSnapshot: /** @type {Record<string,any>|null} */ (pipelineCouplingManager.getAdaptiveTargetSnapshot() || null),
      // Semantic coupling labels for axis pairs -- 'opposed'/'contrasting' labels indicate
      // creative anti-correlations that should not be treated as structural failures.
      couplingLabels: (() => { const ds = systemDynamicsProfiler.getSnapshot(); return (ds && ds.couplingLabels) ? ds.couplingLabels : null; })(),
      // Xenolinguistic L2: regime probability distribution (superposition).
      // Instead of collapsing to one regime, expose soft probabilities based on
      // velocity + coupling. Low velocity + high coupling = coherent-leaning.
      // High velocity + low coupling = exploring-leaning. Medium = evolving.
      regimeProb: (() => {
        const ds = systemDynamicsProfiler.getSnapshot();
        if (!ds) return { coherent: 0.33, exploring: 0.33, evolving: 0.34 };
        const vel = V.optionalFinite(ds.velocity, 0.1);
        const coup = V.optionalFinite(ds.couplingStrength, 0.3);
        const coherentScore = clamp((1 - vel * 3) * (coup * 2), 0, 1);
        const exploringScore = clamp(vel * 3 * (1 - coup), 0, 1);
        const evolvingScore = clamp(1 - m.abs(coherentScore - exploringScore), 0.1, 1);
        const total = coherentScore + exploringScore + evolvingScore;
        return {
          coherent: coherentScore / total,
          exploring: exploringScore / total,
          evolving: evolvingScore / total
        };
      })(),
      updatedAt: Date.now()
    };

    // Emit to explainabilityBus when signals reach extremes
    const extremeDensity = cached.density < 0.5 || cached.density > 1.8;
    const extremeTension = cached.tension < 0.5 || cached.tension > 1.8;
    if (extremeDensity || extremeTension) {
      explainabilityBus.emit('conductor-signal-extreme', 'bridge', {
        density: cached.density,
        tension: cached.tension,
        flicker: cached.flicker,
        compositeIntensity: cached.compositeIntensity
      });
    }
  }

  /**
   * Stable read API for cross-layer modules.
   * @returns {Readonly<{ density: number, tension: number, flicker: number, compositeIntensity: number, sectionPhase: string, coherenceEntropy: number }>}
   */
  function getSignals() {
    return Object.freeze({
      density: cached.density,
      tension: cached.tension,
      flicker: cached.flicker,
      compositeIntensity: cached.compositeIntensity,
      sectionPhase: cached.sectionPhase,
      coherenceEntropy: cached.coherenceEntropy,
      healthEma: cached.healthEma,
      systemPhase: cached.systemPhase,
      exceedanceTrendEma: cached.exceedanceTrendEma,
      topologyPhase: cached.topologyPhase,
      regime: cached.regime,
      effectiveDimensionality: cached.effectiveDimensionality,
      couplingStrength: cached.couplingStrength,
      axisEnergyShares: cached.axisEnergyShares,
      adaptiveTargetSnapshot: cached.adaptiveTargetSnapshot,
      couplingLabels: cached.couplingLabels,
      regimeProb: cached.regimeProb
    });
  }

  /** Reset to neutral. */
  function reset() {
    cached = {
      density: 1,
      tension: 1,
      flicker: 1,
      compositeIntensity: 0,
      sectionPhase: 'development',
      coherenceEntropy: 0,
      healthEma: 0.7,
      systemPhase: 'converging',
      exceedanceTrendEma: 0,
      topologyPhase: 'fluid',
      regime: 'evolving',
      effectiveDimensionality: 3,
      couplingStrength: 0.3,
      axisEnergyShares: null,
      adaptiveTargetSnapshot: null,
      couplingLabels: null,
      regimeProb: { coherent: 0.33, exploring: 0.33, evolving: 0.34 },
      updatedAt: 0
    };
  }

  return { refresh, getSignals, reset };
  },
});
