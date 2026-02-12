if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('measureProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.measure = {
  default: [{ type: 'measure', rhythmProfile: 'straight', motifProfile: 'default', voiceProfile: 'default' }],
  sparsePulse: [{ type: 'measure', rhythmProfile: 'laidBack', motifProfile: 'sparse', voiceProfile: 'soft' }],
  densePulse: [{ type: 'measure', rhythmProfile: 'swung', motifProfile: 'dense', voiceProfile: 'loud' }],
  grooveLocked: [{ type: 'measure', rhythmProfile: 'straight', motifProfile: 'default', voiceProfile: 'default' }],
  exploratoryMeter: [{ type: 'measure', rhythmProfile: 'swung', motifProfile: 'default', voiceProfile: 'default' }],
  suspendedGrid: [{ type: 'measure', rhythmProfile: 'laidBack', motifProfile: 'sparse', voiceProfile: 'soft' }],
  accentedCells: [{ type: 'measure', rhythmProfile: 'straight', motifProfile: 'dense', voiceProfile: 'loud' }]
};
