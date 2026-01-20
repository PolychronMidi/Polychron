# composers.ts - Composer Module Stub

> **Status**: Root Export Stub  
> **Purpose**: Re-export all composers and registry from global scope for downstream imports


## Overview

`composers.ts` is a stub module that re-exports composer classes and the registry from the global scope. It allows downstream modules to import composers via a single stable entry point rather than from the internal `composers/` subdirectory.

**Core Responsibilities:**
- Import `composers/index.js` to populate global scope with all composer classes
- Import `ComposerRegistry.js` to make the registry available globally
- Re-export all composers (MeasureComposer, ScaleComposer, ChordComposer, ModeComposer, PentatonicComposer) and registry
- Provide backward compatibility via legacy `ComposerFactory` export

---

## API

### Exported Composers

All composers are re-exported from `composers/`:

- `MeasureComposer` ([code](../src/composers/MeasureComposer.ts)) ([doc](composers/MeasureComposer.md)) – Measures and rhythm-based composition
- `ScaleComposer` ([code](../src/composers/ScaleComposer.ts)) ([doc](composers/ScaleComposer.md)) – Scale-degree note selection
- `ChordComposer` ([code](../src/composers/ChordComposer.ts)) ([doc](composers/ChordComposer.md)) – Chord-based composition with progressions
- `ModeComposer` ([code](../src/composers/ModeComposer.ts)) ([doc](composers/ModeComposer.md)) – Modal composition with motifs
- `PentatonicComposer` ([code](../src/composers/PentatonicComposer.ts)) ([doc](composers/PentatonicComposer.md)) – Pentatonic scale composition

### Registry

- `ComposerRegistry` ([code](../src/ComposerRegistry.ts)) ([doc](ComposerRegistry.md)) – Typed registry for instantiating composers by name

### Legacy Support

- `ComposerFactory` – Legacy factory function (re-exported for backward compatibility)
- `Composer` – Base composer interface (re-exported from global scope)

---

## Usage Example

```typescript
import { ComposerRegistry, MeasureComposer } from '../src/composers';

const registry = ComposerRegistry.getInstance();
const config = { type: 'MeasureComposer', numerator: 4, denominator: 4 };
const composer = registry.create(config);
```

---

## Related Modules

- composers/ subdirectory ([code](../src/composers/)) ([doc](composers.md)) - Individual composer implementations
- ComposerRegistry.ts ([code](../src/ComposerRegistry.ts)) ([doc](ComposerRegistry.md)) - Typed registration system
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Uses composers during section/phrase generation
