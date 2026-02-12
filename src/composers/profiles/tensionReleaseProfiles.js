if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('tensionReleaseProfiles: COMPOSER_TYPE_PROFILE_SOURCES is not available');
}

COMPOSER_TYPE_PROFILE_SOURCES.tensionRelease = {
  default: [{ type: 'tensionRelease', key: 'random', quality: 'major', tensionCurve: 0.6, enablePhraseArcs: true, phraseTensionScaling: true, chordProfile: 'pop', rhythmProfile: 'straight' }],
  arcGentle: [{ type: 'tensionRelease', key: 'random', quality: 'major', tensionCurve: 0.35, enablePhraseArcs: true, phraseTensionScaling: true, chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  arcSteep: [{ type: 'tensionRelease', key: 'random', quality: 'major', tensionCurve: 0.85, enablePhraseArcs: true, phraseTensionScaling: true, chordProfile: 'jazz', rhythmProfile: 'swung' }],
  phraseDetached: [{ type: 'tensionRelease', key: 'random', quality: 'major', tensionCurve: 0.5, enablePhraseArcs: false, phraseTensionScaling: false, chordProfile: 'pop', rhythmProfile: 'straight' }],
  minorRelease: [{ type: 'tensionRelease', key: 'random', quality: 'minor', tensionCurve: 0.55, enablePhraseArcs: true, phraseTensionScaling: true, chordProfile: 'ambient', rhythmProfile: 'laidBack' }],
  dramaticContour: [{ type: 'tensionRelease', key: 'random', quality: 'major', tensionCurve: 0.95, enablePhraseArcs: true, phraseTensionScaling: true, chordProfile: 'jazz', rhythmProfile: 'swung' }]
};
