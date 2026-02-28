// src/play/layerPass.js - Extracted layer pass loop for main.js

layerPass = (() => {
  const V = validator.create('layerPass');

  const selectLayerComposerForMeasure = (layerName, phraseFamily, composerCtx) => {
    V.assertNonEmptyString(layerName, 'layerName');
    V.assertNonEmptyString(phraseFamily, 'phraseFamily');
    const peerLayerName = layerName === 'L1' ? 'L2' : (layerName === 'L2' ? 'L1' : null);
    const previousComposer = (LM.layerComposers && LM.layerComposers[layerName] && V.optionalType(LM.layerComposers[layerName], 'object'))
      ? LM.layerComposers[layerName]
      : null;
    const peerComposer = (peerLayerName && LM.layerComposers && LM.layerComposers[peerLayerName] && V.optionalType(LM.layerComposers[peerLayerName], 'object'))
      ? LM.layerComposers[peerLayerName]
      : null;

    const nextComposer = FactoryManager.createRandomForLayer({
      familyName: phraseFamily,
      layerName,
      previousComposer,
      peerComposer,
      extraConfig: { root: 'random' }
    }, composerCtx);

    LM.setComposerFor(layerName, nextComposer);

    // Record composer family for texturalMemoryAdvisor variety tracking
    texturalMemoryAdvisor.recordUsage(phraseFamily, mainBootstrap.requireFiniteNumber('sectionIndex', sectionIndex));

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
    timeStream.setBounds('measure', measuresPerPhrase);

    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      timeStream.setPosition('measure', measureIndex);
      // No active listeners - emitted for eventCatalog completeness and future extensibility
      eventBus.emit(eventCatalog.names.MEASURE_BOUNDARY, { measureIndex, measuresPerPhrase, layer: layerId });
      measureCount++;
      selectLayerComposerForMeasure(layerId, phraseFamily, composerCtx);
      setUnitTiming('measure');

      if (withConductorTick) {
        // Advance conductor crossfade and self-regulation once per measure
        conductorConfig.tickCrossfade();
        conductorConfig.regulationTick();
      }

      let playProb, stutterProb;
      timeStream.setBounds('beat', numerator);
      const _mT = Date.now();

      // Conductor update is expensive (~147 function calls). The EMA smoothing
      // on density/tension/flicker means beat-to-beat resolution adds minimal
      // information. Compute once per measure on beat 0 and reuse for the rest.
      // Cross-layer modules in processBeat still modulate probabilities per beat.
      let measureConductorCtx = null;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        timeStream.setPosition('beat', beatIndex);
        if (!measureConductorCtx) {
          measureConductorCtx = mainBootstrap.getConductorProbabilities();
        }
        playProb = measureConductorCtx.playProb;
        stutterProb = measureConductorCtx.stutterProb;

        const beatResult = processBeat(layerId, playProb, stutterProb, boot);
        playProb = beatResult.playProb;
        stutterProb = beatResult.stutterProb;

        timeStream.setBounds('div', divsPerBeat);
        microUnitAttenuator.begin('div', divsPerBeat);
        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          timeStream.setPosition('div', divIndex);
          setUnitTiming('div');
          if (divIndex > 0) { playNotes('div', { playProb, stutterProb }); }
          timeStream.setBounds('subdiv', subdivsPerDiv);
          microUnitAttenuator.begin('subdiv', subdivsPerDiv);
          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            timeStream.setPosition('subdiv', subdivIndex);
            setUnitTiming('subdiv');
            if (subdivIndex > 0) { playNotes('subdiv', { playProb, stutterProb }); }
            timeStream.setBounds('subsubdiv', subsubsPerSub);
            microUnitAttenuator.begin('subsubdiv', subsubsPerSub);
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              timeStream.setPosition('subsubdiv', subsubdivIndex);
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
            microUnitAttenuator.flush();
          }
          microUnitAttenuator.flush();
        }
        microUnitAttenuator.flush();
      }
      process.stderr.write('[main]     M' + measureIndex + ' done (' + ((Date.now() - _mT) / 1000).toFixed(1) + 's)\n');
    }
  }

  return {
    runLayerPass,
    selectLayerComposerForMeasure
  };
})();
