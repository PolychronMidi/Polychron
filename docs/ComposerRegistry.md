# ComposerRegistry.ts - Composer Registration and Factory Hub

> **Source**: `src/ComposerRegistry.ts`  \
> **Status**: Core Registry  \
> **Dependencies**: composers.ts (types), global composer classes

## Overview

`ComposerRegistry.ts` is the singleton registry that wires composer **type keys** (e.g., `scale`, `chords`, `mode`) to factory functions that construct composers. It centralizes registration, lookup, and default wiring for built-in composers while allowing custom composer injection.

**Core Responsibilities:**
- Maintain a map of composer type → factory
- Provide `create()` to instantiate composers from config objects
- Auto-register built-in composers via `registerDefaults()` on first use
- Expose test-friendly utilities (`clear()`, `getTypes()`, `has()`) for validation

## Architecture Role

- Used by play.ts ([code](../src/play.ts)) ([doc](play.md)) during orchestration to obtain composer instances per section/phrase
- Bridges configuration (type strings) to concrete composer implementations defined in composers.ts and its submodules
- Supports test isolation by allowing registry reset between runs

---

## API

### `interface ComposerConfig`

Configuration object accepted by `create()`. Must contain a `type` key plus type-specific options.

<!-- BEGIN: snippet:ComposerConfig -->

```typescript
export interface ComposerConfig {
  type: string;
  [key: string]: any;
}
```

<!-- END: snippet:ComposerConfig -->

### `interface ComposerClass`

Constructor signature for composer classes.

<!-- BEGIN: snippet:ComposerClass -->

```typescript
export interface ComposerClass {
  new(...args: any[]): any;
}
```

<!-- END: snippet:ComposerClass -->

### `type ComposerFactory`

Factory function signature for creating composers.

<!-- BEGIN: snippet:ComposerFactory -->

```typescript
export type ComposerFactory = (config: any) => any;
```

<!-- END: snippet:ComposerFactory -->

### `class ComposerRegistry`

Singleton registry that stores composer factories and creates instances from configs.

<!-- BEGIN: snippet:ComposerRegistry -->

```typescript
export class ComposerRegistry {
  private static instance: ComposerRegistry;
  private composers = new Map<string, ComposerFactory>();

  /**
   * Private constructor prevents direct instantiation
   */
  private constructor() {
    // Private to enforce singleton pattern
  }

  /**
   * Get the singleton instance, initializing with defaults if needed
   */
  static getInstance(): ComposerRegistry {
    if (!this.instance) {
      this.instance = new ComposerRegistry();
      this.instance.registerDefaults();
    }
    return this.instance;
  }

  /**
   * Register a composer factory function by type string
   * @param type - The composer type identifier (e.g., 'scale', 'chord')
   * @param factory - Factory function that creates a composer instance
   */
  register(type: string, factory: ComposerFactory): void {
    this.composers.set(type, factory);
  }

  /**
   * Create a composer instance from a config object
   * @param config - Config with 'type' property and type-specific options
   * @returns Composer instance
   * @throws Error if composer type is not registered
   */
  create(config: ComposerConfig): any {
    const type = config.type;
    const factory = this.composers.get(type);

    if (!factory) {
      throw new Error(`ComposerRegistry: No factory registered for type '${type}'`);
    }

    // Create instance using registered factory
    const inst = factory(config);

    // STRICT MODE (targeted): For a small set of timing-focused composer types, fail fast when required timing APIs are missing.
    const timingTypes = new Set([ 'measure', 'harmonicRhythm', 'tensionRelease', 'modalInterchange', 'melodicDevelopment', 'advancedVoiceLeading' ]);
    if (timingTypes.has(type)) {
      const missing: string[] = [];
      if (!inst || typeof inst !== 'object') missing.push('instance');
      if (inst && typeof inst.getMeter !== 'function') missing.push('getMeter');
      if (inst && typeof inst.getDivisions !== 'function') missing.push('getDivisions');
      if (inst && typeof inst.getSubdivisions !== 'function') missing.push('getSubdivisions');
      if (inst && typeof inst.getVoices !== 'function') missing.push('getVoices');

      if (missing.length > 0) {
        throw new Error(`ComposerRegistry: Composer of type '${type}' is missing required API methods: ${missing.join(', ')}`);
      }
    }

    return inst;
  }

  /**
   * Check if a composer type is registered
   */
  has(type: string): boolean {
    return this.composers.has(type);
  }

  /**
   * Get all registered composer types
   */
  getTypes(): string[] {
    return Array.from(this.composers.keys());
  }

  /**
   * Clear all registered composers (useful for testing)
   */
  clear(): void {
    this.composers.clear();
  }

  /**
   * Register default composers from the composers module.
   * This method is called automatically on first getInstance().
   * It registers factory functions for all built-in composer types.
   */
  private registerDefaults(): void {
    // Register only composers provided via DI (PolychronContext.composers). Do NOT perform runtime fallbacks.
    const composersMap = poly.composers || {} as any;

    if (composersMap.MeasureComposer) {
      this.register('measure', () => {
        const inst = new (composersMap.MeasureComposer as any)();
        (inst as any).type = 'measure';
        return inst;
      });
    }

    if (composersMap.ScaleComposer) {
      this.register('scale', ({ name = 'major', root = 'C' } = {}) => {
        return new (composersMap.ScaleComposer as any)(name, root);
      });
    }

    if (composersMap.ChordComposer) {
      this.register('chords', ({ progression = ['C'] } = {}) => {
        // Support special string 'random' for progressions: prefer DI-provided RandomChordComposer if available
        if (typeof progression === 'string' && progression === 'random') {
          if (composersMap.RandomChordComposer) {
            return new (composersMap.RandomChordComposer as any)();
          }
          // Fallback: generate a safe random progression using venue chord list (best-effort)
          try {
            // Lazy import to avoid module cycles
            const { allChords } = require('./venue.js');
            const len = Math.floor(Math.random() * 4) + 2; // 2..5
            const p: string[] = [];
            for (let i = 0; i < len; i++) { p.push(allChords[Math.floor(Math.random() * allChords.length)]); }
            return new (composersMap.ChordComposer as any)(p);
          } catch (_e) {
            // Last resort: use a safe default progression
            return new (composersMap.ChordComposer as any)(['Cmaj']);
          }
        }

        const p = Array.isArray(progression) ? progression : [String(progression || 'C')];
        return new (composersMap.ChordComposer as any)(p);
      });
    }

    if (composersMap.ModeComposer) {
      this.register('mode', ({ name = 'ionian', root = 'C' } = {}) => {
        return new (composersMap.ModeComposer as any)(name, root);
      });
    }

    if (composersMap.PentatonicComposer) {
      this.register('pentatonic', ({ root = 'C', scaleType = 'major' } = {}) => {
        const inst = new (composersMap.PentatonicComposer as any)(root, scaleType);
        (inst as any).type = 'pentatonic';
        (inst as any).scaleType = scaleType;
        return inst;
      });
    }

    // Advanced composers are optional and only registered when DI provides them
    if (composersMap.TensionReleaseComposer) {
      this.register('tensionRelease', ({ key = 'C', quality = 'major', tensionCurve = 0.5 } = {}) => {
        return new (composersMap.TensionReleaseComposer as any)(key, quality, tensionCurve);
      });
    }

    if (composersMap.ModalInterchangeComposer) {
      this.register('modalInterchange', ({ key = 'C', primaryMode = 'major', borrowProbability = 0.25 } = {}) => {
        return new (composersMap.ModalInterchangeComposer as any)(key, primaryMode, borrowProbability);
      });
    }

    if (composersMap.HarmonicRhythmComposer) {
      this.register('harmonicRhythm', ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => {
        return new (composersMap.HarmonicRhythmComposer as any)(progression, key, measuresPerChord, quality);
      });
    }

    if (composersMap.MelodicDevelopmentComposer) {
      this.register('melodicDevelopment', ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) => {
        return new (composersMap.MelodicDevelopmentComposer as any)(name, root, developmentIntensity);
      });
    }

    if (composersMap.AdvancedVoiceLeadingComposer) {
      this.register('advancedVoiceLeading', ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => {
        return new (composersMap.AdvancedVoiceLeadingComposer as any)(name, root, commonToneWeight);
      });
    }
  }
}
```

<!-- END: snippet:ComposerRegistry -->

#### `getInstance()`

Get the singleton instance and auto-register defaults.

<!-- BEGIN: snippet:ComposerRegistry_getInstance -->

```typescript
static getInstance(): ComposerRegistry {
    if (!this.instance) {
      this.instance = new ComposerRegistry();
      this.instance.registerDefaults();
    }
    return this.instance;
  }
```

<!-- END: snippet:ComposerRegistry_getInstance -->

#### `register(type, factory)`

Register a factory for a type string.

<!-- BEGIN: snippet:ComposerRegistry_register -->

```typescript
register(type: string, factory: ComposerFactory): void {
    this.composers.set(type, factory);
  }
```

<!-- END: snippet:ComposerRegistry_register -->

#### `create(config)`

Instantiate a composer from a config object; falls back to random scale if unknown type and scale is available.

<!-- BEGIN: snippet:ComposerRegistry_create -->

```typescript
create(config: ComposerConfig): any {
    const type = config.type;
    const factory = this.composers.get(type);

    if (!factory) {
      throw new Error(`ComposerRegistry: No factory registered for type '${type}'`);
    }

    // Create instance using registered factory
    const inst = factory(config);

    // STRICT MODE (targeted): For a small set of timing-focused composer types, fail fast when required timing APIs are missing.
    const timingTypes = new Set([ 'measure', 'harmonicRhythm', 'tensionRelease', 'modalInterchange', 'melodicDevelopment', 'advancedVoiceLeading' ]);
    if (timingTypes.has(type)) {
      const missing: string[] = [];
      if (!inst || typeof inst !== 'object') missing.push('instance');
      if (inst && typeof inst.getMeter !== 'function') missing.push('getMeter');
      if (inst && typeof inst.getDivisions !== 'function') missing.push('getDivisions');
      if (inst && typeof inst.getSubdivisions !== 'function') missing.push('getSubdivisions');
      if (inst && typeof inst.getVoices !== 'function') missing.push('getVoices');

      if (missing.length > 0) {
        throw new Error(`ComposerRegistry: Composer of type '${type}' is missing required API methods: ${missing.join(', ')}`);
      }
    }

    return inst;
  }
```

<!-- END: snippet:ComposerRegistry_create -->

#### `has(type)`

Check if a type is registered.

<!-- BEGIN: snippet:ComposerRegistry_has -->

```typescript
has(type: string): boolean {
    return this.composers.has(type);
  }
```

<!-- END: snippet:ComposerRegistry_has -->

#### `getTypes()`

List all registered composer types.

<!-- BEGIN: snippet:ComposerRegistry_getTypes -->

```typescript
getTypes(): string[] {
    return Array.from(this.composers.keys());
  }
```

<!-- END: snippet:ComposerRegistry_getTypes -->

#### `clear()`

Remove all registered composers (useful for tests).

<!-- BEGIN: snippet:ComposerRegistry_clear -->

```typescript
clear(): void {
    this.composers.clear();
  }
```

<!-- END: snippet:ComposerRegistry_clear -->

---

## Usage Example

```typescript
import ComposerRegistry from '../src/ComposerRegistry';

const registry = ComposerRegistry.getInstance();

registry.register('custom', (cfg) => ({ kind: 'custom', cfg }));

const c1 = registry.create({ type: 'custom', foo: 1 });
const c2 = registry.create({ type: 'scale', name: 'minor', root: 'A' });

console.log(registry.has('custom')); // true
console.log(registry.getTypes()); // ['measure','scale','chords','mode','pentatonic', ...]
```

---

## Related Modules

- composers.ts ([code](../src/composers.ts)) ([doc](composers.md)) - Exposes composer interfaces and utilities
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Orchestration layer that requests composers
- EventBus.ts ([code](../src/EventBus.ts)) ([doc](EventBus.md)) - Emits progress and control events alongside composer operations
- PolychronConfig.ts ([code](../src/PolychronConfig.ts)) ([doc](PolychronConfig.md)) - Configuration that selects composer types
