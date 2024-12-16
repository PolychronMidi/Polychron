module.exports = {
    PPQ: 480,
    BASE_TEMPO: 120,
    MIN_NUMERATOR: 2,
    MAX_NUMERATOR: 24,
    MIN_DENOMINATOR: 3,
    MAX_DENOMINATOR: 24,
    MIN_DIVISIONS: 1,
    MAX_DIVISIONS: 24,
    OCTAVE_RANGE: {
        MIN: 1,
        MAX: 8
    },
    MEASURE_COUNT: 5,
    MIN_PHRASE_LENGTH: 2,
    MAX_PHRASE_LENGTH: 4,
    MIN_PHRASES_PER_SECTION: 2,
    MAX_PHRASES_PER_SECTION: 4,
    MIN_SECTIONS: 2,
    MAX_SECTIONS: 4,
    MIN_MEASURES: 20,
    MAX_MEASURES: 40,
    MAX_VOICES: 5,
    NOTE_GENERATORS: [
        { type: 'randomScale' },
        { type: 'scale', name: 'major', root: 'C' },
        { type: 'chord', progression: ['Cmaj', 'Dm', 'G', 'Cmaj'] }
    ]
};
