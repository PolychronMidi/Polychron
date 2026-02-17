// MotifManager.js - single manager hub for motif subsystem
// Orchestrates hierarchical motif planning: measure → beat → div → subdiv → subsubdiv.
// Coordinates motifConfig, IntervalComposer, MotifSpreader, MotifChain, and
// motifModulator to produce coherent, parent-derived motif content at every level.

MotifManager = (function() {
  const registry = MotifRegistry;
  const values = MotifValues;
  const mod = motifModulator;
  const config = motifConfig;

  // --- Registry / value proxy helpers (existing API) -----------------------

  function listGenerators() { return registry.list(); }
  function getGenerator(name) { return registry.get(name); }

  function generate(name, ...args) {
    if (!name) throw new Error('MotifManager.generate: name required');
    const gen = registry.get(name);
    return gen(...args);
  }

  function applyToNotes(notes, motifPattern, profileName, options = {}) {
    const profile = profileName ? config.getProfile(profileName) : {};
    const opts = Object.assign({}, profile, options);
    return mod.apply(notes, motifPattern, opts);
  }

  function repeatPattern(pattern, times) { return values.repeatPattern(pattern, times); }
  function offsetPattern(pattern, offsetSteps) { return values.offsetPattern(pattern, offsetSteps); }
  function scaleDurations(pattern, scale) { return values.scaleDurations(pattern, scale); }

  // --- Hierarchical planning API (new) -------------------------------------

  /**
   * Plan the full measure-level hierarchy (measure + beat motifs).
   * Call once per measure from setUnitTiming('measure').
   */
  function planMeasure(layer, composer) {
    if (!layer) throw new Error('MotifManager.planMeasure: no layer');
    if (!composer) throw new Error('MotifManager.planMeasure: no composer');
    const profile = config.getUnitProfile('measure');
    MotifSpreader.spreadMeasure({ layer, beats: Number(numerator), composer, profile });
  }

  /**
   * Invalidate a child unit's VoiceManager so it re-seeds from parent on next use.
   * Called at parent boundaries to ensure child voice-leading stays coherent.
   */
  function _resetChildVM(layer, childUnit) {
    if (layer._voiceManagers && layer._voiceManagers[childUnit]) {
      delete layer._voiceManagers[childUnit];
    }
  }

  /**
   * Plan div-level motifs for the current measure.
   * Derives from beat motifs when available, delegating to MotifSpreader.spreadDivs.
   * Call once per beat-cycle from setUnitTiming('beat').
   */
  function planDivs(layer, dpb, beats, composer) {
    const absBeat = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
    const parentBucket = (layer.beatMotifs && Array.isArray(layer.beatMotifs[absBeat]))
      ? layer.beatMotifs[absBeat] : null;
    // Reset child VM so it re-seeds from beat-level history
    _resetChildVM(layer, 'div');
    MotifSpreader.spreadDivs({ layer, divsPerBeat: dpb, beats, composer, parentBucket });
  }

  /**
   * Plan subdiv-level motifs for the current div.
   * Derives from divMotifs bucket at the absolute div index.
   * Call from setUnitTiming('div').
   */
  function planSubdivs(layer, absDivIdx, sPerDiv) {
    if (!Number.isFinite(Number(sPerDiv)) || Number(sPerDiv) <= 0) return;
    _resetChildVM(layer, 'subdiv');
    const profile = config.getUnitProfile('subdiv');
    MotifSpreader.spreadSubunits({ layer, unit: 'subdiv', parentIndex: absDivIdx, count: Number(sPerDiv), bucketKey: 'subdivMotifs', parentBucketKey: 'divMotifs', profile });
  }

  /**
   * Plan subsubdiv-level motifs for the current subdiv.
   * Derives from subdivMotifs bucket at the absolute subdiv index.
   * Call from setUnitTiming('subdiv').
   */
  function planSubsubdivs(layer, absSubdivIdx, ssPerSub) {
    if (!Number.isFinite(Number(ssPerSub)) || Number(ssPerSub) <= 0) return;
    _resetChildVM(layer, 'subsubdiv');
    const profile = config.getUnitProfile('subsubdiv');
    MotifSpreader.spreadSubunits({ layer, unit: 'subsubdiv', parentIndex: absSubdivIdx, count: Number(ssPerSub), bucketKey: 'subsubdivMotifs', parentBucketKey: 'subdivMotifs', profile });
  }

  return {
    listGenerators, getGenerator, generate, applyToNotes,
    repeatPattern, offsetPattern, scaleDurations,
    planMeasure, planDivs, planSubdivs, planSubsubdivs
  };
})();
