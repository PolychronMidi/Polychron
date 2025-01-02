let TUNING = {
    FREQUENCY: 432, // Set to 440 for standard tuning (A4), which ignores PITCH_BEND. 
    PITCH_BEND: 6891 // After saving non-standard value to FREQUENCY, run 'node tune.js' to update PITCH_BEND value accordingly.
};
module.exports = {
    TUNING: TUNING,
    updatePitchBend: function(newPitchBend) {
        TUNING.PITCH_BEND = newPitchBend;
    },
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
        MAX: 8,
        WEIGHTS: [0.1, 0.2, 0.3, 0.4, 0.4, 0.3, 0.2, 0.1]
    },
    VOICES: {
        MIN: 1,
        MAX: 5
    },
    // MEASURES_PER_PHRASE: {
    //     MIN: 2,
    //     MAX: 4
    // },
    // PHRASES_PER_SECTION: {
    //     MIN: 2,
    //     MAX: 4
    // },
    // SECTIONS: {
    //     MIN: 2,
    //     MAX: 4
    // },
    MEASURES: {
        MIN: 10,
        MAX: 20
    },
    COMPOSERS: [
        { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(sheet, this.name, this.root)' },
        { type: 'randomScale', return: 'new RandomScaleComposer(sheet)' },
        { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'], return: 'new ChordComposer(sheet, this.progression)' },
        { type: 'randomChordProgression', return: 'new RandomChordComposer(sheet)' }
    ],
    SILENT_OUTRO_SECONDS: 5
};
