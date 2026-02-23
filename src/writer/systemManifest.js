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
    const manifestPath = 'output/system-manifest.json';
    const matrixPath = 'output/capability-matrix.md';

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Wrote file: ${manifestPath}`);

    const matrix = _buildCapabilityMatrix(manifest);
    fs.writeFileSync(matrixPath, matrix, 'utf8');
    console.log(`Wrote file: ${matrixPath}`);
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
      trustPayoffs,
      trustScoresEndOfRun: trustSnapshot
    };
  }

  /**
   * Build a Markdown capability matrix from the manifest data.
   * Lists every registered module, its registry, and contribution types.
   * @param {object} manifest
   * @returns {string}
   */
  function _buildCapabilityMatrix(manifest) {
    const lines = [];
    lines.push('# Module Capability Matrix');
    lines.push('');
    lines.push('> Auto-generated per run by `systemManifest.js`. Do not edit by hand.');
    lines.push(`> Generated: ${manifest.timestamp}`);
    lines.push('');

    // ── Conductor Intelligence Modules ──
    lines.push('## Conductor Intelligence Modules');
    lines.push('');
    lines.push(`Total lifecycle-registered: **${manifest.registries.conductorIntelligence.moduleCount}** | Total signal contributors: **${manifest.registries.conductorIntelligence.contributorNames.length}**`);
    lines.push('');
    lines.push('Contribution counts:');
    const counts = manifest.registries.conductorIntelligence.contributions;
    lines.push(`- Density biases: ${counts.density}`);
    lines.push(`- Tension biases: ${counts.tension}`);
    lines.push(`- Flicker modifiers: ${counts.flicker}`);
    lines.push(`- Recorders: ${counts.recorders}`);
    lines.push(`- State providers: ${counts.stateProviders}`);
    lines.push('');

    // Attribution tables for density/tension/flicker
    _appendAttributionTable(lines, 'Density Bias', ConductorIntelligence.collectDensityBiasWithAttribution());
    _appendAttributionTable(lines, 'Tension Bias', ConductorIntelligence.collectTensionBiasWithAttribution());
    _appendAttributionTable(lines, 'Flicker Modifier', ConductorIntelligence.collectFlickerModifierWithAttribution());

    // Module listing
    lines.push('### Lifecycle-Registered Module Names');
    lines.push('');
    lines.push('| # | Module Name |');
    lines.push('|---|---|');
    manifest.registries.conductorIntelligence.moduleNames.forEach((name, i) => {
      lines.push(`| ${i + 1} | ${name} |`);
    });
    lines.push('');

    // ── Unregistered Contributors ──
    const unreg = manifest.registries.conductorIntelligence.unregisteredContributors;
    if (unreg.length > 0) {
      lines.push('### Signal Contributors Without Lifecycle Registration');
      lines.push('');
      lines.push('> These modules provide density/tension/flicker/recorder/stateProvider contributions');
      lines.push('> but are stateless or beatCache-only — no section reset needed.');
      lines.push('');
      lines.push('| # | Module Name |');
      lines.push('|---|---|');
      unreg.forEach((name, i) => {
        lines.push(`| ${i + 1} | ${name} |`);
      });
      lines.push('');
    }

    // ── Cross-Layer Modules ──
    lines.push('## Cross-Layer Modules');
    lines.push('');
    lines.push(`Total registered: **${manifest.registries.crossLayer.moduleCount}**`);
    lines.push('');
    lines.push('| # | Module Name |');
    lines.push('|---|---|');
    manifest.registries.crossLayer.moduleNames.forEach((name, i) => {
      lines.push(`| ${i + 1} | ${name} |`);
    });
    lines.push('');

    // ── Harmonic Journey ──
    if (manifest.journey.length > 0) {
      lines.push('## Harmonic Journey');
      lines.push('');
      lines.push('| Section | Key | Mode | Move | Distance |');
      lines.push('|---|---|---|---|---|');
      manifest.journey.forEach(stop => {
        lines.push(`| ${stop.section} | ${stop.key} | ${stop.mode} | ${stop.move} | ${stop.distance} |`);
      });
      lines.push('');
    }

    // ── Trust Scores (End of Run) ──
    const trustEntries = Object.entries(manifest.trustScoresEndOfRun);
    if (trustEntries.length > 0) {
      lines.push('## Trust Scores (End of Run)');
      lines.push('');
      lines.push('| System | Score | Weight | Samples |');
      lines.push('|---|---|---|---|');
      trustEntries.forEach(([name, data]) => {
        if (data && typeof data === 'object') {
          const score = typeof data.score === 'number' ? data.score.toFixed(3) : '?';
          const weight = typeof data.weight === 'number' ? data.weight.toFixed(3) : '?';
          const samples = typeof data.samples === 'number' ? data.samples : '?';
          lines.push(`| ${name} | ${score} | ${weight} | ${samples} |`);
        }
      });
      lines.push('');
    }

    // ── Config Summary ──
    lines.push('## Config Summary');
    lines.push('');
    lines.push(`- BPM: ${manifest.config.BPM}`);
    lines.push(`- PPQ: ${manifest.config.PPQ}`);
    lines.push(`- Tuning: ${manifest.config.TUNING_FREQ} Hz`);
    lines.push(`- Total Sections: ${manifest.config.totalSections}`);
    lines.push(`- Active Profile: ${manifest.config.activeProfile}`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Compute contributor names that provide signal but lack lifecycle registration.
   * These are legitimately stateless/cached modules — no reset needed — but
   * surfacing them makes the matrix a diagnostic tool, not just a census.
   * @param {{ conductorIntelligence: { moduleNames: string[] } }} registryManifest
   * @returns {string[]}
   */
  function _computeUnregisteredContributors(registryManifest) {
    const lifecycleSet = new Set(registryManifest.conductorIntelligence.moduleNames);
    return ConductorIntelligence.getContributorNames()
      .filter(name => !lifecycleSet.has(name));
  }

  /**
   * Append an attribution table to the lines array.
   * @param {string[]} lines
   * @param {string} title
   * @param {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} attr
   */
  function _appendAttributionTable(lines, title, attr) {
    lines.push(`### ${title} Attribution (end-of-run snapshot)`);
    lines.push('');
    lines.push(`Product: **${attr.product.toFixed(4)}**`);
    lines.push('');
    if (attr.contributions.length > 0) {
      lines.push('| Module | Raw | Clamped |');
      lines.push('|---|---|---|');
      attr.contributions.forEach(c => {
        lines.push(`| ${c.name} | ${c.raw.toFixed(4)} | ${c.clamped.toFixed(4)} |`);
      });
    }
    lines.push('');
  }

  return { emit };
})();
