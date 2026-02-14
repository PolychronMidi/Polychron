if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('modeProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.mode = {
  default: [{ type: 'mode', name: 'ionian', root: 'random', voiceProfile: 'default', motifProfile: 'default' }],
  modalDrift: [{ type: 'mode', name: 'random', root: 'random', voiceProfile: 'default', motifProfile: 'dense' }],
  anchoredIonian: [{ type: 'mode', name: 'ionian', root: 'C', voiceProfile: 'default', motifProfile: 'default' }],
  dorianPulse: [{ type: 'mode', name: 'dorian', root: 'random', voiceProfile: 'soft', motifProfile: 'sparse' }],
  phrygianEdge: [{ type: 'mode', name: 'phrygian', root: 'random', voiceProfile: 'loud', motifProfile: 'dense' }],
  mixolydianDrive: [{ type: 'mode', name: 'mixolydian', root: 'random', voiceProfile: 'default', motifProfile: 'dense' }],
  aeolianCore: [{ type: 'mode', name: 'aeolian', root: 'A', voiceProfile: 'soft', motifProfile: 'sparse' }],
  lydianFloat: [{ type: 'mode', name: 'lydian', root: 'random', voiceProfile: 'whisper', motifProfile: 'legato' }],
  locrianTension: [{ type: 'mode', name: 'locrian', root: 'random', voiceProfile: 'expressive', motifProfile: 'percussive' }]
};
