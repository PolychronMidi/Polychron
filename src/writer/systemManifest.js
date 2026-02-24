// systemManifest.js — Emit system-manifest.json and capability-matrix.md after composition.
// Captures the organism's configuration and module topology for each run,
// enabling compositional forensics and newcomer onboarding.

systemManifest = (() => {
  const V = Validator.create('systemManifest');

  /**
   * Write system-manifest.json and capability-matrix.md to output/.
   * Call after grandFinale() — all registries are fully populated at this point.
   */
  function emit() {
    const manifest = _buildManifest();

    // ── Attribution (live call — not cached in manifest) ──
    const attribution = {
      density: ConductorIntelligence.collectDensityBiasWithAttribution(),
      tension: ConductorIntelligence.collectTensionBiasWithAttribution(),
      flicker: ConductorIntelligence.collectFlickerModifierWithAttribution()
    };

    // Extra-pipeline density multipliers (outside the registry product).
    // Captured from ConductorState so the manifest reveals the full picture.
    const snap = ConductorState.getSnapshot();
    const extraDensityMultipliers = {
      emissionCorrection: snap.extraDensityCorrection,
      coherenceDensityBias: snap.extraCoherenceDensityBias
    };

    manifest.attribution = {
      density: Object.assign(_serializeAttribution(attribution.density), { extraMultipliers: extraDensityMultipliers }),
      tension: _serializeAttribution(attribution.tension),
      flicker: _serializeAttribution(attribution.flicker)
    };

    // ── Coherence verdicts ──
    manifest.coherenceVerdicts = coherenceVerdicts.compute(manifest, attribution);

    const manifestPath = 'output/system-manifest.json';
    const matrixPath = 'output/capability-matrix.md';

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Wrote file: ${manifestPath}`);

    const matrix = systemManifestMarkdown.build(manifest, attribution);
    fs.writeFileSync(matrixPath, matrix, 'utf8');
    console.log(`Wrote file: ${matrixPath}`);
  }

  /**
   * Serialize an attribution result for JSON output.
   * @param {object} attr
   * @returns {object}
   */
  function _serializeAttribution(attr) {
    return {
      product: attr.product,
      rawProduct: attr.rawProduct,
      floored: attr.floored || false,
      capped: attr.capped || false,
      contributions: attr.contributions.map(c => ({
        name: c.name, raw: c.raw, clamped: c.clamped
      }))
    };
  }

  /** @returns {object} */
  function _buildManifest() {
    // ── Registry topology ──
    const registryManifest = MainBootstrap.getRegistryManifest();

    // ── Conductor signal snapshot ──
    // Firewall: use signalReader API instead of ConductorIntelligence directly.
    const signalSnapshot = signalReader.snapshot();

    // ── Active conductor profile ──
    const activeProfile = ConductorConfig.getActiveProfileName();

    // ── Harmonic journey plan ──
    let journeyPlan = [];
    try {
      journeyPlan = HarmonicJourney.getPlan().map((stop, i) => ({
        section: i,
        key: stop.key,
        mode: stop.mode,
        move: stop.move,
        distance: stop.distance
      }));
    } catch {
      // Journey may not have been planned — non-fatal
    }

    // ── Config constants snapshot ──
    const configSnapshot = {
      BPM,
      PPQ,
      TUNING_FREQ,
      totalSections: V.optionalFinite(totalSections, 0),
      SECTIONS: { min: SECTIONS.min, max: SECTIONS.max },
      PHRASES_PER_SECTION: { min: PHRASES_PER_SECTION.min, max: PHRASES_PER_SECTION.max },
      BINAURAL: { min: BINAURAL.min, max: BINAURAL.max },
      activeProfile
    };

    // ── Trust payoffs snapshot ──
    const trustPayoffs = MAIN_LOOP_CONTROLS.trustPayoffs;

    // ── Adaptive trust scores (end-of-run state) ──
    let trustSnapshot = {};
    try {
      trustSnapshot = AdaptiveTrustScores.getSnapshot();
    } catch {
      // Non-fatal
    }

    return {
      timestamp: new Date().toISOString(),
      config: configSnapshot,
      journey: journeyPlan,
      registries: {
        conductorIntelligence: {
          moduleCount: registryManifest.conductorIntelligence.moduleCount,
          moduleNames: registryManifest.conductorIntelligence.moduleNames,
          contributions: registryManifest.conductorIntelligence.counts,
          contributorNames: ConductorIntelligence.getContributorNames(),
          unregisteredContributors: _computeUnregisteredContributors(registryManifest)
        },
        crossLayer: {
          moduleCount: registryManifest.crossLayer.moduleCount,
          moduleNames: registryManifest.crossLayer.moduleNames
        }
      },
      signals: {
        densityProduct: signalSnapshot.densityProduct,
        tensionProduct: signalSnapshot.tensionProduct,
        flickerProduct: signalSnapshot.flickerProduct
      },
      signalHealth: _buildSignalHealth(),
      systemDynamics: _buildSystemDynamics(),
      trustPayoffs,
      trustScoresEndOfRun: trustSnapshot
    };
  }

  /**
   * Compute contributor names that provide signal but lack lifecycle registration.
   * @param {{ conductorIntelligence: { moduleNames: string[] }, crossLayer: { moduleNames: string[] } }} registryManifest
   * @returns {string[]}
   */
  function _computeUnregisteredContributors(registryManifest) {
    const lifecycleSet = new Set([
      ...registryManifest.conductorIntelligence.moduleNames,
      ...registryManifest.crossLayer.moduleNames
    ]);
    return ConductorIntelligence.getContributorNames()
      .filter(name => !lifecycleSet.has(name));
  }

  /** @returns {object} */
  function _buildSignalHealth() {
    try {
      return SignalHealthAnalyzer.getSummary();
    } catch {
      return { beatsAnalyzed: 0, pinnedRate: {}, saturationRate: {}, lastHealth: {} };
    }
  }

  /** @returns {object} */
  function _buildSystemDynamics() {
    try {
      return SystemDynamicsProfiler.getSummary();
    } catch {
      return { beatsAnalyzed: 0, snapshot: {}, dimensionNames: [] };
    }
  }

  return { emit };
})();
