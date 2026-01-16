import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  PolychronError,
  PolychronErrorContext,
  timingError,
  composerError,
  midiError,
  validationError,
  isPolychronError,
  getErrorMessage,
} from '../src/PolychronError';

describe('PolychronError System', () => {
  describe('ErrorCode enum', () => {
    it('should have TIMING error codes', () => {
      expect(ErrorCode.TIMING_INVALID_BPM).toBe('TIMING_INVALID_BPM');
      expect(ErrorCode.TIMING_INVALID_PPQ).toBe('TIMING_INVALID_PPQ');
      expect(ErrorCode.TIMING_INVALID_METER).toBe('TIMING_INVALID_METER');
      expect(ErrorCode.TIMING_INVALID_TEMPO_CHANGE).toBe(
        'TIMING_INVALID_TEMPO_CHANGE'
      );
      expect(ErrorCode.TIMING_CALCULATION_ERROR).toBe(
        'TIMING_CALCULATION_ERROR'
      );
    });

    it('should have COMPOSER error codes', () => {
      expect(ErrorCode.COMPOSER_NOT_FOUND).toBe('COMPOSER_NOT_FOUND');
      expect(ErrorCode.COMPOSER_INVALID_CONFIG).toBe(
        'COMPOSER_INVALID_CONFIG'
      );
      expect(ErrorCode.COMPOSER_GENERATION_ERROR).toBe(
        'COMPOSER_GENERATION_ERROR'
      );
      expect(ErrorCode.COMPOSER_INVALID_SCALE).toBe('COMPOSER_INVALID_SCALE');
      expect(ErrorCode.COMPOSER_INVALID_CHORD).toBe('COMPOSER_INVALID_CHORD');
      expect(ErrorCode.COMPOSER_INVALID_MODE).toBe('COMPOSER_INVALID_MODE');
    });

    it('should have MIDI error codes', () => {
      expect(ErrorCode.MIDI_INVALID_RANGE).toBe('MIDI_INVALID_RANGE');
      expect(ErrorCode.MIDI_INVALID_NOTE).toBe('MIDI_INVALID_NOTE');
      expect(ErrorCode.MIDI_BUFFER_ERROR).toBe('MIDI_BUFFER_ERROR');
      expect(ErrorCode.MIDI_WRITE_ERROR).toBe('MIDI_WRITE_ERROR');
      expect(ErrorCode.MIDI_INVALID_VELOCITY).toBe('MIDI_INVALID_VELOCITY');
    });

    it('should have VALIDATION error codes', () => {
      expect(ErrorCode.VALIDATION_OCTAVE_RANGE).toBe(
        'VALIDATION_OCTAVE_RANGE'
      );
      expect(ErrorCode.VALIDATION_RHYTHM_PATTERN).toBe(
        'VALIDATION_RHYTHM_PATTERN'
      );
      expect(ErrorCode.VALIDATION_CONFIGURATION).toBe(
        'VALIDATION_CONFIGURATION'
      );
      expect(ErrorCode.VALIDATION_VOICE_LEADING).toBe(
        'VALIDATION_VOICE_LEADING'
      );
    });

    it('should have general error codes', () => {
      expect(ErrorCode.INITIALIZATION_ERROR).toBe('INITIALIZATION_ERROR');
      expect(ErrorCode.COMPOSITION_ERROR).toBe('COMPOSITION_ERROR');
      expect(ErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });
  });

  describe('PolychronError class', () => {
    it('should create error with code and message', () => {
      const error = new PolychronError(
        ErrorCode.TIMING_INVALID_BPM,
        'BPM must be between 1 and 300'
      );

      expect(error.code).toBe(ErrorCode.TIMING_INVALID_BPM);
      expect(error.message).toBe('BPM must be between 1 and 300');
      expect(error.name).toBe('PolychronError');
    });

    it('should create error with context', () => {
      const context = {
        module: 'timing',
        value: -5,
        expected: 'positive number',
      };
      const error = new PolychronError(
        ErrorCode.TIMING_INVALID_BPM,
        'Invalid BPM',
        context
      );

      expect(error.context).toEqual(context);
      expect(error.context.module).toBe('timing');
      expect(error.context.value).toBe(-5);
    });

    it('should maintain instanceof checks', () => {
      const error = new PolychronError(
        ErrorCode.COMPOSITION_ERROR,
        'Composition failed'
      );

      expect(error instanceof PolychronError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should have stack trace', () => {
      const error = new PolychronError(
        ErrorCode.COMPOSITION_ERROR,
        'Test error'
      );
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('PolychronError');
    });

    it('should return detailed string representation', () => {
      const error = new PolychronError(
        ErrorCode.MIDI_INVALID_NOTE,
        'Note C9 is out of MIDI range'
      );

      const str = error.toString();
      expect(str).toContain('PolychronError');
      expect(str).toContain('MIDI_INVALID_NOTE');
      expect(str).toContain('Note C9 is out of MIDI range');
    });

    it('should serialize to JSON', () => {
      const context = {
        module: 'writer',
        note: 'C9',
        midiRange: '[0, 127]',
      };
      const error = new PolychronError(
        ErrorCode.MIDI_INVALID_NOTE,
        'Note out of range',
        context
      );

      const json = error.toJSON();
      expect(json.name).toBe('PolychronError');
      expect(json.code).toBe(ErrorCode.MIDI_INVALID_NOTE);
      expect(json.message).toBe('Note out of range');
      expect(json.context).toEqual(context);
      expect(json.stack).toBeDefined();
    });
  });

  describe('Error factory functions', () => {
    it('timingError() creates error with TIMING module context', () => {
      const error = timingError('BPM out of range', ErrorCode.TIMING_INVALID_BPM, {
        value: 500,
      });

      expect(error.code).toBe(ErrorCode.TIMING_INVALID_BPM);
      expect(error.context.module).toBe('timing');
      expect(error.context.value).toBe(500);
    });

    it('timingError() uses default error code', () => {
      const error = timingError('Calculation failed');

      expect(error.code).toBe(ErrorCode.TIMING_CALCULATION_ERROR);
      expect(error.context.module).toBe('timing');
    });

    it('composerError() creates error with COMPOSER module context', () => {
      const error = composerError('Scale not found', ErrorCode.COMPOSER_INVALID_SCALE, {
        scale: 'dorian',
      });

      expect(error.code).toBe(ErrorCode.COMPOSER_INVALID_SCALE);
      expect(error.context.module).toBe('composer');
      expect(error.context.scale).toBe('dorian');
    });

    it('composerError() uses default error code', () => {
      const error = composerError('Generation failed');

      expect(error.code).toBe(ErrorCode.COMPOSER_GENERATION_ERROR);
      expect(error.context.module).toBe('composer');
    });

    it('midiError() creates error with MIDI module context', () => {
      const error = midiError('Invalid velocity', ErrorCode.MIDI_INVALID_VELOCITY, {
        velocity: 200,
        range: '[0, 127]',
      });

      expect(error.code).toBe(ErrorCode.MIDI_INVALID_VELOCITY);
      expect(error.context.module).toBe('midi');
      expect(error.context.velocity).toBe(200);
    });

    it('midiError() uses default error code', () => {
      const error = midiError('Write failed');

      expect(error.code).toBe(ErrorCode.MIDI_BUFFER_ERROR);
      expect(error.context.module).toBe('midi');
    });

    it('validationError() creates error with VALIDATION module context', () => {
      const error = validationError(
        'Meter format invalid',
        ErrorCode.VALIDATION_RHYTHM_PATTERN,
        { meter: '10/4' }
      );

      expect(error.code).toBe(ErrorCode.VALIDATION_RHYTHM_PATTERN);
      expect(error.context.module).toBe('validation');
      expect(error.context.meter).toBe('10/4');
    });

    it('validationError() uses default error code', () => {
      const error = validationError('Config invalid');

      expect(error.code).toBe(ErrorCode.VALIDATION_CONFIGURATION);
      expect(error.context.module).toBe('validation');
    });
  });

  describe('isPolychronError() type guard', () => {
    it('should identify PolychronError instances', () => {
      const error = new PolychronError(
        ErrorCode.COMPOSITION_ERROR,
        'Test'
      );

      expect(isPolychronError(error)).toBe(true);
    });

    it('should reject regular Error instances', () => {
      const error = new Error('Regular error');

      expect(isPolychronError(error)).toBe(false);
    });

    it('should reject non-Error values', () => {
      expect(isPolychronError('string error')).toBe(false);
      expect(isPolychronError(123)).toBe(false);
      expect(isPolychronError(null)).toBe(false);
      expect(isPolychronError(undefined)).toBe(false);
    });

    it('should filter by specific error code', () => {
      const error1 = new PolychronError(
        ErrorCode.MIDI_INVALID_NOTE,
        'Test'
      );
      const error2 = new PolychronError(
        ErrorCode.MIDI_INVALID_VELOCITY,
        'Test'
      );

      expect(isPolychronError(error1, ErrorCode.MIDI_INVALID_NOTE)).toBe(true);
      expect(isPolychronError(error1, ErrorCode.MIDI_INVALID_VELOCITY)).toBe(
        false
      );
      expect(isPolychronError(error2, ErrorCode.MIDI_INVALID_VELOCITY)).toBe(
        true
      );
    });
  });

  describe('getErrorMessage() helper', () => {
    it('should extract message from PolychronError', () => {
      const error = new PolychronError(
        ErrorCode.COMPOSITION_ERROR,
        'Composition failed'
      );

      const msg = getErrorMessage(error);
      expect(msg).toContain('COMPOSITION_ERROR');
      expect(msg).toContain('Composition failed');
    });

    it('should extract message from regular Error', () => {
      const error = new Error('Regular error message');

      expect(getErrorMessage(error)).toBe('Regular error message');
    });

    it('should convert string errors', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('should convert number errors', () => {
      expect(getErrorMessage(42)).toBe('42');
    });

    it('should handle null/undefined gracefully', () => {
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should convert object errors to string', () => {
      const obj = { error: 'details' };
      const msg = getErrorMessage(obj);
      // String(obj) returns "[object Object]" - that's the expected behavior
      expect(msg).toBe('[object Object]');
    });
  });

  describe('Error context preservation', () => {
    it('should preserve complex context objects', () => {
      const context = {
        module: 'stage',
        operation: 'processNotes',
        noteData: {
          pitch: 'C',
          octave: 9,
          duration: 0.5,
        },
        allowedRange: {
          min: 0,
          max: 127,
        },
      };

      const error = new PolychronError(
        ErrorCode.MIDI_INVALID_NOTE,
        'Note out of range',
        context
      );

      expect(error.context.noteData.pitch).toBe('C');
      expect(error.context.allowedRange.max).toBe(127);
    });

    it('should allow adding properties to context', () => {
      const error = new PolychronError(
        ErrorCode.COMPOSITION_ERROR,
        'Failed',
        { module: 'main' }
      );

      error.context.additionalInfo = 'More details';
      expect(error.context.additionalInfo).toBe('More details');
    });
  });

  describe('Error recovery patterns', () => {
    it('should enable typed error catching', () => {
      let caughtError: PolychronError | null = null;

      try {
        throw composerError('Scale not found', ErrorCode.COMPOSER_INVALID_SCALE);
      } catch (error) {
        if (isPolychronError(error, ErrorCode.COMPOSER_INVALID_SCALE)) {
          caughtError = error;
        }
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.code).toBe(ErrorCode.COMPOSER_INVALID_SCALE);
    });

    it('should enable error type discrimination', () => {
      const errors: PolychronError[] = [
        timingError('BPM invalid'),
        composerError('Scale not found'),
        midiError('Out of range'),
      ];

      const timingErrors = errors.filter((e) =>
        isPolychronError(e, ErrorCode.TIMING_CALCULATION_ERROR)
      );
      const composerErrors = errors.filter((e) =>
        isPolychronError(e, ErrorCode.COMPOSER_GENERATION_ERROR)
      );
      const midiErrors = errors.filter((e) =>
        isPolychronError(e, ErrorCode.MIDI_BUFFER_ERROR)
      );

      expect(timingErrors).toHaveLength(1);
      expect(composerErrors).toHaveLength(1);
      expect(midiErrors).toHaveLength(1);
    });
  });

  describe('Error chaining', () => {
    it('should store original error in context', () => {
      const originalError = new Error('File not found');
      const polychronError = new PolychronError(
        ErrorCode.INITIALIZATION_ERROR,
        'Failed to load config',
        { originalError }
      );

      expect(polychronError.context.originalError).toBe(originalError);
    });
  });
});
