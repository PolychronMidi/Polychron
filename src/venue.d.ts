/**
 * MIDI item structure for programs and controls
 */
interface MidiItem {
    number: number;
    name: string;
}
/**
 * MIDI data categories
 */
interface MidiData {
    program: MidiItem[];
    control: MidiItem[];
}
declare const midiData: MidiData;
/**
 * Looks up a MIDI value (number) by category and name.
 * @param category - Category name ('program' or 'control')
 * @param name - The instrument or control name to look up
 * @returns The MIDI number, or 0 if not found (fallback)
 * @example
 * getMidiValue('program', 'Acoustic Grand Piano'); // returns 0
 * getMidiValue('control', 'Volume (coarse)'); // returns 7
 */
declare const getMidiValue: (category: string, name: string) => number;
/**
 * All chromatic notes in standardized enharmonic form.
 * @example
 * allNotes[0]; // 'C'
 */
declare const allNotes: string[];
/**
 * All available scale names that have valid note configurations.
 * @example
 * allScales[0]; // 'major'
 */
declare const allScales: string[];
/**
 * All available chord symbols that exist in the tonal library.
 * @example
 * allChords[0]; // 'CM'
 */
declare const allChords: string[];
/**
 * All available mode names for each root note.
 * @example
 * allModes[0]; // 'C ionian'
 */
declare const allModes: string[];
export { midiData, getMidiValue, allNotes, allScales, allChords, allModes, MidiData, MidiItem };
//# sourceMappingURL=venue.d.ts.map