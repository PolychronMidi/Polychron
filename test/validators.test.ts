import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  NoteObject,
  MeterArray,
  TempoObject,
  isValidNoteObject,
  isValidNoteArray,
  isValidMeterArray,
  isValidTempoObject,
  isValidMidiNote,
  isValidMidiVelocity,
  isValidOctave,
  assertIsValidNoteObject,
  assertIsValidNoteArray,
  assertIsValidMeterArray,
  assertIsValidTempoObject,
  assertIsValidMidiNote,
  assertIsValidOctave,
  parseMeterArray,
  parseNoteObject,
  parseNoteArray,
  parseTempoObject,
} from '../src/validators/index';

describe('Validators: Type Guards and Assertions', () => {
  describe('ValidationError', () => {
    it('should create error with path', () => {
      const error = new ValidationError('config.octave.max', 'must be > min');
      expect(error.path).toBe('config.octave.max');
      expect(error.message).toContain('[config.octave.max]');
      expect(error.message).toContain('must be > min');
    });

    it('should be instanceof Error', () => {
      const error = new ValidationError('test', 'test message');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof ValidationError).toBe(true);
    });
  });

  describe('isValidNoteObject type guard', () => {
    it('should accept valid note objects', () => {
      const note: NoteObject = {
        pitch: 'C',
        octave: 4,
        duration: 0.5,
      };
      expect(isValidNoteObject(note)).toBe(true);
    });

    it('should accept notes with optional velocity', () => {
      const note = {
        pitch: 'D#',
        octave: 3,
        duration: 1,
        velocity: 100,
      };
      expect(isValidNoteObject(note)).toBe(true);
    });

    it('should accept notes with extra properties', () => {
      const note = {
        pitch: 'E',
        octave: 5,
        duration: 0.25,
        velocity: 80,
        extraData: 'ignored',
      };
      expect(isValidNoteObject(note)).toBe(true);
    });

    it('should reject non-objects', () => {
      expect(isValidNoteObject(null)).toBe(false);
      expect(isValidNoteObject(undefined)).toBe(false);
      expect(isValidNoteObject('C4')).toBe(false);
      expect(isValidNoteObject(60)).toBe(false);
    });

    it('should reject missing pitch', () => {
      expect(isValidNoteObject({ octave: 4, duration: 1 })).toBe(false);
    });

    it('should reject empty pitch string', () => {
      expect(isValidNoteObject({ pitch: '', octave: 4, duration: 1 })).toBe(false);
    });

    it('should reject invalid octave', () => {
      expect(isValidNoteObject({ pitch: 'C', octave: -1, duration: 1 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 9, duration: 1 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 4.5, duration: 1 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 'four' as any, duration: 1 })).toBe(false);
    });

    it('should reject invalid duration', () => {
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 0 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: -1 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 'half' as any })).toBe(false);
    });

    it('should reject invalid velocity', () => {
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 1, velocity: -1 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 1, velocity: 128 })).toBe(false);
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 1, velocity: 'loud' as any })).toBe(
        false
      );
    });
  });

  describe('isValidNoteArray type guard', () => {
    it('should accept array of valid notes', () => {
      const notes: NoteObject[] = [
        { pitch: 'C', octave: 4, duration: 1 },
        { pitch: 'D', octave: 4, duration: 0.5 },
        { pitch: 'E', octave: 4, duration: 0.5 },
      ];
      expect(isValidNoteArray(notes)).toBe(true);
    });

    it('should accept empty array', () => {
      expect(isValidNoteArray([])).toBe(true);
    });

    it('should reject non-array', () => {
      expect(isValidNoteArray({ pitch: 'C', octave: 4, duration: 1 })).toBe(false);
      expect(isValidNoteArray('notes')).toBe(false);
      expect(isValidNoteArray(null)).toBe(false);
    });

    it('should reject array with invalid note', () => {
      const notes = [
        { pitch: 'C', octave: 4, duration: 1 },
        { pitch: 'D', octave: 9, duration: 1 }, // Invalid octave
      ];
      expect(isValidNoteArray(notes)).toBe(false);
    });
  });

  describe('isValidMeterArray type guard', () => {
    it('should accept valid meters', () => {
      expect(isValidMeterArray([4, 4])).toBe(true);
      expect(isValidMeterArray([3, 4])).toBe(true);
      expect(isValidMeterArray([12, 8])).toBe(true);
    });

    it('should accept various note values (powers of 2)', () => {
      expect(isValidMeterArray([4, 1])).toBe(true);
      expect(isValidMeterArray([4, 2])).toBe(true);
      expect(isValidMeterArray([4, 4])).toBe(true);
      expect(isValidMeterArray([4, 8])).toBe(true);
      expect(isValidMeterArray([4, 16])).toBe(true);
      expect(isValidMeterArray([4, 32])).toBe(true);
    });

    it('should reject non-power-of-2 note values', () => {
      expect(isValidMeterArray([4, 3])).toBe(false);
      expect(isValidMeterArray([4, 5])).toBe(false);
      expect(isValidMeterArray([4, 6])).toBe(false);
      expect(isValidMeterArray([4, 7])).toBe(false);
    });

    it('should reject non-array', () => {
      expect(isValidMeterArray({ beats: 4, noteValue: 4 })).toBe(false);
      expect(isValidMeterArray('4/4')).toBe(false);
      expect(isValidMeterArray(null)).toBe(false);
    });

    it('should reject wrong length', () => {
      expect(isValidMeterArray([4])).toBe(false);
      expect(isValidMeterArray([4, 4, 4])).toBe(false);
    });

    it('should reject non-integer beats', () => {
      expect(isValidMeterArray([4.5, 4])).toBe(false);
      expect(isValidMeterArray(['4' as any, 4])).toBe(false);
    });

    it('should reject beats < 1', () => {
      expect(isValidMeterArray([0, 4])).toBe(false);
      expect(isValidMeterArray([-1, 4])).toBe(false);
    });

    it('should reject note value < 1', () => {
      expect(isValidMeterArray([4, 0])).toBe(false);
      expect(isValidMeterArray([4, -4])).toBe(false);
    });
  });

  describe('isValidTempoObject type guard', () => {
    it('should accept valid tempo objects', () => {
      expect(isValidTempoObject({ bpm: 120 })).toBe(true);
      expect(isValidTempoObject({ bpm: 60 })).toBe(true);
      expect(isValidTempoObject({ bpm: 300 })).toBe(true);
    });

    it('should accept tempo with tempo changes', () => {
      expect(
        isValidTempoObject({
          bpm: 120,
          tempoChanges: [
            { measure: 0, bpm: 120 },
            { measure: 4, bpm: 140 },
          ],
        })
      ).toBe(true);
    });

    it('should accept tempo with empty tempo changes', () => {
      expect(isValidTempoObject({ bpm: 120, tempoChanges: [] })).toBe(true);
    });

    it('should reject non-object', () => {
      expect(isValidTempoObject(120)).toBe(false);
      expect(isValidTempoObject('120')).toBe(false);
      expect(isValidTempoObject(null)).toBe(false);
    });

    it('should reject invalid bpm', () => {
      expect(isValidTempoObject({ bpm: 0 })).toBe(false);
      expect(isValidTempoObject({ bpm: -1 })).toBe(false);
      expect(isValidTempoObject({ bpm: 301 })).toBe(false);
      expect(isValidTempoObject({ bpm: 'fast' as any })).toBe(false);
    });

    it('should reject invalid tempo changes', () => {
      expect(
        isValidTempoObject({
          bpm: 120,
          tempoChanges: 'not array' as any,
        })
      ).toBe(false);
    });

    it('should reject invalid tempo change objects', () => {
      expect(
        isValidTempoObject({
          bpm: 120,
          tempoChanges: [{ measure: -1, bpm: 120 }], // Negative measure
        })
      ).toBe(false);

      expect(
        isValidTempoObject({
          bpm: 120,
          tempoChanges: [{ measure: 0, bpm: 0 }], // Invalid bpm
        })
      ).toBe(false);
    });
  });

  describe('MIDI number validators', () => {
    it('isValidMidiNote should accept 0-127', () => {
      expect(isValidMidiNote(0)).toBe(true);
      expect(isValidMidiNote(60)).toBe(true);
      expect(isValidMidiNote(127)).toBe(true);
    });

    it('isValidMidiNote should reject out of range', () => {
      expect(isValidMidiNote(-1)).toBe(false);
      expect(isValidMidiNote(128)).toBe(false);
      expect(isValidMidiNote(1000)).toBe(false);
    });

    it('isValidMidiNote should reject non-integers', () => {
      expect(isValidMidiNote(60.5)).toBe(false);
      expect(isValidMidiNote('60' as any)).toBe(false);
    });

    it('isValidMidiVelocity should accept 0-127', () => {
      expect(isValidMidiVelocity(0)).toBe(true);
      expect(isValidMidiVelocity(80)).toBe(true);
      expect(isValidMidiVelocity(127)).toBe(true);
    });

    it('isValidMidiVelocity should reject out of range', () => {
      expect(isValidMidiVelocity(-1)).toBe(false);
      expect(isValidMidiVelocity(128)).toBe(false);
    });

    it('isValidOctave should accept 0-8', () => {
      expect(isValidOctave(0)).toBe(true);
      expect(isValidOctave(4)).toBe(true);
      expect(isValidOctave(8)).toBe(true);
    });

    it('isValidOctave should reject out of range', () => {
      expect(isValidOctave(-1)).toBe(false);
      expect(isValidOctave(9)).toBe(false);
    });
  });

  describe('Assertion functions', () => {
    it('assertIsValidNoteObject should not throw for valid note', () => {
      expect(() => {
        assertIsValidNoteObject({ pitch: 'C', octave: 4, duration: 1 });
      }).not.toThrow();
    });

    it('assertIsValidNoteObject should throw ValidationError for invalid note', () => {
      expect(() => {
        assertIsValidNoteObject({ pitch: 'C', octave: 9, duration: 1 }, 'input.note');
      }).toThrow(ValidationError);

      try {
        assertIsValidNoteObject({ pitch: '', octave: 4, duration: 1 }, 'myNote');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.path).toBe('myNote');
          expect(error.message).toContain('pitch');
        }
      }
    });

    it('assertIsValidNoteArray should not throw for valid array', () => {
      expect(() => {
        assertIsValidNoteArray([
          { pitch: 'C', octave: 4, duration: 1 },
          { pitch: 'D', octave: 4, duration: 1 },
        ]);
      }).not.toThrow();
    });

    it('assertIsValidNoteArray should throw for invalid array', () => {
      expect(() => {
        assertIsValidNoteArray(
          [
            { pitch: 'C', octave: 4, duration: 1 },
            { pitch: 'D', octave: 9, duration: 1 }, // Invalid
          ],
          'notes'
        );
      }).toThrow(ValidationError);
    });

    it('assertIsValidMeterArray should not throw for valid meter', () => {
      expect(() => {
        assertIsValidMeterArray([4, 4]);
      }).not.toThrow();
    });

    it('assertIsValidMeterArray should throw for invalid meter', () => {
      expect(() => {
        assertIsValidMeterArray([4, 3], 'meter');
      }).toThrow(ValidationError);

      try {
        assertIsValidMeterArray([4, 3], 'config.meter');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.path).toContain('config.meter');
          expect(error.message).toContain('power of 2');
        }
      }
    });

    it('assertIsValidTempoObject should not throw for valid tempo', () => {
      expect(() => {
        assertIsValidTempoObject({ bpm: 120 });
      }).not.toThrow();
    });

    it('assertIsValidTempoObject should throw for invalid tempo', () => {
      expect(() => {
        assertIsValidTempoObject({ bpm: 400 }, 'tempo');
      }).toThrow(ValidationError);
    });

    it('assertIsValidMidiNote should not throw for valid note', () => {
      expect(() => {
        assertIsValidMidiNote(60);
      }).not.toThrow();
    });

    it('assertIsValidMidiNote should throw for invalid note', () => {
      expect(() => {
        assertIsValidMidiNote(200, 'midiNote');
      }).toThrow(ValidationError);
    });

    it('assertIsValidOctave should not throw for valid octave', () => {
      expect(() => {
        assertIsValidOctave(4);
      }).not.toThrow();
    });

    it('assertIsValidOctave should throw for invalid octave', () => {
      expect(() => {
        assertIsValidOctave(9, 'octave');
      }).toThrow(ValidationError);
    });
  });

  describe('Parse helper functions', () => {
    it('parseMeterArray should parse valid meter and return typed', () => {
      const meter = parseMeterArray([4, 4], 'meter');
      expect(meter).toEqual([4, 4]);
    });

    it('parseMeterArray should throw for invalid meter', () => {
      expect(() => {
        parseMeterArray([4, 5]);
      }).toThrow(ValidationError);
    });

    it('parseNoteObject should parse valid note and return typed', () => {
      const note = parseNoteObject({ pitch: 'C', octave: 4, duration: 1 });
      expect(note.pitch).toBe('C');
      expect(note.octave).toBe(4);
    });

    it('parseNoteObject should throw for invalid note', () => {
      expect(() => {
        parseNoteObject({ pitch: 'C', octave: 9, duration: 1 });
      }).toThrow(ValidationError);
    });

    it('parseNoteArray should parse valid array', () => {
      const notes = parseNoteArray([
        { pitch: 'C', octave: 4, duration: 1 },
        { pitch: 'D', octave: 4, duration: 1 },
      ]);
      expect(notes).toHaveLength(2);
    });

    it('parseNoteArray should throw for invalid array', () => {
      expect(() => {
        parseNoteArray([{ pitch: 'C', octave: 9, duration: 1 }]);
      }).toThrow(ValidationError);
    });

    it('parseTempoObject should parse valid tempo', () => {
      const tempo = parseTempoObject({ bpm: 120 });
      expect(tempo.bpm).toBe(120);
    });

    it('parseTempoObject should throw for invalid tempo', () => {
      expect(() => {
        parseTempoObject({ bpm: 400 });
      }).toThrow(ValidationError);
    });
  });

  describe('Type narrowing with assertions', () => {
    it('should narrow type after assertIsValidMeterArray', () => {
      const input: unknown = [4, 4];
      assertIsValidMeterArray(input);
      // After assertion, input is narrowed to MeterArray
      const meter: MeterArray = input;
      expect(meter[0]).toBe(4);
    });

    it('should narrow type after assertIsValidNoteObject', () => {
      const input: unknown = { pitch: 'C', octave: 4, duration: 1 };
      assertIsValidNoteObject(input);
      // After assertion, input is narrowed to NoteObject
      const note: NoteObject = input;
      expect(note.pitch).toBe('C');
    });
  });

  describe('Edge cases and boundary values', () => {
    it('should handle max octave boundary (8)', () => {
      expect(isValidOctave(8)).toBe(true);
      expect(isValidNoteObject({ pitch: 'C', octave: 8, duration: 1 })).toBe(true);
    });

    it('should handle min octave boundary (0)', () => {
      expect(isValidOctave(0)).toBe(true);
      expect(isValidNoteObject({ pitch: 'C', octave: 0, duration: 1 })).toBe(true);
    });

    it('should handle MIDI range boundaries', () => {
      expect(isValidMidiNote(0)).toBe(true);
      expect(isValidMidiNote(127)).toBe(true);
      expect(isValidMidiNote(-1)).toBe(false);
      expect(isValidMidiNote(128)).toBe(false);
    });

    it('should handle tempo boundaries', () => {
      expect(isValidTempoObject({ bpm: 1 })).toBe(true);
      expect(isValidTempoObject({ bpm: 300 })).toBe(true);
      expect(isValidTempoObject({ bpm: 0 })).toBe(false);
      expect(isValidTempoObject({ bpm: 301 })).toBe(false);
    });

    it('should handle smallest duration', () => {
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 0.001 })).toBe(true);
    });

    it('should handle very large duration', () => {
      expect(isValidNoteObject({ pitch: 'C', octave: 4, duration: 1000 })).toBe(true);
    });
  });
});
