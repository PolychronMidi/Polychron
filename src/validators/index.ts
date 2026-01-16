/**
 * Type Guards & Validation Layer for Polychron
 * Provides type guards, assertion functions, and validation for core types
 * Uses TypeScript 'is' and 'asserts' keywords for proper type narrowing
 */

/**
 * Custom validation error with path information
 */
export class ValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`[${path}] ${message}`);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Note representation - minimal interface for type guards
 */
export interface NoteObject {
  pitch: string;
  octave: number;
  duration: number;
  velocity?: number;
  [key: string]: any;
}

/**
 * Meter representation - array of [beats, noteValue]
 */
export type MeterArray = [number, number];

/**
 * Tempo object with BPM and optional changes
 */
export interface TempoObject {
  bpm: number;
  tempoChanges?: Array<{ measure: number; bpm: number }>;
  [key: string]: any;
}

/**
 * Type guard: Is value a valid note object?
 * Validates structure: pitch (string), octave (number 0-8), duration (number > 0)
 */
export function isValidNoteObject(value: unknown): value is NoteObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, any>;

  // Check required fields
  if (typeof obj.pitch !== 'string' || !obj.pitch.trim()) {
    return false;
  }

  if (
    typeof obj.octave !== 'number' ||
    !Number.isInteger(obj.octave) ||
    obj.octave < 0 ||
    obj.octave > 8
  ) {
    return false;
  }

  if (typeof obj.duration !== 'number' || obj.duration <= 0) {
    return false;
  }

  // Optional velocity should be 0-127 if present
  if (obj.velocity !== undefined) {
    if (
      typeof obj.velocity !== 'number' ||
      !Number.isInteger(obj.velocity) ||
      obj.velocity < 0 ||
      obj.velocity > 127
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard: Is value an array of valid notes?
 */
export function isValidNoteArray(value: unknown): value is NoteObject[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) => isValidNoteObject(item));
}

/**
 * Type guard: Is value a valid meter array [beats, noteValue]?
 */
export function isValidMeterArray(value: unknown): value is MeterArray {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }

  const [beats, noteValue] = value;

  // Beats should be positive integer (typically 2-12)
  if (typeof beats !== 'number' || beats < 1 || !Number.isInteger(beats)) {
    return false;
  }

  // Note value should be power of 2 (1, 2, 4, 8, 16, 32)
  if (
    typeof noteValue !== 'number' ||
    noteValue < 1 ||
    !Number.isInteger(noteValue) ||
    (noteValue & (noteValue - 1)) !== 0 // Check if power of 2
  ) {
    return false;
  }

  return true;
}

/**
 * Type guard: Is value a valid tempo object?
 */
export function isValidTempoObject(value: unknown): value is TempoObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, any>;

  // BPM must be number between 1 and 300
  if (typeof obj.bpm !== 'number' || obj.bpm < 1 || obj.bpm > 300) {
    return false;
  }

  // Tempo changes optional, but if present should be array of {measure, bpm}
  if (obj.tempoChanges !== undefined) {
    if (!Array.isArray(obj.tempoChanges)) {
      return false;
    }

    for (const change of obj.tempoChanges) {
      if (typeof change !== 'object' || change === null) {
        return false;
      }
      if (typeof change.measure !== 'number' || change.measure < 0) {
        return false;
      }
      if (typeof change.bpm !== 'number' || change.bpm < 1 || change.bpm > 300) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Type guard: Is value a valid MIDI note number (0-127)?
 */
export function isValidMidiNote(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 127 && Number.isInteger(value);
}

/**
 * Type guard: Is value a valid MIDI velocity (0-127)?
 */
export function isValidMidiVelocity(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 127 && Number.isInteger(value);
}

/**
 * Type guard: Is value a valid octave (0-8)?
 */
export function isValidOctave(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 8 && Number.isInteger(value);
}

/**
 * Assertion function: Asserts value is valid note object, throws if not
 * Enables type narrowing in following code
 */
export function assertIsValidNoteObject(
  value: unknown,
  path: string = 'note'
): asserts value is NoteObject {
  if (!isValidNoteObject(value)) {
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, any>;
      if (typeof obj.pitch !== 'string' || !obj.pitch.trim()) {
        throw new ValidationError(path, 'pitch must be a non-empty string');
      }
      if (typeof obj.octave !== 'number') {
        throw new ValidationError(path, 'octave must be a number');
      }
      if (obj.octave < 0 || obj.octave > 8) {
        throw new ValidationError(path, 'octave must be between 0 and 8');
      }
      if (typeof obj.duration !== 'number') {
        throw new ValidationError(path, 'duration must be a number');
      }
      if (obj.duration <= 0) {
        throw new ValidationError(path, 'duration must be greater than 0');
      }
      if (obj.velocity !== undefined) {
        if (typeof obj.velocity !== 'number') {
          throw new ValidationError(path, 'velocity must be a number');
        }
        if (obj.velocity < 0 || obj.velocity > 127) {
          throw new ValidationError(path, 'velocity must be between 0 and 127');
        }
      }
    }
    throw new ValidationError(path, 'must be a valid note object');
  }
}

/**
 * Assertion function: Asserts value is array of valid notes
 */
export function assertIsValidNoteArray(
  value: unknown,
  path: string = 'notes'
): asserts value is NoteObject[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(path, 'must be an array');
  }

  for (let i = 0; i < value.length; i++) {
    try {
      assertIsValidNoteObject(value[i], `${path}[${i}]`);
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Assertion function: Asserts value is valid meter array
 */
export function assertIsValidMeterArray(
  value: unknown,
  path: string = 'meter'
): asserts value is MeterArray {
  if (!Array.isArray(value)) {
    throw new ValidationError(path, 'must be an array');
  }

  if (value.length !== 2) {
    throw new ValidationError(path, 'must have exactly 2 elements [beats, noteValue]');
  }

  const [beats, noteValue] = value;

  if (typeof beats !== 'number' || !Number.isInteger(beats)) {
    throw new ValidationError(path + '[0]', 'beats must be an integer');
  }

  if (beats < 1) {
    throw new ValidationError(path + '[0]', 'beats must be at least 1');
  }

  if (typeof noteValue !== 'number' || !Number.isInteger(noteValue)) {
    throw new ValidationError(path + '[1]', 'noteValue must be an integer');
  }

  if (noteValue < 1) {
    throw new ValidationError(path + '[1]', 'noteValue must be at least 1');
  }

  if ((noteValue & (noteValue - 1)) !== 0) {
    throw new ValidationError(path + '[1]', 'noteValue must be a power of 2 (1, 2, 4, 8, 16, 32)');
  }
}

/**
 * Assertion function: Asserts value is valid tempo object
 */
export function assertIsValidTempoObject(
  value: unknown,
  path: string = 'tempo'
): asserts value is TempoObject {
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError(path, 'must be an object');
  }

  const obj = value as Record<string, any>;

  if (typeof obj.bpm !== 'number') {
    throw new ValidationError(path + '.bpm', 'must be a number');
  }

  if (obj.bpm < 1 || obj.bpm > 300) {
    throw new ValidationError(path + '.bpm', 'must be between 1 and 300');
  }

  if (obj.tempoChanges !== undefined) {
    if (!Array.isArray(obj.tempoChanges)) {
      throw new ValidationError(path + '.tempoChanges', 'must be an array');
    }

    for (let i = 0; i < obj.tempoChanges.length; i++) {
      const change = obj.tempoChanges[i];
      if (typeof change !== 'object' || change === null) {
        throw new ValidationError(
          path + `.tempoChanges[${i}]`,
          'must be an object'
        );
      }
      if (typeof change.measure !== 'number' || !Number.isInteger(change.measure)) {
        throw new ValidationError(
          path + `.tempoChanges[${i}].measure`,
          'must be an integer'
        );
      }
      if (change.measure < 0) {
        throw new ValidationError(
          path + `.tempoChanges[${i}].measure`,
          'must be non-negative'
        );
      }
      if (typeof change.bpm !== 'number') {
        throw new ValidationError(
          path + `.tempoChanges[${i}].bpm`,
          'must be a number'
        );
      }
      if (change.bpm < 1 || change.bpm > 300) {
        throw new ValidationError(
          path + `.tempoChanges[${i}].bpm`,
          'must be between 1 and 300'
        );
      }
    }
  }
}

/**
 * Assertion function: Asserts value is valid MIDI note
 */
export function assertIsValidMidiNote(
  value: unknown,
  path: string = 'midiNote'
): asserts value is number {
  if (!isValidMidiNote(value)) {
    throw new ValidationError(path, 'must be an integer between 0 and 127');
  }
}

/**
 * Assertion function: Asserts value is valid octave
 */
export function assertIsValidOctave(
  value: unknown,
  path: string = 'octave'
): asserts value is number {
  if (!isValidOctave(value)) {
    throw new ValidationError(path, 'must be an integer between 0 and 8');
  }
}

/**
 * Safe parse meter array with detailed error path
 * Returns parsed meter or throws ValidationError with path info
 */
export function parseMeterArray(value: unknown, path: string = 'meter'): MeterArray {
  assertIsValidMeterArray(value, path);
  return value;
}

/**
 * Safe parse note object with detailed error path
 */
export function parseNoteObject(value: unknown, path: string = 'note'): NoteObject {
  assertIsValidNoteObject(value, path);
  return value;
}

/**
 * Safe parse note array with detailed error path
 */
export function parseNoteArray(value: unknown, path: string = 'notes'): NoteObject[] {
  assertIsValidNoteArray(value, path);
  return value;
}

/**
 * Safe parse tempo object with detailed error path
 */
export function parseTempoObject(value: unknown, path: string = 'tempo'): TempoObject {
  assertIsValidTempoObject(value, path);
  return value;
}
