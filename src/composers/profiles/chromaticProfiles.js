if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('chromaticProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.chromatic = {
  default: [{ type: 'chromatic', targetScaleName: 'major', root: 'random', chromaticDensity: 0.4, voiceProfile: 'default', motifProfile: 'default' }],
  denseApproach: [{ type: 'chromatic', targetScaleName: 'major', root: 'random', chromaticDensity: 0.7, voiceProfile: 'expressive', motifProfile: 'dense' }],
  subtleColor: [{ type: 'chromatic', targetScaleName: 'minor', root: 'random', chromaticDensity: 0.2, voiceProfile: 'whisper', motifProfile: 'legato' }],
  minorEnclosure: [{ type: 'chromatic', targetScaleName: 'minor', root: 'random', chromaticDensity: 0.5, voiceProfile: 'soft', motifProfile: 'default' }],
  jazzApproach: [{ type: 'chromatic', targetScaleName: 'dorian', root: 'random', chromaticDensity: 0.55, voiceProfile: 'loud', motifProfile: 'dense' }],
  rootedMajor: [{ type: 'chromatic', targetScaleName: 'major', root: 'C', chromaticDensity: 0.3, voiceProfile: 'default', motifProfile: 'sparse' }],
  wideSpectrum: [{ type: 'chromatic', targetScaleName: 'random', root: 'random', chromaticDensity: 0.6, voiceProfile: 'expressive', motifProfile: 'percussive' }]
};
