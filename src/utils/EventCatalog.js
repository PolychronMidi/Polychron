// EventCatalog.js - central event names + lightweight payload validation.

EventCatalog = (() => {
  const V = Validator.create('EventCatalog');

  const names = Object.freeze({
    SECTION_BOUNDARY: 'section-boundary',
    JOURNEY_MOVE: 'journey-move',
    TEXTURE_CONTRAST: 'texture-contrast',
    BEAT_FX_APPLIED: 'beat-fx-applied',
    STUTTER_APPLIED: 'stutter-applied',
    CONDUCTOR_REGULATION: 'conductor-regulation',
    BEAT_BINAURAL_APPLIED: 'beat-binaural-applied',
    HARMONIC_CHANGE: 'harmonic-change',
    NOTES_EMITTED: 'notes-emitted',
    MOTIF_CHAIN_APPLIED: 'motif-chain-applied',
    CROSS_LAYER_EXPLAIN: 'cross-layer-explain',
    CONVERGENCE_HARMONIC_TRIGGER: 'convergence-harmonic-trigger',
    CROSS_LAYER_CONVERGENCE: 'cross-layer-convergence',
    CROSS_LAYER_CADENCE_ALIGN: 'cross-layer-cadence-align',
    PHRASE_BOUNDARY: 'phrase-boundary',
    MEASURE_BOUNDARY: 'measure-boundary'
  });

  function assertEventPayload(name, data) {
    V.assertObject(data, `${name} payload`);
    switch (name) {
      case names.SECTION_BOUNDARY:
        V.assertRange(data.sectionIndex, 0, Number.MAX_SAFE_INTEGER, 'section-boundary.sectionIndex');
        return true;

      case names.JOURNEY_MOVE:
        V.assertNonEmptyString(data.move, 'journey-move.move');
        V.assertFinite(data.distance, 'journey-move.distance');
        V.assertNonEmptyString(data.key, 'journey-move.key');
        V.assertNonEmptyString(data.mode, 'journey-move.mode');
        V.assertFinite(data.sectionIndex, 'journey-move.sectionIndex');
        return true;

      case names.TEXTURE_CONTRAST:
        V.assertNonEmptyString(data.mode, 'texture-contrast.mode');
        V.assertNonEmptyString(data.unit, 'texture-contrast.unit');
        V.assertFinite(data.composite, 'texture-contrast.composite');
        return true;

      case names.BEAT_FX_APPLIED:
        V.assertRange(data.beatIndex, 0, Number.MAX_SAFE_INTEGER, 'beat-fx-applied.beatIndex');
        V.assertRange(data.sectionIndex, 0, Number.MAX_SAFE_INTEGER, 'beat-fx-applied.sectionIndex');
        V.assertRange(data.phraseIndex, 0, Number.MAX_SAFE_INTEGER, 'beat-fx-applied.phraseIndex');
        V.assertRange(data.measureIndex, 0, Number.MAX_SAFE_INTEGER, 'beat-fx-applied.measureIndex');
        V.assertNonEmptyString(data.layer, 'beat-fx-applied.layer');
        V.assertFinite(data.stereoPan, 'beat-fx-applied.stereoPan');
        V.assertFinite(data.velocityShift, 'beat-fx-applied.velocityShift');
        return true;

      case names.STUTTER_APPLIED:
        V.assertNonEmptyString(data.type, 'stutter-applied.type');
        V.assertNonEmptyString(data.profile, 'stutter-applied.profile');
        V.assertFinite(data.channel, 'stutter-applied.channel');
        V.assertRange(data.intensity, 0, 1, 'stutter-applied.intensity');
        V.assertRange(data.tick, 0, Number.MAX_SAFE_INTEGER, 'stutter-applied.tick');
        if (data.subtype !== undefined) {
          V.assertNonEmptyString(data.subtype, 'stutter-applied.subtype');
        }
        return true;

      case names.CONDUCTOR_REGULATION:
        V.assertFinite(data.avg, 'conductor-regulation.avg');
        V.assertFinite(data.densityBias, 'conductor-regulation.densityBias');
        V.assertFinite(data.crossModBias, 'conductor-regulation.crossModBias');
        V.assertNonEmptyString(data.profile, 'conductor-regulation.profile');
        return true;

      case names.BEAT_BINAURAL_APPLIED:
        V.assertFinite(data.beatIndex, 'beat-binaural-applied.beatIndex');
        V.assertRange(data.freqOffset, -50, 50, 'beat-binaural-applied.freqOffset');
        V.assertBoolean(data.flipBin, 'beat-binaural-applied.flipBin');
        return true;

      case names.HARMONIC_CHANGE:
        V.assertArray(data.changedFields, 'harmonic-change.changedFields');
        V.assertNonEmptyString(data.key, 'harmonic-change.key');
        V.assertNonEmptyString(data.mode, 'harmonic-change.mode');
        V.assertNonEmptyString(data.quality, 'harmonic-change.quality');
        V.assertNonEmptyString(data.sectionPhase, 'harmonic-change.sectionPhase');
        V.assertFinite(data.excursion, 'harmonic-change.excursion');
        V.assertFinite(data.tension, 'harmonic-change.tension');
        V.assertFinite(data.mutationCount, 'harmonic-change.mutationCount');
        V.assertFinite(data.tick, 'harmonic-change.tick');
        V.assertFinite(data.timestamp, 'harmonic-change.timestamp');
        if (data.scale !== undefined) {
          V.assertArray(data.scale, 'harmonic-change.scale');
        }
        if (data.chords !== undefined) {
          V.assertArray(data.chords, 'harmonic-change.chords');
        }
        return true;

      case names.NOTES_EMITTED:
        V.assertRange(data.actual, 0, Number.MAX_SAFE_INTEGER, 'notes-emitted.actual');
        V.assertRange(data.intended, 0, Number.MAX_SAFE_INTEGER, 'notes-emitted.intended');
        if (data.noteCount !== undefined) {
          V.assertRange(data.noteCount, 0, Number.MAX_SAFE_INTEGER, 'notes-emitted.noteCount');
        }
        return true;

      case names.MOTIF_CHAIN_APPLIED:
        V.assertFinite(data.transformCount, 'motif-chain-applied.transformCount');
        V.assertFinite(data.resultNoteCount, 'motif-chain-applied.resultNoteCount');
        return true;

      case names.CROSS_LAYER_EXPLAIN:
        V.assertNonEmptyString(data.type, 'cross-layer-explain.type');
        V.assertNonEmptyString(data.layer, 'cross-layer-explain.layer');
        V.assertFinite(data.absTimeMs, 'cross-layer-explain.absTimeMs');
        return true;

      case names.CONVERGENCE_HARMONIC_TRIGGER:
        V.assertNonEmptyString(data.type, 'convergence-harmonic-trigger.type');
        V.assertFinite(data.bias, 'convergence-harmonic-trigger.bias');
        V.assertRange(data.rarity, 0, 1, 'convergence-harmonic-trigger.rarity');
        V.assertRange(data.triggerCount, 0, Number.MAX_SAFE_INTEGER, 'convergence-harmonic-trigger.triggerCount');
        V.assertFinite(data.absTimeMs, 'convergence-harmonic-trigger.absTimeMs');
        return true;

      case names.CROSS_LAYER_CONVERGENCE:
        V.assertNonEmptyString(data.layer, 'cross-layer-convergence.layer');
        V.assertRange(data.rarity, 0, 1, 'cross-layer-convergence.rarity');
        V.assertRange(data.syncTick, 0, Number.MAX_SAFE_INTEGER, 'cross-layer-convergence.syncTick');
        V.assertFinite(data.noteA, 'cross-layer-convergence.noteA');
        V.assertFinite(data.noteB, 'cross-layer-convergence.noteB');
        V.assertFinite(data.velocityA, 'cross-layer-convergence.velocityA');
        V.assertFinite(data.velocityB, 'cross-layer-convergence.velocityB');
        V.assertArray(data.burstNotes, 'cross-layer-convergence.burstNotes');
        V.assertFinite(data.burstVel, 'cross-layer-convergence.burstVel');
        V.assertRange(data.totalConvergences, 0, Number.MAX_SAFE_INTEGER, 'cross-layer-convergence.totalConvergences');
        V.assertFinite(data.absTimeMs, 'cross-layer-convergence.absTimeMs');
        return true;

      case names.CROSS_LAYER_CADENCE_ALIGN:
        V.assertNonEmptyString(data.layer, 'cross-layer-cadence-align.layer');
        V.assertRange(data.combinedTension, 0, 1, 'cross-layer-cadence-align.combinedTension');
        V.assertRange(data.syncTick, 0, Number.MAX_SAFE_INTEGER, 'cross-layer-cadence-align.syncTick');
        V.assertBoolean(data.otherCadenceSuggested, 'cross-layer-cadence-align.otherCadenceSuggested');
        V.assertFinite(data.absTimeMs, 'cross-layer-cadence-align.absTimeMs');
        return true;

      case names.PHRASE_BOUNDARY:
        V.assertRange(data.phraseIndex, 0, Number.MAX_SAFE_INTEGER, 'phrase-boundary.phraseIndex');
        V.assertRange(data.sectionIndex, 0, Number.MAX_SAFE_INTEGER, 'phrase-boundary.sectionIndex');
        V.assertRange(data.phrasesPerSection, 1, Number.MAX_SAFE_INTEGER, 'phrase-boundary.phrasesPerSection');
        return true;

      case names.MEASURE_BOUNDARY:
        V.assertRange(data.measureIndex, 0, Number.MAX_SAFE_INTEGER, 'measure-boundary.measureIndex');
        V.assertRange(data.measuresPerPhrase, 1, Number.MAX_SAFE_INTEGER, 'measure-boundary.measuresPerPhrase');
        V.assertNonEmptyString(data.layer, 'measure-boundary.layer');
        return true;

      default:
        throw new Error(`EventCatalog.assertEventPayload: unknown event name "${name}"`);
    }
  }

  function validateEmit(name, data) {
    return assertEventPayload(name, data);
  }

  return {
    names,
    assertEventPayload,
    validateEmit
  };
})();
