if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('chordsProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.chords = {
  default: [{ type: 'chords', progression: 'random', direction: 'R', chordProfile: 'pop', rhythmProfile: 'straight' }],
  functionalPop: [{ type: 'chords', progression: ['C', 'Am', 'F', 'G'], direction: 'R', chordProfile: 'pop', rhythmProfile: 'straight' }],
  iiVICycle: [{ type: 'chords', progression: ['Dm7', 'G7', 'Cmaj7', 'Am7'], direction: 'R', chordProfile: 'jazz', rhythmProfile: 'swung' }],
  ambientPads: [{ type: 'chords', progression: ['Cmaj7', 'Am7', 'Fmaj7', 'G7'], direction: 'E', chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  leftwardFlow: [{ type: 'chords', progression: 'random', direction: 'L', chordProfile: 'pop', rhythmProfile: 'laidBack' }],
  bidirectionalWalk: [{ type: 'chords', progression: 'random', direction: 'E', chordProfile: 'jazz', rhythmProfile: 'swung' }],
  restlessShuffle: [{ type: 'chords', progression: 'random', direction: '?', chordProfile: 'jazz', rhythmProfile: 'swung' }]
};
