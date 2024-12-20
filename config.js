module.exports = {
    PPQ: 30000,
    BASE_TEMPO: 60,
    NUMERATOR: {
        MIN: 2,
        MAX: 15
    },
    DENOMINATOR: {
        MIN: 3,
        MAX: 11
    },
    DIVISIONS: {
        MIN: 1,
        MAX: 10
    },
    OCTAVE: {
        MIN: 1,
        MAX: 8
    },
    VOICES: {
        MIN: 1,
        MAX: 5
    },
    MEASURES_PER_PHRASE: {
        MIN: 2,
        MAX: 4
    },
    PHRASES_PER_SECTION: {
        MIN: 2,
        MAX: 4
    },
    SECTIONS: {
        MIN: 2,
        MAX: 4
    },
    MEASURES: {
        MIN: 10,
        MAX: 20
    },
    COMPOSERS: [
        { type: 'scale', name: 'major', root: 'C' },
        { type: 'randomScale' },
        { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'] },
        { type: 'randomChordProgression' }
    ]
};
