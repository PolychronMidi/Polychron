# ComposerRegistry (src/ComposerRegistry.ts)

- Source: ../src/ComposerRegistry.ts
- Area: Registration and lookup of composer implementations.

## Overview
Central registry for composer constructors and factory helpers to create composer instances from config.

## Key Exports
- ComposerRegistry
- Registration/lookup helpers

## Usage
```ts
import { ComposerRegistry } from '../src/ComposerRegistry';
// register or resolve composers by type
```

## Integration Notes
- Works with `src/composers.ts` side-effect registrations.

## Tests
- test/ComposerRegistry.test.ts
- test/composers/ComposerFactory.test.ts

## Related (old docs)
- docs_old/composers.md

## Changelog
- TODO
