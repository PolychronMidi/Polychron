// EventCatalog.js - central event names + lightweight payload validation.

EventCatalog = (() => {
  if (typeof Validator === 'undefined' || !Validator) {
    throw new Error('EventCatalog: Validator utility is required');
  }

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
    Validator.assertObject(data, `${name} payload`);
    switch (name) {
      case names.SECTION_BOUNDARY:
        Validator.assertFinite(data.sectionIndex, 'section-boundary.sectionIndex');
        return true;

      case names.JOURNEY_MOVE:
        Validator.assertNonEmptyString(data.move, 'journey-move.move');
        Validator.assertFinite(data.distance, 'journey-move.distance');
        return true;

      case names.TEXTURE_CONTRAST:
        Validator.assertNonEmptyString(data.mode, 'texture-contrast.mode');
        Validator.assertFinite(data.composite, 'texture-contrast.composite');
        return true;

      case names.BEAT_FX_APPLIED:
        Validator.assertFinite(data.stereoPan, 'beat-fx-applied.stereoPan');
        Validator.assertFinite(data.velocityShift, 'beat-fx-applied.velocityShift');
        return true;

      case names.STUTTER_APPLIED:
        Validator.assertFinite(data.intensity, 'stutter-applied.intensity');
        return true;

      case names.CONDUCTOR_REGULATION:
        Validator.assertFinite(data.avg, 'conductor-regulation.avg');
        Validator.assertFinite(data.densityBias, 'conductor-regulation.densityBias');
        Validator.assertFinite(data.crossModBias, 'conductor-regulation.crossModBias');
        return true;

      case names.BEAT_BINAURAL_APPLIED:
        Validator.assertFinite(data.beatIndex, 'beat-binaural-applied.beatIndex');
        return true;

      case names.HARMONIC_CHANGE:
        Validator.assertArray(data.changedFields, 'harmonic-change.changedFields');
        return true;

      case names.NOTES_EMITTED:
        Validator.assertFinite(data.actual, 'notes-emitted.actual');
        Validator.assertFinite(data.intended, 'notes-emitted.intended');
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
