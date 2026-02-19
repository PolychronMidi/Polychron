// EventCatalog.js - central event names + lightweight payload validation.

EventCatalog = (() => {
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

  function assertObject(data, eventName) {
    if (!data || typeof data !== 'object') {
      throw new Error(`EventCatalog.validateEmit: ${eventName} payload must be an object`);
    }
  }

  function validateEmit(name, data) {
    switch (name) {
      case names.SECTION_BOUNDARY:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.sectionIndex))) {
          throw new Error('EventCatalog.validateEmit: section-boundary.sectionIndex must be finite');
        }
        return true;

      case names.JOURNEY_MOVE:
        assertObject(data, name);
        if (typeof data.move !== 'string' || data.move.length === 0) {
          throw new Error('EventCatalog.validateEmit: journey-move.move must be a non-empty string');
        }
        if (!Number.isFinite(Number(data.distance))) {
          throw new Error('EventCatalog.validateEmit: journey-move.distance must be finite');
        }
        return true;

      case names.TEXTURE_CONTRAST:
        assertObject(data, name);
        if (typeof data.mode !== 'string' || data.mode.length === 0) {
          throw new Error('EventCatalog.validateEmit: texture-contrast.mode must be a non-empty string');
        }
        if (!Number.isFinite(Number(data.composite))) {
          throw new Error('EventCatalog.validateEmit: texture-contrast.composite must be finite');
        }
        return true;

      case names.BEAT_FX_APPLIED:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.stereoPan)) || !Number.isFinite(Number(data.velocityShift))) {
          throw new Error('EventCatalog.validateEmit: beat-fx-applied.stereoPan and velocityShift must be finite');
        }
        return true;

      case names.STUTTER_APPLIED:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.intensity))) {
          throw new Error('EventCatalog.validateEmit: stutter-applied.intensity must be finite');
        }
        return true;

      case names.CONDUCTOR_REGULATION:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.avg)) || !Number.isFinite(Number(data.densityBias)) || !Number.isFinite(Number(data.crossModBias))) {
          throw new Error('EventCatalog.validateEmit: conductor-regulation numeric fields must be finite');
        }
        return true;

      case names.BEAT_BINAURAL_APPLIED:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.beatIndex))) {
          throw new Error('EventCatalog.validateEmit: beat-binaural-applied.beatIndex must be finite');
        }
        return true;

      case names.HARMONIC_CHANGE:
        assertObject(data, name);
        if (!Array.isArray(data.changedFields)) {
          throw new Error('EventCatalog.validateEmit: harmonic-change.changedFields must be an array');
        }
        return true;

      case names.NOTES_EMITTED:
        assertObject(data, name);
        if (!Number.isFinite(Number(data.actual)) || !Number.isFinite(Number(data.intended))) {
          throw new Error('EventCatalog.validateEmit: notes-emitted.actual and intended must be finite');
        }
        return true;

      default:
        return true;
    }
  }

  return {
    names,
    validateEmit
  };
})();
