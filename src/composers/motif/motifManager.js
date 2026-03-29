// motifManager.js - single manager hub for motif subsystem
// Orchestrates hierarchical motif planning: measure - beat - div - subdiv - subsubdiv.
// Coordinates motifConfig, intervalComposer, motifSpreader, motifChain, and
// motifModulator to produce coherent, parent-derived motif content at every level.

class MotifManagerClass {
  // Registry / value proxy helpers (existing API) --

  static listGenerators() { return motifRegistry.list(); }
  static getGenerator(name) { return motifRegistry.get(name); }

  static generate(name, ...args) {
    if (!name) throw new Error('motifManager.generate: name required');
    const gen = motifRegistry.get(name);
    return gen(...args);
  }

  static applyToNotes(notes, motifPattern, profileName, options = {}) {
    const profile = profileName ? motifConfig.getProfile(profileName) : {};
    const opts = Object.assign({}, profile, options);
    return motifModulator.apply(notes, motifPattern, opts);
  }

  static repeatPattern(pattern, times) { return motifValues.repeatPattern(pattern, times); }
  static offsetPattern(pattern, offsetSteps) { return motifValues.offsetPattern(pattern, offsetSteps); }
  static scaleDurations(pattern, scale) { return motifValues.scaleDurations(pattern, scale); }

  // Hierarchical planning API (new) -

  /**
   * Plan the full measure-level hierarchy (measure + beat motifs).
   * Call once per measure from setUnitTiming('measure').
   */
  static planMeasure(layer, composer) {
    if (!layer) throw new Error('motifManager.planMeasure: no layer');
    if (!composer) throw new Error('motifManager.planMeasure: no composer');
    // -- Texture-guided motif variation (#10) --
    // Bursts - higher density (harmonic motifs), flurries - lower density (scalar)
    if (drumTextureCoupler) {
      const texMetrics = drumTextureCoupler.getMetrics();
      if (texMetrics.intensity > 0.2) {
        const clampParams = conductorConfig.getMotifTextureClampParams();
        const burstDom = texMetrics.burstCount > texMetrics.flurryCount;
        const burstDensityMin = clampParams.burstDensity[0];
        const burstDensityMax = clampParams.burstDensity[1];
        const sparseDensityMin = clampParams.sparseDensity[0];
        const sparseDensityMax = clampParams.sparseDensity[1];
        const burstIntervalMin = clampParams.burstIntervalDensity[0];
        const burstIntervalMax = clampParams.burstIntervalDensity[1];
        const sparseIntervalMin = clampParams.sparseIntervalDensity[0];
        const sparseIntervalMax = clampParams.sparseIntervalDensity[1];
        motifConfig.setUnitProfileOverride('measure', {
          density: burstDom
            ? clamp(burstDensityMin + texMetrics.intensity * (burstDensityMax - burstDensityMin), burstDensityMin, burstDensityMax)
            : clamp(sparseDensityMax - texMetrics.intensity * (sparseDensityMax - sparseDensityMin), sparseDensityMin, sparseDensityMax),
          intervalDensity: burstDom
            ? clamp(burstIntervalMin + texMetrics.intensity * (burstIntervalMax - burstIntervalMin), burstIntervalMin, burstIntervalMax)
            : clamp(sparseIntervalMax - texMetrics.intensity * (sparseIntervalMax - sparseIntervalMin), sparseIntervalMin, sparseIntervalMax)
        });
      }
    }
    const profile = motifConfig.getUnitProfile('measure');
    const sectionMotifSeed = currentSectionType && Array.isArray(SECTION_TYPES) ? (SECTION_TYPES.find(t => t.type === currentSectionType) || {}).motif : null;
    motifSpreader.spreadMeasure({ layer, beats: Number(numerator), composer, profile, sectionMotifSeed });
  }

  /**
   * Invalidate a child unit's VoiceManager so it re-seeds from parent on next use.
   * Called at parent boundaries to ensure child voice-leading stays coherent.
   */
  static motifManagerResetChildVM(layer, childUnit) {
    if (layer.motifManagerVoiceManagers && layer.motifManagerVoiceManagers[childUnit]) {
      delete layer.motifManagerVoiceManagers[childUnit];
    }
  }

  /**
   * Plan div-level motifs for the current measure.
   * Derives from beat motifs when available, delegating to motifSpreader.spreadDivs.
   * Call once per beat-cycle from setUnitTiming('beat').
   */
  static planDivs(layer, dpb, beats, composer) {
    const absBeat = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
    const parentBucket = (layer.beatMotifs && Array.isArray(layer.beatMotifs[absBeat]))
      ? layer.beatMotifs[absBeat] : null;
    // -- Texture-guided div motif variation (#10) --
    // During bursts: derive from parent (coherent harmonic content)
    // During flurries: weaken parent derivation (independent scalar motion)
    let effectiveParentBucket = parentBucket;
    if (drumTextureCoupler) {
      const texMetrics = drumTextureCoupler.getMetrics();
      if (texMetrics.intensity > 0.25 && texMetrics.flurryCount > texMetrics.burstCount && rf() < texMetrics.intensity * 0.6) {
        effectiveParentBucket = null;
      }
    }
    // Reset child VM so it re-seeds from beat-level history
    MotifManagerClass.motifManagerResetChildVM(layer, 'div');
    motifSpreader.spreadDivs({ layer, divsPerBeat: dpb, beats, composer, parentBucket: effectiveParentBucket });
  }

  /**
   * Plan subdiv-level motifs for the current div.
   * Derives from divMotifs bucket at the absolute div index.
   * Call from setUnitTiming('div').
   */
  static planSubdivs(layer, absDivIdx, sPerDiv) {
    if (!Number.isFinite(Number(sPerDiv)) || Number(sPerDiv) <= 0) throw new Error('motifManager: sPerDiv must be finite positive');
    MotifManagerClass.motifManagerResetChildVM(layer, 'subdiv');
    const profile = motifConfig.getUnitProfile('subdiv');
    motifSpreader.spreadSubunits({ layer, unit: 'subdiv', parentIndex: absDivIdx, count: Number(sPerDiv), bucketKey: 'subdivMotifs', parentBucketKey: 'divMotifs', profile });
  }

  /**
   * Plan subsubdiv-level motifs for the current subdiv.
   * Derives from subdivMotifs bucket at the absolute subdiv index.
   * Call from setUnitTiming('subdiv').
   */
  static planSubsubdivs(layer, absSubdivIdx, ssPerSub) {
    if (!Number.isFinite(Number(ssPerSub)) || Number(ssPerSub) <= 0) throw new Error('motifManager: ssPerSub must be finite positive');
    MotifManagerClass.motifManagerResetChildVM(layer, 'subsubdiv');
    const profile = motifConfig.getUnitProfile('subsubdiv');
    motifSpreader.spreadSubunits({ layer, unit: 'subsubdiv', parentIndex: absSubdivIdx, count: Number(ssPerSub), bucketKey: 'subsubdivMotifs', parentBucketKey: 'subdivMotifs', profile });
  }
}

// preserve legacy API surface required by MotifManagerAPI
MotifManagerClass._resetChildVM = MotifManagerClass.motifManagerResetChildVM;
motifManager = MotifManagerClass;
