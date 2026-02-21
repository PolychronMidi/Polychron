// src/play/layerPass.js - Extracted layer pass loop for main.js

layerPass = (() => {
  const selectLayerComposerForMeasure = (layerName, phraseFamily, composerCtx) => {
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new Error('main.selectLayerComposerForMeasure: layerName must be a non-empty string');
    }
    if (typeof phraseFamily !== 'string' || phraseFamily.length === 0) {
      throw new Error('main.selectLayerComposerForMeasure: phraseFamily must be a non-empty string');
    }
    const peerLayerName = layerName === 'L1' ? 'L2' : (layerName === 'L2' ? 'L1' : null);
    const previousComposer = (LM.layerComposers && LM.layerComposers[layerName] && typeof LM.layerComposers[layerName] === 'object')
      ? LM.layerComposers[layerName]
      : null;
    const peerComposer = (peerLayerName && LM.layerComposers && LM.layerComposers[peerLayerName] && typeof LM.layerComposers[peerLayerName] === 'object')
      ? LM.layerComposers[peerLayerName]
      : null;

    const nextComposer = ComposerFactory.createRandomForLayer({
      familyName: phraseFamily,
      layerName,
      previousComposer,
      peerComposer,
      extraConfig: { root: 'random' }
    }, composerCtx);

    LM.setComposerFor(layerName, nextComposer);

    // Record composer family for TexturalMemoryAdvisor variety tracking
    TexturalMemoryAdvisor.recordUsage(phraseFamily, MainBootstrap.requireFiniteNumber('sectionIndex', sectionIndex));

    return nextComposer;
  };

  /**
   * Run a full measure/beat/div/subdiv pass for a given layer.
   * @param {string} layerId
   * @param {string} phraseFamily
   * @param {Object} opts
   * @param {boolean} [opts.withConductorTick=false]
   * @param {Object} deps
   * @param {Object} deps.boot
   * @param {Object} deps.composerCtx
   */
  function runLayerPass(layerId, phraseFamily, { withConductorTick = false } = {}, deps) {
    const { boot, composerCtx } = deps;

    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      selectLayerComposerForMeasure(layerId, phraseFamily, composerCtx);
      setUnitTiming('measure');

      if (withConductorTick) {
        // Advance conductor crossfade and self-regulation once per measure
        ConductorConfig.tickCrossfade();
        ConductorConfig.regulationTick();
      }

      MainBootstrap.getConductorProbabilities(measureIndex, -1);
      let playProb, stutterProb;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        const beatCtx = MainBootstrap.getConductorProbabilities(measureIndex, beatIndex);
        playProb = beatCtx.playProb;
        stutterProb = beatCtx.stutterProb;

        const beatResult = processBeat(layerId, playProb, stutterProb, boot);
        playProb = beatResult.playProb;
        stutterProb = beatResult.stutterProb;

        microUnitAttenuator.begin('div', divsPerBeat);
        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('div');
          if (divIndex > 0) { playNotes('div', { playProb, stutterProb }); }
          microUnitAttenuator.begin('subdiv', subdivsPerDiv);
          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            if (subdivIndex > 0) { playNotes('subdiv', { playProb, stutterProb }); }
            microUnitAttenuator.begin('subsubdiv', subsubsPerSub);
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
            microUnitAttenuator.flush();
          }
          microUnitAttenuator.flush();
        }
        microUnitAttenuator.flush();
      }
    }
  }

  return {
    runLayerPass,
    selectLayerComposerForMeasure
  };
})();
