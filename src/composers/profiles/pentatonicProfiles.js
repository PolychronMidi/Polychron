if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('pentatonicProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.pentatonic = {
  default: [{ type: 'pentatonic', root: 'random', scaleType: 'random', voiceProfile: 'default', motifProfile: 'default' }],
  majorLift: [{ type: 'pentatonic', root: 'random', scaleType: 'major', voiceProfile: 'loud', motifProfile: 'dense' }],
  minorMist: [{ type: 'pentatonic', root: 'random', scaleType: 'minor', voiceProfile: 'soft', motifProfile: 'sparse' }],
  rootedMajor: [{ type: 'pentatonic', root: 'C', scaleType: 'major', voiceProfile: 'default', motifProfile: 'default' }],
  rootedMinor: [{ type: 'pentatonic', root: 'A', scaleType: 'minor', voiceProfile: 'soft', motifProfile: 'sparse' }],
  brightRandom: [{ type: 'pentatonic', root: 'random', scaleType: 'major', voiceProfile: 'loud', motifProfile: 'default' }],
  darkRandom: [{ type: 'pentatonic', root: 'random', scaleType: 'minor', voiceProfile: 'soft', motifProfile: 'dense' }]
};
