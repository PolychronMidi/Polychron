# PolychronError.ts - Error Handling System

> **Status**: Core Error Utilities  
> **Purpose**: Centralized, typed error handling replacing console.warn/error


## Overview

`PolychronError.ts` provides a centralized error handling system with categorized error codes, context metadata, and factory functions. It replaces ad-hoc console warnings with properly typed exceptions that can be caught, logged, and reported.

**Core Responsibilities:**
- Define error code categories (TIMING, COMPOSER, MIDI, VALIDATION, GENERAL)
- Provide `PolychronError` class with code, message, and context tracking
- Export factory functions for common error categories (`timingError`, `composerError`, `midiError`, `validationError`)
- Provide type guards and error message extraction utilities
- Maintain proper stack traces and instanceof checks

---

## API

### `enum ErrorCode`

Error categories and specific codes:

**Categories:**
- **TIMING**: BPM, PPQ, meter, tempo change, calculation
- **COMPOSER**: Not found, invalid config, generation, scale/chord/mode errors
- **MIDI**: Range, note, buffer, write, velocity errors
- **VALIDATION**: Octave range, rhythm pattern, configuration, voice leading
- **GENERAL**: Initialization, composition, unknown

### `class PolychronError`

Extends Error with code and context metadata.

<!-- BEGIN: snippet:PolychronError -->

```typescript
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
```

<!-- END: snippet:PolychronError -->

#### Constructor

```typescript
constructor(code: ErrorCode, message: string, context?: PolychronErrorContext)
```

### Factory Functions

#### Factory Functions

- `timingError(message, code?, context?)` – Create timing-category error
- `composerError(message, code?, context?)` – Create composer-category error  
- `midiError(message, code?, context?)` – Create MIDI-category error
- `validationError(message, code?, context?)` – Create validation-category error

### Utilities

#### Utilities

- `isPolychronError(error, code?)` – Type guard to check if error is PolychronError
- `getErrorMessage(error)` – Safely extract error message from unknown error type

### `interface PolychronErrorContext`

Optional metadata object with error context:

```typescript
interface PolychronErrorContext {
  module?: string;        // Which module threw the error
  operation?: string;     // What operation was being performed
  value?: any;           // The problematic value
  expected?: string;     // What was expected
  received?: string;     // What was received
  [key: string]: any;    // Custom fields
}
```

---

## Usage Example

```typescript
import { composerError, ErrorCode, isPolychronError } from '../src/PolychronError';

try {
  const config = parseComposerConfig(userInput);
  if (!config.scale) {
    throw composerError(
      'Scale must be defined in composer config',
      ErrorCode.COMPOSER_INVALID_SCALE,
      { module: 'GenericComposer', operation: 'init', received: config }
    );
  }
} catch (err) {
  if (isPolychronError(err, ErrorCode.COMPOSER_INVALID_SCALE)) {
    console.error(`Composer config error: ${err.message}`);
    console.error(`Context:`, err.context);
  } else {
    throw err;
  }
}
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Throws errors during initialization/composition
- composers/ ([code](../src/composers/)) ([doc](composers.md)) - Uses composer errors
- CompositionProgress.ts ([code](../src/CompositionProgress.ts)) ([doc](CompositionProgress.md)) - Can report errors via callbacks
