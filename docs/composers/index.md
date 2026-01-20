<!--

# composers/index.ts - Composer Module Exports

> **Status**: Module Index
> **Dependencies**: All composer implementations

## Overview

`composers/index.ts` serves as the central export point for all composer classes and types from the composers subdirectory. It re-exports the individual composer implementations to provide a unified interface for importing composition strategies.

**Core Responsibilities:**
- Export all composer classes (GenericComposer, MeasureComposer, ScaleComposer, etc.)
- Provide convenient aggregated imports for composer consumers
- Maintain consistent API surface for composition framework

## Architecture Role

The composers module serves as the **composition strategy factory**:
- **play.ts** ([code](../../src/play.ts)) ([doc](../play.md)) - Uses composers to generate musical content
- **ComposerRegistry.ts** ([code](../../src/ComposerRegistry.ts)) ([doc](../ComposerRegistry.md)) - Registers and instantiates composers
- **Individual composers** - Specialized implementations for different compositional approaches

---

## Related Modules

- [GenericComposer.ts](GenericComposer.md) - Base implementation for custom composers
- [MeasureComposer.ts](MeasureComposer.md) - Meter and division generation
- [ScaleComposer.ts](ScaleComposer.md) - Scale-based note generation
- [ModeComposer.ts](ModeComposer.md) - Mode-based composition
- [ChordComposer.ts](ChordComposer.md) - Chord progression composition
- [PentatonicComposer.ts](PentatonicComposer.md) - Pentatonic scale specialist
- [ProgressionGenerator.ts](ProgressionGenerator.md) - Advanced progression generation
- [ComposerRegistry.ts](../ComposerRegistry.md) - Composer registration and management
