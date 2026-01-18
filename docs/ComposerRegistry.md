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
    const type = config.type || 'scale';
    const factory = this.composers.get(type);

    if (!factory) {
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      const scaleFactory = this.composers.get('scale');
      if (scaleFactory) {
        return scaleFactory({ name: 'random', root: 'random' });
      }
      throw new Error(`ComposerRegistry: No factory registered for type '${type}' and no fallback available`);
    }

    return factory(config);
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
    // Import composer classes from global scope (backward compatibility)
    const ScaleComposer = g.ScaleComposer;
    const ChordComposer = g.ChordComposer;
    const ModeComposer = g.ModeComposer;
    const PentatonicComposer = g.PentatonicComposer;
    const MeasureComposer = g.MeasureComposer;
    const TensionReleaseComposer = g.TensionReleaseComposer;
    const ModalInterchangeComposer = g.ModalInterchangeComposer;
    const HarmonicRhythmComposer = g.HarmonicRhythmComposer;
    const MelodicDevelopmentComposer = g.MelodicDevelopmentComposer;
    const AdvancedVoiceLeadingComposer = g.AdvancedVoiceLeadingComposer;

    // Utilities from global scope
    const ri = g.ri;
    const allScales = g.allScales;
    const allNotes = g.allNotes;
    const allChords = g.allChords;
    const allModes = g.allModes;

    // Register measure composer
    this.register('measure', () => new MeasureComposer());

    // Register scale composer with random support
    this.register('scale', ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    });

    // Register chord composer with progression support
    this.register('chords', ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords[ri(allChords.length - 1)]);
        }
      }
      return new ChordComposer(p);
    });

    // Register mode composer with random support
    this.register('mode', ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ModeComposer(n, r);
    });

    // Register pentatonic composer
    this.register('pentatonic', ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new PentatonicComposer(r, t);
    });

    // Register advanced composers (if they exist)
    if (TensionReleaseComposer) {
      this.register('tensionRelease', ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) =>
        new TensionReleaseComposer(key, quality, tensionCurve)
      );
    }

    if (ModalInterchangeComposer) {
      this.register('modalInterchange', ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) =>
        new ModalInterchangeComposer(key, primaryMode, borrowProbability)
      );
    }

    if (HarmonicRhythmComposer) {
      this.register('harmonicRhythm', ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) =>
        new HarmonicRhythmComposer(progression, key, measuresPerChord, quality)
      );
    }

    if (MelodicDevelopmentComposer) {
      this.register('melodicDevelopment', ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) =>
        new MelodicDevelopmentComposer(name, root, developmentIntensity)
      );
    }

    if (AdvancedVoiceLeadingComposer) {
      this.register('advancedVoiceLeading', ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) =>
        new AdvancedVoiceLeadingComposer(name, root, commonToneWeight)
      );
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
    const type = config.type || 'scale';
    const factory = this.composers.get(type);

    if (!factory) {
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      const scaleFactory = this.composers.get('scale');
      if (scaleFactory) {
        return scaleFactory({ name: 'random', root: 'random' });
      }
      throw new Error(`ComposerRegistry: No factory registered for type '${type}' and no fallback available`);
    }

    return factory(config);
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

