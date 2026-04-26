// systemManifest.js - Emit system-manifest.json and capability-matrix.md after composition.
// Captures the organism's configuration and module topology for each run,
// enabling compositional forensics and newcomer onboarding.

moduleLifecycle.declare({
  name: 'systemManifest',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'signalReader', 'systemDynamicsProfiler', 'validator'],
  lazyDeps: ['adaptiveTrustScores', 'coherenceVerdicts', 'conductorConfig', 'conductorState', 'harmonicJourney', 'mainBootstrap', 'pipelineNormalizer', 'signalHealthAnalyzer', 'systemManifestMarkdown'],
  provides: ['systemManifest'],
  init: (deps) => {
  const systemDynamicsProfiler = deps.systemDynamicsProfiler;
  const signalReader = deps.signalReader;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('systemManifest');

  /**
   * Write system-manifest.json and capability-matrix.md to metrics/.
   * Call after grandFinale() - all registries are fully populated at this point.
   */
  function emit() {
    const manifest = systemManifestBuildManifest();

    // -- Attribution (live call - not cached in manifest) --
    const attribution = {
      density: conductorIntelligence.collectDensityBiasWithAttribution(),
      tension: conductorIntelligence.collectTensionBiasWithAttribution(),
      flicker: conductorIntelligence.collectFlickerModifierWithAttribution()
    };

    // Extra-pipeline density multipliers (outside the registry product).
    // Captured from conductorState so the manifest reveals the full picture.
    const extraDensityMultipliers = {
      emissionCorrection: conductorState.get('extraDensityCorrection'),
      coherenceDensityBias: conductorState.get('extraCoherenceDensityBias')
    };

    manifest.attribution = {
      density: Object.assign(systemManifestSerializeAttribution(attribution.density), { extraMultipliers: extraDensityMultipliers }),
      tension: systemManifestSerializeAttribution(attribution.tension),
      flicker: systemManifestSerializeAttribution(attribution.flicker)
    };

    // -- Coherence verdicts --
    manifest.coherenceVerdicts = coherenceVerdicts.compute(manifest, attribution);

const manifestPath = path.join(METRICS_DIR, 'system-manifest.json');
  const matrixPath = path.join(METRICS_DIR, 'capability-matrix.md');

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
  function systemManifestSerializeAttribution(attr) {
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
  function systemManifestBuildManifest() {
    // -- Registry topology --
    const registryManifest = mainBootstrap.getRegistryManifest();

    // -- Conductor signal snapshot --
    // Firewall: use signalReader API instead of conductorIntelligence directly.
    const signalSnapshot = signalReader.snapshot();

    // -- Active conductor profile --
    const activeProfile = conductorConfig.getActiveProfileName();

    // -- Harmonic journey plan --
    const journeyPlan = harmonicJourney.getPlan().map((stop, i) => ({
      section: i,
      key: stop.key,
      mode: stop.mode,
      move: stop.move,
      distance: stop.distance
    }));

    // -- Config constants snapshot --
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

    // -- Trust payoffs snapshot --
    const trustPayoffs = MAIN_LOOP_CONTROLS.trustPayoffs;

    // -- Adaptive trust scores (end-of-run state) --
    const trustSnapshot = adaptiveTrustScores.getSnapshot();

    // -- Trust journal (significant trust changes across the run) --
    const trustJournal = adaptiveTrustScores.getJournal();

    return {
      timestamp: new Date().toISOString(),
      config: configSnapshot,
      journey: journeyPlan,
      registries: {
        conductorIntelligence: {
          moduleCount: registryManifest.conductorIntelligence.moduleCount,
          moduleNames: registryManifest.conductorIntelligence.moduleNames,
          contributions: registryManifest.conductorIntelligence.counts,
          contributorNames: conductorIntelligence.getContributorNames(),
          unregisteredContributors: systemManifestComputeUnregisteredContributors(registryManifest)
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
      signalHealth: systemManifestBuildSignalHealth(),
      pipelineNormalizer: systemManifestBuildPipelineNormalizer(),
      systemDynamics: systemManifestBuildSystemDynamics(),
      trustPayoffs,
      trustScoresEndOfRun: trustSnapshot,
      trustJournal
    };
  }

  /**
   * Compute contributor names that provide signal but lack lifecycle registration.
   * @param {{ conductorIntelligence: { moduleNames: string[] }, crossLayer: { moduleNames: string[] } }} registryManifest
   * @returns {string[]}
   */
  function systemManifestComputeUnregisteredContributors(registryManifest) {
    const lifecycleSet = new Set([
      ...registryManifest.conductorIntelligence.moduleNames,
      ...registryManifest.crossLayer.moduleNames
    ]);
    return conductorIntelligence.getContributorNames()
      .filter(name => !lifecycleSet.has(name));
  }

  /** @returns {object} */
  function systemManifestBuildSignalHealth() {
    return /** @type {object} */ (signalHealthAnalyzer.getSummary());
  }

  /** @returns {object} */
  function systemManifestBuildPipelineNormalizer() {
    return /** @type {object} */ (pipelineNormalizer.getSnapshot());
  }

  /** @returns {object} */
  function systemManifestBuildSystemDynamics() {
    return /** @type {object} */ (systemDynamicsProfiler.getSummary());
  }

  return { emit };
  },
});
