/**
 * PolychronError - Centralized error handling system for Polychron
 * Replaces console.warn/error with typed, categorized exceptions
 */

/**
 * Error code categories and codes
 * Used to identify error types programmatically
 */
export enum ErrorCode {
  // TIMING errors
  TIMING_INVALID_BPM = 'TIMING_INVALID_BPM',
  TIMING_INVALID_PPQ = 'TIMING_INVALID_PPQ',
  TIMING_INVALID_METER = 'TIMING_INVALID_METER',
  TIMING_INVALID_TEMPO_CHANGE = 'TIMING_INVALID_TEMPO_CHANGE',
  TIMING_CALCULATION_ERROR = 'TIMING_CALCULATION_ERROR',

  // COMPOSER errors
  COMPOSER_NOT_FOUND = 'COMPOSER_NOT_FOUND',
  COMPOSER_INVALID_CONFIG = 'COMPOSER_INVALID_CONFIG',
  COMPOSER_GENERATION_ERROR = 'COMPOSER_GENERATION_ERROR',
  COMPOSER_INVALID_SCALE = 'COMPOSER_INVALID_SCALE',
  COMPOSER_INVALID_CHORD = 'COMPOSER_INVALID_CHORD',
  COMPOSER_INVALID_MODE = 'COMPOSER_INVALID_MODE',

  // MIDI errors
  MIDI_INVALID_RANGE = 'MIDI_INVALID_RANGE',
  MIDI_INVALID_NOTE = 'MIDI_INVALID_NOTE',
  MIDI_BUFFER_ERROR = 'MIDI_BUFFER_ERROR',
  MIDI_WRITE_ERROR = 'MIDI_WRITE_ERROR',
  MIDI_INVALID_VELOCITY = 'MIDI_INVALID_VELOCITY',

  // VALIDATION errors
  VALIDATION_OCTAVE_RANGE = 'VALIDATION_OCTAVE_RANGE',
  VALIDATION_RHYTHM_PATTERN = 'VALIDATION_RHYTHM_PATTERN',
  VALIDATION_CONFIGURATION = 'VALIDATION_CONFIGURATION',
  VALIDATION_VOICE_LEADING = 'VALIDATION_VOICE_LEADING',

  // GENERAL errors
  INITIALIZATION_ERROR = 'INITIALIZATION_ERROR',
  COMPOSITION_ERROR = 'COMPOSITION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Error context - additional metadata about what was happening when error occurred
 */
export interface PolychronErrorContext {
  module?: string;
  operation?: string;
  value?: any;
  expected?: string;
  received?: string;
  [key: string]: any;
}

/**
 * PolychronError - Base error class with typed code and context
 * Extends Error to maintain instanceof checks and stack traces
 */
export class PolychronError extends Error {
  public readonly code: ErrorCode;
  public readonly context: PolychronErrorContext;

  constructor(
    code: ErrorCode,
    message: string,
    context: PolychronErrorContext = {}
  ) {
    super(message);
    this.name = 'PolychronError';
    this.code = code;
    this.context = context;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, PolychronError.prototype);

    // Capture stack trace (V8 engine)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Returns a detailed error string with code and context
   */
  toString(): string {
    return `PolychronError [${this.code}]: ${this.message}`;
  }

  /**
   * Returns error as structured object (useful for logging/serialization)
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Error factory functions for common error categories
 */

export function timingError(
  message: string,
  code: ErrorCode = ErrorCode.TIMING_CALCULATION_ERROR,
  context?: PolychronErrorContext
): PolychronError {
  return new PolychronError(code, message, {
    module: 'timing',
    ...context,
  });
}

export function composerError(
  message: string,
  code: ErrorCode = ErrorCode.COMPOSER_GENERATION_ERROR,
  context?: PolychronErrorContext
): PolychronError {
  return new PolychronError(code, message, {
    module: 'composer',
    ...context,
  });
}

export function midiError(
  message: string,
  code: ErrorCode = ErrorCode.MIDI_BUFFER_ERROR,
  context?: PolychronErrorContext
): PolychronError {
  return new PolychronError(code, message, {
    module: 'midi',
    ...context,
  });
}

export function validationError(
  message: string,
  code: ErrorCode = ErrorCode.VALIDATION_CONFIGURATION,
  context?: PolychronErrorContext
): PolychronError {
  return new PolychronError(code, message, {
    module: 'validation',
    ...context,
  });
}

/**
 * Helper to check if error is a PolychronError with specific code
 */
export function isPolychronError(
  error: unknown,
  code?: ErrorCode
): error is PolychronError {
  if (!(error instanceof PolychronError)) {
    return false;
  }
  return code ? error.code === code : true;
}

/**
 * Helper to safely extract error message from unknown type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof PolychronError) {
    return error.toString();
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
