"use strict";
// venue.ts - MIDI data definitions with program changes, controls, and music theory.
// minimalist comments, details at: venue.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.allModes = exports.allChords = exports.allScales = exports.allNotes = exports.getMidiValue = exports.midiData = void 0;
const midiData = {
    program: [
        { number: 0, name: 'Acoustic Grand Piano' },
        { number: 1, name: 'Bright Acoustic Piano' },
        { number: 2, name: 'Electric Grand Piano' },
        { number: 3, name: 'Honky-tonk Piano' },
        { number: 4, name: 'Electric Piano 1' },
        { number: 5, name: 'Electric Piano 2' },
        { number: 6, name: 'Harpsichord' },
        { number: 7, name: 'Clavi' },
        { number: 8, name: 'Celesta' },
        { number: 9, name: 'Glockenspiel' },
        { number: 10, name: 'Music Box' },
        { number: 11, name: 'Vibraphone' },
        { number: 12, name: 'Marimba' },
        { number: 13, name: 'Xylophone' },
        { number: 14, name: 'Tubular Bells' },
        { number: 15, name: 'Dulcimer' },
        { number: 16, name: 'Drawbar Organ' },
        { number: 17, name: 'Percussive Organ' },
        { number: 18, name: 'Rock Organ' },
        { number: 19, name: 'Church Organ' },
        { number: 20, name: 'Reed Organ' },
        { number: 21, name: 'Accordion' },
        { number: 22, name: 'Harmonica' },
        { number: 23, name: 'Tango Accordion' },
        { number: 24, name: 'Acoustic Guitar (nylon)' },
        { number: 25, name: 'Acoustic Guitar (steel)' },
        { number: 26, name: 'Electric Guitar (jazz)' },
        { number: 27, name: 'Electric Guitar (clean)' },
        { number: 28, name: 'Electric Guitar (muted)' },
        { number: 29, name: 'Overdriven Guitar' },
        { number: 30, name: 'Distortion Guitar' },
        { number: 31, name: 'Guitar Harmonics' },
        { number: 32, name: 'Acoustic Bass' },
        { number: 33, name: 'Electric Bass (finger)' },
        { number: 34, name: 'Electric Bass (pick)' },
        { number: 35, name: 'Fretless Bass' },
        { number: 36, name: 'Slap Bass 1' },
        { number: 37, name: 'Slap Bass 2' },
        { number: 38, name: 'Synth Bass 1' },
        { number: 39, name: 'Synth Bass 2' },
        { number: 40, name: 'Violin' },
        { number: 41, name: 'Viola' },
        { number: 42, name: 'Cello' },
        { number: 43, name: 'Contrabass' },
        { number: 44, name: 'Tremolo Strings' },
        { number: 45, name: 'Pizzicato Strings' },
        { number: 46, name: 'Orchestral Harp' },
        { number: 47, name: 'Timpani' },
        { number: 48, name: 'String Ensemble 1' },
        { number: 49, name: 'String Ensemble 2' },
        { number: 50, name: 'Synth Strings 1' },
        { number: 51, name: 'Synth Strings 2' },
        { number: 52, name: 'Choir Aahs' },
        { number: 53, name: 'Voice Oohs' },
        { number: 54, name: 'Synth Voice' },
        { number: 55, name: 'Orchestra Hit' },
        { number: 56, name: 'Trumpet' },
        { number: 57, name: 'Trombone' },
        { number: 58, name: 'Tuba' },
        { number: 59, name: 'Muted Trumpet' },
        { number: 60, name: 'French Horn' },
        { number: 61, name: 'Brass Section' },
        { number: 62, name: 'Synth Brass 1' },
        { number: 63, name: 'Synth Brass 2' },
        { number: 64, name: 'Soprano Sax' },
        { number: 65, name: 'Alto Sax' },
        { number: 66, name: 'Tenor Sax' },
        { number: 67, name: 'Baritone Sax' },
        { number: 68, name: 'Oboe' },
        { number: 69, name: 'English Horn' },
        { number: 70, name: 'Bassoon' },
        { number: 71, name: 'Clarinet' },
        { number: 72, name: 'Piccolo' },
        { number: 73, name: 'Flute' },
        { number: 74, name: 'Recorder' },
        { number: 75, name: 'Pan Flute' },
        { number: 76, name: 'Blown Bottle' },
        { number: 77, name: 'Shakuhachi' },
        { number: 78, name: 'Whistle' },
        { number: 79, name: 'Ocarina' },
        { number: 80, name: 'Lead 1 (square)' },
        { number: 81, name: 'Lead 2 (sawtooth)' },
        { number: 82, name: 'Lead 3 (calliope)' },
        { number: 83, name: 'Lead 4 (chiff)' },
        { number: 84, name: 'Lead 5 (charang)' },
        { number: 85, name: 'Lead 6 (voice)' },
        { number: 86, name: 'Lead 7 (fifths)' },
        { number: 87, name: 'Lead 8 (bass + lead)' },
        { number: 88, name: 'Pad 1 (new age)' },
        { number: 89, name: 'Pad 2 (warm)' },
        { number: 90, name: 'Pad 3 (polysynth)' },
        { number: 91, name: 'Pad 4 (choir)' },
        { number: 92, name: 'Pad 5 (bowed)' },
        { number: 93, name: 'Pad 6 (metallic)' },
        { number: 94, name: 'Pad 7 (halo)' },
        { number: 95, name: 'Pad 8 (sweep)' },
        { number: 96, name: 'FX 1 (rain)' },
        { number: 97, name: 'FX 2 (soundtrack)' },
        { number: 98, name: 'FX 3 (crystal)' },
        { number: 99, name: 'FX 4 (atmosphere)' },
        { number: 100, name: 'FX 5 (brightness)' },
        { number: 101, name: 'FX 6 (goblins)' },
        { number: 102, name: 'FX 7 (echoes)' },
        { number: 103, name: 'FX 8 (sci-fi)' },
        { number: 104, name: 'Sitar' },
        { number: 105, name: 'Banjo' },
        { number: 106, name: 'Shamisen' },
        { number: 107, name: 'Koto' },
        { number: 108, name: 'Kalimba' },
        { number: 109, name: 'Bagpipe' },
        { number: 110, name: 'Fiddle' },
        { number: 111, name: 'Shanai' },
        { number: 112, name: 'Tinkle Bell' },
        { number: 113, name: 'Agogo' },
        { number: 114, name: 'Steel Drums' },
        { number: 115, name: 'Woodblock' },
        { number: 116, name: 'Taiko Drum' },
        { number: 117, name: 'Melodic Tom' },
        { number: 118, name: 'Synth Drum' },
        { number: 119, name: 'Reverse Cymbal' },
        { number: 120, name: 'Guitar Fret Noise' },
        { number: 121, name: 'Breath Noise' },
        { number: 122, name: 'Seashore' },
        { number: 123, name: 'Bird Tweet' },
        { number: 124, name: 'Telephone Ring' },
        { number: 125, name: 'Helicopter' },
        { number: 126, name: 'Applause' },
        { number: 127, name: 'Gunshot' }
    ],
    control: [
        { number: 0, name: 'Bank Select (coarse)' },
        { number: 1, name: 'Modulation Wheel (coarse)' },
        { number: 2, name: 'Breath controller (coarse)' },
        { number: 4, name: 'Foot Pedal (coarse)' },
        { number: 5, name: 'Portamento Time (coarse)' },
        { number: 6, name: 'Data Entry (coarse)' },
        { number: 7, name: 'Volume (coarse)' },
        { number: 8, name: 'Balance (coarse)' },
        { number: 10, name: 'Pan position (coarse)' },
        { number: 11, name: 'Expression (coarse)' },
        { number: 12, name: 'Effect Control 1 (coarse)' },
        { number: 13, name: 'Effect Control 2 (coarse)' },
        { number: 16, name: 'General Purpose Slider 1' },
        { number: 17, name: 'General Purpose Slider 2' },
        { number: 18, name: 'General Purpose Slider 3' },
        { number: 19, name: 'General Purpose Slider 4' },
        { number: 32, name: 'Bank Select (fine)' },
        { number: 33, name: 'Modulation Wheel (fine)' },
        { number: 34, name: 'Breath controller (fine)' },
        { number: 36, name: 'Foot Pedal (fine)' },
        { number: 37, name: 'Portamento Time (fine)' },
        { number: 38, name: 'Data Entry (fine)' },
        { number: 39, name: 'Volume (fine)' },
        { number: 40, name: 'Balance (fine)' },
        { number: 42, name: 'Pan position (fine)' },
        { number: 43, name: 'Expression (fine)' },
        { number: 44, name: 'Effect Control 1 (fine)' },
        { number: 45, name: 'Effect Control 2 (fine)' },
        { number: 64, name: 'Hold Pedal (on/off)' },
        { number: 65, name: 'Portamento (on/off)' },
        { number: 66, name: 'Sustenuto Pedal (on/off)' },
        { number: 67, name: 'Soft Pedal (on/off)' },
        { number: 68, name: 'Legato Pedal (on/off)' },
        { number: 69, name: 'Hold 2 Pedal (on/off)' },
        { number: 70, name: 'Sound Variation' },
        { number: 71, name: 'Sound Timbre' },
        { number: 72, name: 'Sound Release Time' },
        { number: 73, name: 'Sound Attack Time' },
        { number: 74, name: 'Sound Brightness' },
        { number: 75, name: 'Sound Control 6' },
        { number: 76, name: 'Sound Control 7' },
        { number: 77, name: 'Sound Control 8' },
        { number: 78, name: 'Sound Control 9' },
        { number: 79, name: 'Sound Control 10' },
        { number: 80, name: 'General Purpose Button 1 (on/off)' },
        { number: 81, name: 'General Purpose Button 2 (on/off)' },
        { number: 82, name: 'General Purpose Button 3 (on/off)' },
        { number: 83, name: 'General Purpose Button 4 (on/off)' },
        { number: 91, name: 'Effects Level' },
        { number: 92, name: 'Tremulo Level' },
        { number: 93, name: 'Chorus Level' },
        { number: 94, name: 'Celeste Level' },
        { number: 95, name: 'Phaser Level' },
        { number: 96, name: 'Data Button increment' },
        { number: 97, name: 'Data Button decrement' },
        { number: 98, name: 'Non-registered Parameter (fine)' },
        { number: 99, name: 'Non-registered Parameter (coarse)' },
        { number: 100, name: 'Registered Parameter (fine)' },
        { number: 101, name: 'Registered Parameter (coarse)' },
        { number: 120, name: 'All Sound Off' },
        { number: 121, name: 'All Controllers Off' },
        { number: 122, name: 'Local Keyboard (on/off)' },
        { number: 123, name: 'All Notes Off' },
        { number: 124, name: 'Omni Mode Off' },
        { number: 125, name: 'Omni Mode On' },
        { number: 126, name: 'Mono Operation' },
        { number: 127, name: 'Poly Operation' }
    ]
};
exports.midiData = midiData;
/**
 * Looks up a MIDI value (number) by category and name.
 * @param category - Category name ('program' or 'control')
 * @param name - The instrument or control name to look up
 * @returns The MIDI number, or 0 if not found (fallback)
 * @example
 * getMidiValue('program', 'Acoustic Grand Piano'); // returns 0
 * getMidiValue('control', 'Volume (coarse)'); // returns 7
 */
const getMidiValue = (category, name) => {
    category = category.toLowerCase();
    name = name.toLowerCase();
    if (!midiData[category]) {
        console.warn(`Invalid MIDI category: ${category}`);
        return 0; // Fallback to 0 instead of null
    }
    const item = midiData[category].find(item => item.name.toLowerCase() === name);
    if (!item) {
        console.warn(`MIDI ${category} '${name}' not found, using fallback value 0`);
        return 0;
    }
    return item.number;
};
exports.getMidiValue = getMidiValue;
// Lazy initialization of instrument numbers (after globalThis is populated)
let primaryInstrumentNum = 0;
let secondaryInstrumentNum = 0;
let bassInstrumentNum = 0;
let bassInstrument2Num = 0;
/**
 * Initialize instrument MIDI numbers from global instrument names
 * Must be called after sheet.ts has set globalThis instrument values
 */
const initInstrumentNumbers = () => {
    const primaryInst = globalThis.primaryInstrument;
    const secondaryInst = globalThis.secondaryInstrument;
    const bassInst = globalThis.bassInstrument;
    const bassInst2 = globalThis.bassInstrument2;
    if (primaryInst)
        primaryInstrumentNum = getMidiValue('program', primaryInst);
    if (secondaryInst)
        secondaryInstrumentNum = getMidiValue('program', secondaryInst);
    if (bassInst)
        bassInstrumentNum = getMidiValue('program', bassInst);
    if (bassInst2)
        bassInstrument2Num = getMidiValue('program', bassInst2);
};
// Call initialization immediately
initInstrumentNumbers();
/** Tonal.js library for music theory operations */
const t = require('tonal');
globalThis.t = t;
/**
 * All chromatic notes in standardized enharmonic form.
 * @example
 * allNotes[0]; // 'C'
 */
const allNotes = t.Scale.get('C chromatic').notes.map((note) => t.Note.enharmonic(t.Note.get(note)));
exports.allNotes = allNotes;
/**
 * All available scale names that have valid note configurations.
 * @example
 * allScales[0]; // 'major'
 */
const allScales = t.Scale.names().filter((scaleName) => {
    return allNotes.some(root => {
        const scale = t.Scale.get(`${root} ${scaleName}`);
        return scale.notes.length > 0;
    });
});
exports.allScales = allScales;
/**
 * All available chord symbols that exist in the tonal library.
 * @example
 * allChords[0]; // 'CM'
 */
const allChords = (function () {
    function getChordNotes(chordType, root) {
        const chord = t.Chord.get(`${root} ${chordType}`);
        if (!chord.empty && chord.symbol) {
            return { symbol: chord.symbol, notes: chord.notes };
        }
    }
    const allChordsSet = new Set();
    t.ChordType.all().forEach((chordType) => {
        allNotes.forEach(root => {
            const chord = getChordNotes(chordType.name, root);
            if (chord) {
                allChordsSet.add(chord.symbol);
            }
        });
    });
    return Array.from(allChordsSet);
})();
exports.allChords = allChords;
/**
 * All available mode names for each root note.
 * @example
 * allModes[0]; // 'C ionian'
 */
const allModes = (() => {
    const allModesSet = new Set();
    t.Mode.all().forEach((mode) => {
        allNotes.forEach(root => {
            const modeName = `${root} ${mode.name}`;
            allModesSet.add(modeName);
        });
    });
    return Array.from(allModesSet);
})();
exports.allModes = allModes;
// Export to global scope for testing and compatibility
globalThis.midiData = midiData;
globalThis.getMidiValue = getMidiValue;
globalThis.allNotes = allNotes;
globalThis.allScales = allScales;
globalThis.allChords = allChords;
globalThis.allModes = allModes;
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        midiData,
        getMidiValue,
        allNotes,
        allScales,
        allChords,
        allModes,
    });
}
//# sourceMappingURL=venue.js.map