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
    NOTES_EMITTED: 'notes-emitted'
  });

  function assertEventPayload(name, data) {
    V.assertObject(data, `${name} payload`);
    switch (name) {
      case names.SECTION_BOUNDARY:
        V.assertFinite(data.sectionIndex, 'section-boundary.sectionIndex');
        return true;

      case names.JOURNEY_MOVE:
        V.assertNonEmptyString(data.move, 'journey-move.move');
        V.assertFinite(data.distance, 'journey-move.distance');
        return true;

      case names.TEXTURE_CONTRAST:
        V.assertNonEmptyString(data.mode, 'texture-contrast.mode');
        V.assertFinite(data.composite, 'texture-contrast.composite');
        return true;

      case names.BEAT_FX_APPLIED:
        V.assertFinite(data.stereoPan, 'beat-fx-applied.stereoPan');
        V.assertFinite(data.velocityShift, 'beat-fx-applied.velocityShift');
        return true;

      case names.STUTTER_APPLIED:
        V.assertFinite(data.intensity, 'stutter-applied.intensity');
        return true;

      case names.CONDUCTOR_REGULATION:
        V.assertFinite(data.avg, 'conductor-regulation.avg');
        V.assertFinite(data.densityBias, 'conductor-regulation.densityBias');
        V.assertFinite(data.crossModBias, 'conductor-regulation.crossModBias');
        return true;

      case names.BEAT_BINAURAL_APPLIED:
        V.assertFinite(data.beatIndex, 'beat-binaural-applied.beatIndex');
        return true;

      case names.HARMONIC_CHANGE:
        V.assertArray(data.changedFields, 'harmonic-change.changedFields');
        return true;

      case names.NOTES_EMITTED:
        V.assertFinite(data.actual, 'notes-emitted.actual');
        V.assertFinite(data.intended, 'notes-emitted.intended');
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
