if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('harmonicRhythmProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.harmonicRhythm = {
  default: [{ type: 'harmonicRhythm', progression: ['I', 'IV', 'V', 'I'], key: 'random', measuresPerChord: 2, quality: 'major', changeEmphasis: 2.0, anticipation: false, settling: true, phraseBoundaryEmphasis: 1.3, chordProfile: 'pop', rhythmProfile: 'straight' }],
  patientGrid: [{ type: 'harmonicRhythm', progression: ['I', 'vi', 'IV', 'V'], key: 'random', measuresPerChord: 4, quality: 'major', changeEmphasis: 1.4, anticipation: false, settling: true, phraseBoundaryEmphasis: 1.5, chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  activeGrid: [{ type: 'harmonicRhythm', progression: ['I', 'V', 'vi', 'IV'], key: 'random', measuresPerChord: 1, quality: 'major', changeEmphasis: 2.6, anticipation: true, settling: false, phraseBoundaryEmphasis: 1.2, chordProfile: 'jazz', rhythmProfile: 'swung' }],
  anticipatory: [{ type: 'harmonicRhythm', progression: ['ii', 'V', 'I', 'vi'], key: 'random', measuresPerChord: 2, quality: 'major', changeEmphasis: 2.2, anticipation: true, settling: true, phraseBoundaryEmphasis: 1.6, chordProfile: 'jazz', rhythmProfile: 'swung' }],
  minorPulse: [{ type: 'harmonicRhythm', progression: ['Am', 'F', 'C', 'G'], key: 'A', measuresPerChord: 2, quality: 'minor', changeEmphasis: 1.9, anticipation: true, settling: true, phraseBoundaryEmphasis: 1.4, chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  cadenceHeavy: [{ type: 'harmonicRhythm', progression: ['I', 'V', 'IV', 'I'], key: 'random', measuresPerChord: 3, quality: 'major', changeEmphasis: 2.8, anticipation: false, settling: true, phraseBoundaryEmphasis: 1.8, chordProfile: 'pop', rhythmProfile: 'straight' }]
};
