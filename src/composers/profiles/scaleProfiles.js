if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('scaleProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.scale = {
  default: [{ type: 'scale', name: 'major', root: 'random', voiceProfile: 'default', motifProfile: 'default' }],
  diatonicWander: [{ type: 'scale', name: 'random', root: 'random', voiceProfile: 'default', motifProfile: 'dense' }],
  brightCenter: [{ type: 'scale', name: 'major', root: 'C', voiceProfile: 'loud', motifProfile: 'dense' }],
  minorCenter: [{ type: 'scale', name: 'minor', root: 'A', voiceProfile: 'soft', motifProfile: 'sparse' }],
  mobileMinor: [{ type: 'scale', name: 'minor', root: 'random', voiceProfile: 'soft', motifProfile: 'default' }],
  stableMajor: [{ type: 'scale', name: 'major', root: 'G', voiceProfile: 'default', motifProfile: 'default' }],
  randomAnchor: [{ type: 'scale', name: 'random', root: 'C', voiceProfile: 'default', motifProfile: 'sparse' }],
  harmonicMinorDrift: [{ type: 'scale', name: 'harmonic minor', root: 'random', voiceProfile: 'expressive', motifProfile: 'dense' }],
  wholeToneFloat: [{ type: 'scale', name: 'whole tone', root: 'random', voiceProfile: 'whisper', motifProfile: 'legato' }],
  wholeToneBright: [{ type: 'scale', name: 'whole tone', root: 'C', voiceProfile: 'loud', motifProfile: 'dense' }],
  octatonicHW: [{ type: 'scale', name: 'diminished', root: 'random', voiceProfile: 'expressive', motifProfile: 'dense' }],
  octatonicWH: [{ type: 'scale', name: 'whole-half diminished', root: 'random', voiceProfile: 'soft', motifProfile: 'sparse' }]
};
