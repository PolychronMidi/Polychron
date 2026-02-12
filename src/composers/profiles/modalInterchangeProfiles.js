if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('modalInterchangeProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.modalInterchange = {
  default: [{ type: 'modalInterchange', key: 'random', primaryMode: 'major', borrowProbability: 0.3, chordProfile: 'pop', rhythmProfile: 'straight' }],
  conservative: [{ type: 'modalInterchange', key: 'random', primaryMode: 'major', borrowProbability: 0.12, chordProfile: 'pop', rhythmProfile: 'straight' }],
  adventurous: [{ type: 'modalInterchange', key: 'random', primaryMode: 'major', borrowProbability: 0.55, chordProfile: 'jazz', rhythmProfile: 'swung' }],
  minorBlend: [{ type: 'modalInterchange', key: 'random', primaryMode: 'minor', borrowProbability: 0.35, chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  chromaticTilt: [{ type: 'modalInterchange', key: 'random', primaryMode: 'major', borrowProbability: 0.7, chordProfile: 'jazz', rhythmProfile: 'swung' }],
  stableMinor: [{ type: 'modalInterchange', key: 'random', primaryMode: 'minor', borrowProbability: 0.18, chordProfile: 'ambient', rhythmProfile: 'laidBack' }]
};
