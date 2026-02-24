// composerCapabilities.js - central capability validation/normalization helpers

const _COMPOSER_CAPABILITY_DEFAULTS = {
  preservesScale: true,
  mutatesPitchClasses: false,
  deterministic: false,
  notesReflectOutputSet: false,
  timeVaryingScaleContext: false
};

/**
 * Normalize/validate composer capability flags.
 * Accepts either a composer object (with `capabilities`) or a plain capability object.
 * @param {Object} composerOrCapabilities
 * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}}
 */
assertComposerCapabilities = function(composerOrCapabilities) {
  if (!composerOrCapabilities || typeof composerOrCapabilities !== 'object') {
    throw new Error('assertComposerCapabilities: input must be an object');
  }

  const source = (composerOrCapabilities.capabilities && typeof composerOrCapabilities.capabilities === 'object')
    ? composerOrCapabilities.capabilities
    : composerOrCapabilities;

  const merged = Object.assign({}, _COMPOSER_CAPABILITY_DEFAULTS, source);
  const keys = ['preservesScale', 'mutatesPitchClasses', 'deterministic', 'notesReflectOutputSet', 'timeVaryingScaleContext'];
  for (const key of keys) {
    if (typeof merged[key] !== 'boolean') {
      throw new Error(`assertComposerCapabilities: ${key} must be boolean`);
    }
  }

  return {
    preservesScale: merged.preservesScale,
    mutatesPitchClasses: merged.mutatesPitchClasses,
    deterministic: merged.deterministic,
    notesReflectOutputSet: merged.notesReflectOutputSet,
    timeVaryingScaleContext: merged.timeVaryingScaleContext
  };
};
