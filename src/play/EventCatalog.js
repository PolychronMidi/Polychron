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
    MOTIF_CHAIN_APPLIED: 'motif-chain-applied'
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

      default:
        return true;
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
