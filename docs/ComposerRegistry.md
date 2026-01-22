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
    // Use DI sources for composer constructors and data arrays
    // Import composers and venue data synchronously (safe despite circular imports)
    // This avoids relying on legacy globalThis fallbacks
    const ScaleComposer = Composers.ScaleComposer;
    const ChordComposer = Composers.ChordComposer;
    const ModeComposer = Composers.ModeComposer;
    const PentatonicComposer = Composers.PentatonicComposer;
    const MeasureComposer = Composers.MeasureComposer;
    const TensionReleaseComposer = Composers.TensionReleaseComposer;
    const ModalInterchangeComposer = Composers.ModalInterchangeComposer;
    const HarmonicRhythmComposer = Composers.HarmonicRhythmComposer;
    const MelodicDevelopmentComposer = Composers.MelodicDevelopmentComposer;
    const AdvancedVoiceLeadingComposer = Composers.AdvancedVoiceLeadingComposer;

    // Register measure composer (ensure instance indicates type for tests)
    this.register('measure', () => {
      const inst = new MeasureComposer();
      (inst as any).type = 'measure';
      return inst;
    });

    // Register scale composer with random support
    this.register('scale', ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? (allScales && allScales.length ? allScales[Math.max(0, ri(allScales.length - 1))] : 'major') : name;
      const r = root === 'random' ? (allNotes && allNotes.length ? allNotes[Math.max(0, ri(allNotes.length - 1))] : 'C') : root;
      return new ScaleComposer(n, r);
    });

    // Register chord composer with progression support
    this.register('chords', ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
        const len = typeof ri === 'function' ? ri(2, 5) : 3;
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords && allChords.length ? allChords[Math.max(0, ri(allChords.length - 1))] : 'C');
        }
      }
      return new ChordComposer(p);
    });

    // Register mode composer with random support
    this.register('mode', ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? (allModes && allModes.length ? allModes[Math.max(0, ri(allModes.length - 1))] : 'ionian') : name;
      const r = root === 'random' ? (allNotes && allNotes.length ? allNotes[Math.max(0, ri(allNotes.length - 1))] : 'C') : root;
      return new ModeComposer(n, r);
    });

    // Register pentatonic composer
    this.register('pentatonic', ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : root : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      const inst = new PentatonicComposer(r, t);
      // Registry-level type indicates 'pentatonic' to satisfy callers expecting top-level type
      (inst as any).type = 'pentatonic';
      (inst as any).scaleType = t;
      return inst;
    });

    // Register advanced composers (if they exist)
    if (typeof TensionReleaseComposer === 'function') {
      this.register('tensionRelease', ({ key = allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : 'C', quality = 'major', tensionCurve = 0.5 } = {}) =>
        new TensionReleaseComposer(key, quality, tensionCurve)
      );
    }

    if (typeof ModalInterchangeComposer === 'function') {
      this.register('modalInterchange', ({ key = allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : 'C', primaryMode = 'major', borrowProbability = 0.25 } = {}) =>
        new ModalInterchangeComposer(key, primaryMode, borrowProbability)
      );
    }

    if (typeof HarmonicRhythmComposer === 'function') {
      this.register('harmonicRhythm', ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) =>
        new HarmonicRhythmComposer(progression, key, measuresPerChord, quality)
      );
    }

    if (typeof MelodicDevelopmentComposer === 'function') {
      this.register('melodicDevelopment', ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) =>
        new MelodicDevelopmentComposer(name, root, developmentIntensity)
      );
    }

    if (typeof AdvancedVoiceLeadingComposer === 'function') {
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
