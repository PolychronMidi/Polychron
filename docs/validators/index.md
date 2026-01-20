<!--

# validators/index.ts - Type Guards & Validation Layer

> **Status**: Core Utility
> **Dependencies**: None (standalone)

## Overview

`validators/index.ts` provides type guards, assertion functions, and comprehensive validation for Polychron's core types. It uses TypeScript's `is` and `asserts` keywords for proper type narrowing and runtime type checking.

**Core Responsibilities:**
- Type guards for notes, meters, tempos, and compositions
- Validation error reporting with path information
- Runtime assertion functions for defensive programming
- Support for optional and extended property validation

## Architecture Role

The validators module serves as the **type safety enforcement layer**:
- **ComposerRegistry.ts** ([code](../../src/ComposerRegistry.ts)) ([doc](../ComposerRegistry.md)) - Validates composer configurations
- **play.ts** ([code](../../src/play.ts)) ([doc](../play.md)) - Validates composition state
- **Sheet.ts** ([code](../../src/sheet.ts)) ([doc](../sheet.md)) - Validates musical parameters
- **All test files** - Use validators to assert type correctness

---

## Key Types

- `ValidationError` - Custom error with path tracking
- `NoteObject` - Pitch, octave, duration structure
- `MeterArray` - [beats, noteValue] tuple
- `TempoObject` - BPM with optional tempo changes

---

## Related Modules

- [validators.md](../validators.md) - Full validator function documentation
- [sheet.ts](../sheet.ts) - Configuration that gets validated
- [ComposerRegistry.ts](../ComposerRegistry.md) - Uses validation for type safety
